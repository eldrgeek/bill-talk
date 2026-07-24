# bill-talk BREADCRUMBS

## What this project is
Standalone ElevenLabs voice+text chat agent UI, deployed at **bill-talk.netlify.app**.
Hosts the `el-proxy` Netlify function used by soma-guide for TTS narration during site tours.

## Critical layout

```
bill-talk/
  index.html                        ← voice/text chat UI for "Ask Bill" full page
  netlify/functions/
    el-proxy.js                     ← proxies ElevenLabs API (list convos, get transcript, TTS)
    kb-list.js                      ← lists knowledge-base docs for the agent
    kb-upload.js                    ← uploads docs to ElevenLabs knowledge base
  netlify.toml                      ← [functions] directory = "netlify/functions"
```

## ElevenLabs agent
- Agent ID: `agent_2401ks53q6t8e2drt1h7va3f2c52` (hardcoded in index.html AND legends-guide-config.js)
- Agent name: "Bill"

## el-proxy API (called by soma-guide TTS narration)
URL: `https://bill-talk.netlify.app/.netlify/functions/el-proxy`
Set in legends-guide-config.js as `ttsProxyUrl`.

Actions:
- `?action=list&agent_id=<id>` — list past conversations
- `?action=get&conversation_id=<id>` — get transcript
- `?action=tts` + POST body `{text, agent_id}` — synthesize speech

## Required Netlify env var (on bill-talk Netlify site)
- `ELEVENLABS_API_KEY` — ElevenLabs API key. If missing → el-proxy returns 500 "ELEVENLABS_API_KEY not set". If expired/over-quota → el-proxy returns ElevenLabs error payload.

## Diagnostic checks
```bash
# Is the proxy alive?
curl "https://bill-talk.netlify.app/.netlify/functions/el-proxy?action=list&agent_id=agent_2401ks53q6t8e2drt1h7va3f2c52"
# Expected: JSON with "conversations" array (possibly empty)
# Bad: {"error":"ELEVENLABS_API_KEY not set"}  → key missing in Netlify env
# Bad: {"error":"..."} with 401/403 status      → key expired/rotated
```

## Related projects
- `~/Projects/soma-platform/` — soma-guide CDN; loads soma-guide.js widget
- `~/Projects/legends-membership-site/js/legends-guide-config.js` — points ttsProxyUrl here
