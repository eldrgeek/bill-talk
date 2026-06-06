const EL_BASE = 'https://api.elevenlabs.io/v1';

/* Module-level voice cache — survives Lambda warm reuse, ephemeral otherwise */
const voiceCache = {};

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
      if (!voiceId) {
        const agentId = p.agent_id;
        if (!agentId) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'agent_id or voice_id required' }) };

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
