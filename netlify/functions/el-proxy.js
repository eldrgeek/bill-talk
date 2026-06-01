const EL_BASE = 'https://api.elevenlabs.io/v1';

exports.handler = async (event) => {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' };
  }

  if (!apiKey) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'ELEVENLABS_API_KEY not set' }) };
  }

  const p = event.queryStringParameters || {};
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
    } else {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'action must be list or get' }) };
    }
    const data = await resp.json();
    return { statusCode: resp.status, headers: cors, body: JSON.stringify(data) };
  } catch (err) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: err.message }) };
  }
};
