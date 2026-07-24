const EL_BASE = 'https://api.elevenlabs.io/v1';

/* Module-level voice cache — survives Lambda warm reuse, ephemeral otherwise */
const voiceCache = {};

/* Voice-talent kill switch (release §7). PlayMaker owns the talent registry;
 * before any TTS synth this proxy asks its public voice-status endpoint for
 * the resolved voice id. 'revoked' refuses, and an unreachable/5xx status
 * endpoint ALSO refuses (fail closed) — an unverifiable license is not a
 * license. 'active'/'unregistered' proceed. Verdicts cached 60s per warm
 * Lambda so the per-utterance paths (izzy-chat et al.) don't pay a round trip
 * per line. */
const VOICE_STATUS_URL = process.env.VOICE_STATUS_URL || 'https://playmaker-mw.netlify.app/api/voice-status';
const licenseCache = {}; // voiceId -> { status, checkedAt }
async function voiceLicenseStatus(voiceId) {
  const hit = licenseCache[voiceId];
  if (hit && Date.now() - hit.checkedAt < 60 * 1000) return hit.status;
  let status = 'unavailable';
  try {
    const resp = await fetch(`${VOICE_STATUS_URL}?voice_id=${encodeURIComponent(voiceId)}`);
    if (resp.ok) {
      const body = await resp.json();
      if (body && body.status) status = String(body.status);
    }
  } catch (_) { /* status stays 'unavailable' → fail closed */ }
  licenseCache[voiceId] = { status, checkedAt: Date.now() };
  return status;
}

exports.handler = async (event) => {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }, body: '' };
  }

  if (!apiKey) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'ELEVENLABS_API_KEY not set' }) };
  }

  /* Accept params from query string OR POST JSON body (needed for long TTS text) */
  const q = event.queryStringParameters || {};
  let bodyParams = {};
  if (event.body) {
    try { bodyParams = JSON.parse(event.body); } catch (_) {}
  }
  const p = Object.assign({}, q, bodyParams);
  const elHeaders = { 'xi-api-key': apiKey, 'Content-Type': 'application/json' };

  try {
    let url, resp;
    if (p.action === 'list') {
      if (!p.agent_id) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'agent_id required' }) };
      url = `${EL_BASE}/convai/conversations?agent_id=${encodeURIComponent(p.agent_id)}&page_size=50`;
      if (p.cursor) url += `&cursor=${encodeURIComponent(p.cursor)}`;
      resp = await fetch(url, { headers: elHeaders });
    } else if (p.action === 'get') {
      if (!p.conversation_id) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'conversation_id required' }) };
      url = `${EL_BASE}/convai/conversations/${encodeURIComponent(p.conversation_id)}`;
      resp = await fetch(url, { headers: elHeaders });
    } else if (p.action === 'tts') {
      /* Synthesize text in the agent's configured voice and return audio/mpeg */
      if (!p.text) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'text required' }) };

      let voiceId = p.voice_id;
      if (!voiceId && p.app_id) {
        const appVoices = { 'yeshie': 'W1EJxHy9vl73xgPIKgpn' };
        voiceId = appVoices[p.app_id];
      }
      if (!voiceId) {
        const agentId = p.agent_id;
        if (!agentId) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'agent_id, app_id, or voice_id required' }) };

        if (!voiceCache[agentId]) {
          const agentResp = await fetch(`${EL_BASE}/convai/agents/${encodeURIComponent(agentId)}`, { headers: elHeaders });
          if (!agentResp.ok) return { statusCode: agentResp.status, headers: cors, body: JSON.stringify({ error: 'agent lookup failed' }) };
          const agentData = await agentResp.json();
          const vid =
            agentData.voice_id ||
            (agentData.conversation_config &&
             agentData.conversation_config.tts &&
             agentData.conversation_config.tts.voice_id);
          if (!vid) return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'no voice_id in agent config' }) };
          voiceCache[agentId] = vid;
        }
        voiceId = voiceCache[agentId];
      }

      /* Kill-switch gate (release §7) — runs on the RESOLVED voice id, so it
       * covers voice_id, app_id, and agent-derived voices alike. */
      const license = await voiceLicenseStatus(voiceId);
      if (license === 'revoked') {
        return { statusCode: 403, headers: cors, body: JSON.stringify({
          error: 'This voice is no longer available — its owner has revoked permission to generate new audio with it (voice release §7).',
          voice_license: 'revoked',
        }) };
      }
      if (license !== 'active' && license !== 'unregistered') {
        return { statusCode: 503, headers: cors, body: JSON.stringify({
          error: 'Voice license status unavailable — refusing to synthesize (fail closed, voice release §7). Retry shortly.',
          voice_license: 'unavailable',
        }) };
      }

      const ttsResp = await fetch(`${EL_BASE}/text-to-speech/${encodeURIComponent(voiceId)}`, {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' },
        body: JSON.stringify({ text: p.text, model_id: 'eleven_turbo_v2_5' })
      });

      if (!ttsResp.ok) {
        const errText = await ttsResp.text();
        return { statusCode: ttsResp.status, headers: cors, body: JSON.stringify({ error: errText }) };
      }

      const buf = await ttsResp.arrayBuffer();

      /* §6 transparency-panel log — best-effort, never fails the synth. Awaited
       * (not fire-and-forget) because the Lambda freezes at return. Skipped
       * entirely when VOICE_INGEST_TOKEN is not configured. */
      if (process.env.VOICE_INGEST_TOKEN) {
        try {
          await fetch(process.env.VOICE_INGEST_URL || 'https://playmaker-mw.netlify.app/api/voice-generation-ingest', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.VOICE_INGEST_TOKEN}` },
            body: JSON.stringify({
              voice_id: voiceId,
              app: p.app_id || 'el-proxy',
              capability: 'tts',
              text_content: String(p.text).slice(0, 2000),
              char_count: String(p.text).length,
            }),
          });
        } catch (_) { /* a logging hiccup must not eat the audio */ }
      }

      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'audio/mpeg',
        },
        body: Buffer.from(buf).toString('base64'),
        isBase64Encoded: true,
      };
    } else {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'action must be list, get, or tts' }) };
    }
    const data = await resp.json();
    return { statusCode: resp.status, headers: cors, body: JSON.stringify(data) };
  } catch (err) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};
