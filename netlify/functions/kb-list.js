const EL_BASE = 'https://api.elevenlabs.io/v1';
const BILL_AGENT_ID = 'agent_2401ks53q6t8e2drt1h7va3f2c52';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

exports.handler = async (event) => {
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
