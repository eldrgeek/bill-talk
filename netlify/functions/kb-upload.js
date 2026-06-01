const EL_BASE = 'https://api.elevenlabs.io/v1';
const BILL_AGENT_ID = 'agent_2401ks53q6t8e2drt1h7va3f2c52';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function parseGdocId(url) {
  const m = url.match(/\/document\/d\/([-\w]+)/);
  return m ? m[1] : null;
}

exports.handler = async (event) => {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'ELEVENLABS_API_KEY not set' }) };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'POST only' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'invalid JSON' }) };
  }

  const elHeaders = { 'xi-api-key': apiKey, 'Content-Type': 'application/json' };
  const { type, url, text, name } = body;

  let createResp, docId, docName;

  if (type === 'url') {
    if (!url) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'url required' }) };

    const gdocId = parseGdocId(url);
    if (gdocId) {
      const exportUrl = `https://docs.google.com/document/d/${gdocId}/export?format=txt`;
      const gdocResp = await fetch(exportUrl);
      if (!gdocResp.ok) {
        return {
          statusCode: 422,
          headers: cors,
          body: JSON.stringify({ error: 'Google Doc not accessible. Make sure it is shared with "Anyone with the link".' }),
        };
      }
      const gdocText = await gdocResp.text();
      createResp = await fetch(`${EL_BASE}/convai/knowledge-base/text`, {
        method: 'POST', headers: elHeaders,
        body: JSON.stringify({ text: gdocText, name: name || 'Google Doc upload' }),
      });
      docName = name || 'Google Doc upload';
    } else {
      createResp = await fetch(`${EL_BASE}/convai/knowledge-base/url`, {
        method: 'POST', headers: elHeaders,
        body: JSON.stringify({ url, name: name || url }),
      });
      docName = name || url;
    }

  } else if (type === 'text') {
    if (!text) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'text required' }) };
    createResp = await fetch(`${EL_BASE}/convai/knowledge-base/text`, {
      method: 'POST', headers: elHeaders,
      body: JSON.stringify({ text, name: name || 'Pasted text' }),
    });
    docName = name || 'Pasted text';

  } else if (type === 'file_base64') {
    if (!body.content_base64 || !body.filename) {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'content_base64 and filename required' }) };
    }
    const buffer = Buffer.from(body.content_base64, 'base64');
    const formData = new FormData();
    formData.append('file', new Blob([buffer], { type: body.mime_type || 'application/octet-stream' }), body.filename);
    if (name) formData.append('name', name);
    createResp = await fetch(`${EL_BASE}/convai/knowledge-base`, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey },
      body: formData,
    });
    docName = name || body.filename;

  } else {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'type must be url or text' }) };
  }

  if (!createResp.ok) {
    const err = await createResp.json().catch(() => ({}));
    return { statusCode: 502, headers: cors, body: JSON.stringify({ error: 'ElevenLabs KB create failed', detail: err }) };
  }
  const created = await createResp.json();
  docId = created.id;

  // Get current agent KB list and append new doc
  const agentResp = await fetch(`${EL_BASE}/convai/agents/${BILL_AGENT_ID}`, { headers: { 'xi-api-key': apiKey } });
  const agentData = await agentResp.json();
  const existingKb = agentData?.conversation_config?.agent?.prompt?.knowledge_base || [];

  const newEntry = { type: 'file', id: docId, name: docName, usage_mode: 'auto' };
  const updatedKb = [...existingKb, newEntry];

  const patchResp = await fetch(`${EL_BASE}/convai/agents/${BILL_AGENT_ID}`, {
    method: 'PATCH',
    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversation_config: { agent: { prompt: { knowledge_base: updatedKb } } } }),
  });

  if (!patchResp.ok) {
    return { statusCode: 502, headers: cors, body: JSON.stringify({ error: 'ElevenLabs agent patch failed' }) };
  }

  return {
    statusCode: 200,
    headers: cors,
    body: JSON.stringify({ success: true, id: docId, name: docName }),
  };
};
