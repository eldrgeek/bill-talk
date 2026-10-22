const { connectLambda, getStore } = require('@netlify/blobs');
const { TTS_ORIGIN_RES, BILL_ORIGIN_RES, callerOrigin, originAllowed, corsHeaders, bearerMatches } = require('../lib/guard');

const EL_BASE = 'https://api.elevenlabs.io/v1';
const BILL_AGENT_ID = 'agent_2401ks53q6t8e2drt1h7va3f2c52';

/* Spend limits on the tts action (2026-10-22, bead es-vmo). The cap is shared
 * by every caller and resets at 00:00 UTC; the count lives in Netlify Blobs
 * so it holds across Lambda instances. Blobs reads here are eventually
 * consistent (strong reads are not configured for Lambda-style functions),
 * so instances can briefly undercount; the cap is approximate. Both are env-tunable without a code
 * change (they take effect on the next deploy). */
const DAILY_CHAR_CAP = parseInt(process.env.EL_PROXY_DAILY_CHAR_CAP || '15000', 10);
const MAX_TEXT_CHARS = parseInt(process.env.EL_PROXY_MAX_TEXT_CHARS || '1500', 10);

function usageKey() {
  return 'tts-chars-' + new Date().toISOString().slice(0, 10);
}

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
  const origin = callerOrigin(event);
  /* A server-side caller (no browser, so no Origin or Referer) needs the
   * EL_PROXY_SERVER_TOKEN bearer token instead. */
  const serverCaller = !origin && bearerMatches(event, process.env.EL_PROXY_SERVER_TOKEN);
  const allowed = serverCaller || originAllowed(origin, TTS_ORIGIN_RES);
  const cors = corsHeaders(origin, allowed);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: allowed ? 204 : 403, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }, body: '' };
  }
  if (!allowed) {
    return { statusCode: 403, headers: cors, body: JSON.stringify({ error: 'origin not allowed' }) };
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

  /* Transcripts are read only by Bill's own page, and only Bill's: this key's
   * account also holds other agents' conversations. */
  if ((p.action === 'list' || p.action === 'get') && !serverCaller && !originAllowed(origin, BILL_ORIGIN_RES)) {
    return { statusCode: 403, headers: cors, body: JSON.stringify({ error: 'transcripts are available only on Bill\'s page' }) };
  }

  try {
    let url, resp;
    if (p.action === 'list') {
      if (!p.agent_id) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'agent_id required' }) };
      if (p.agent_id !== BILL_AGENT_ID) return { statusCode: 403, headers: cors, body: JSON.stringify({ error: 'only Bill\'s conversations are listed here' }) };
      url = `${EL_BASE}/convai/conversations?agent_id=${encodeURIComponent(p.agent_id)}&page_size=50`;
      if (p.cursor) url += `&cursor=${encodeURIComponent(p.cursor)}`;
      resp = await fetch(url, { headers: elHeaders });
    } else if (p.action === 'get') {
      if (!p.conversation_id) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'conversation_id required' }) };
      url = `${EL_BASE}/convai/conversations/${encodeURIComponent(p.conversation_id)}`;
      resp = await fetch(url, { headers: elHeaders });
      if (resp.ok) {
        const conv = await resp.json();
        if (conv.agent_id !== BILL_AGENT_ID) return { statusCode: 403, headers: cors, body: JSON.stringify({ error: 'only Bill\'s conversations are readable here' }) };
        return { statusCode: 200, headers: cors, body: JSON.stringify(conv) };
      }
    } else if (p.action === 'tts') {
      /* Synthesize text in the agent's configured voice and return audio/mpeg */
      if (!p.text) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'text required' }) };
      const textLen = String(p.text).length;
      if (textLen > MAX_TEXT_CHARS) {
        return { statusCode: 413, headers: cors, body: JSON.stringify({ error: `text longer than ${MAX_TEXT_CHARS} characters` }) };
      }

      /* Daily cap. If the counter cannot be read the proxy refuses (fail
       * closed), the same rule the voice kill switch below follows. */
      let usage, usedToday;
      try {
        connectLambda(event);
        usage = getStore('el-proxy-usage');
        usedToday = parseInt((await usage.get(usageKey())) || '0', 10) || 0;
      } catch (err) {
        console.error('el-proxy usage counter:', err && err.message);
        return { statusCode: 503, headers: cors, body: JSON.stringify({ error: 'usage counter unavailable — refusing to synthesize. Retry shortly.' }) };
      }
      if (usedToday + textLen > DAILY_CHAR_CAP) {
        return { statusCode: 429, headers: cors, body: JSON.stringify({ error: `daily speech limit reached (${DAILY_CHAR_CAP} characters, resets 00:00 UTC)` }) };
      }

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

      /* Count only what was actually synthesized. Read-then-write can lose a
       * concurrent increment; that makes the cap approximate, not open. */
      try {
        const now = parseInt((await usage.get(usageKey())) || '0', 10) || 0;
        await usage.set(usageKey(), String(now + textLen));
      } catch (_) { /* the audio is already paid for; don't throw it away */ }

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
        headers: { ...cors, 'Content-Type': 'audio/mpeg' },
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
