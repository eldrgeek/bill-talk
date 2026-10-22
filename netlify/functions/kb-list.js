const { BILL_ORIGIN_RES, callerOrigin, originAllowed, corsHeaders } = require('../lib/guard');

const EL_BASE = 'https://api.elevenlabs.io/v1';
const BILL_AGENT_ID = 'agent_2401ks53q6t8e2drt1h7va3f2c52';


exports.handler = async (event) => {
  const origin = callerOrigin(event);
  const allowed = originAllowed(origin, BILL_ORIGIN_RES);
  const cors = corsHeaders(origin, allowed);
  if (!allowed) return { statusCode: 403, headers: cors, body: JSON.stringify({ error: 'origin not allowed' }) };

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'ELEVENLABS_API_KEY not set' }) };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'GET only' }) };

  const agentResp = await fetch(`${EL_BASE}/convai/agents/${BILL_AGENT_ID}`, {
    headers: { 'xi-api-key': apiKey },
  });

  if (!agentResp.ok) {
    return { statusCode: 502, headers: cors, body: JSON.stringify({ error: 'Failed to fetch agent config' }) };
  }

  const agentData = await agentResp.json();
  const kb = agentData?.conversation_config?.agent?.prompt?.knowledge_base || [];

  const documents = kb.map(entry => ({
    id: entry.id,
    name: entry.name,
    usage_mode: entry.usage_mode,
    type: entry.type,
  }));

  return { statusCode: 200, headers: cors, body: JSON.stringify({ documents }) };
};
