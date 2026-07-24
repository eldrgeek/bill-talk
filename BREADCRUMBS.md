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

Voice-talent kill switch (2026-07-24, voice release §7): before every `tts`
synth the proxy checks the RESOLVED voice id against PlayMaker's registry
(`GET playmaker-mw.netlify.app/api/voice-status?voice_id=<id>`). A registered
talent voice whose owner revoked → **403** `{voice_license:"revoked"}`; status
endpoint unreachable/5xx → **503** fail-closed. `active`/`unregistered` synth
normally. Verdicts cached 60s per warm Lambda. This is how izzy-chat's Izzy
voice (`RsotjdYjhjPD5V0I7nzI`, registered to Isabel Rosa) honors her kill
switch — izzy-chat synthesizes through this proxy.

## Required Netlify env var (on bill-talk Netlify site)
- `ELEVENLABS_API_KEY` — ElevenLabs API key. If missing → el-proxy returns 500 "ELEVENLABS_API_KEY not set". If expired/over-quota → el-proxy returns ElevenLabs error payload.
- `VOICE_INGEST_TOKEN` (optional, set 2026-07-24) — bearer token for PlayMaker's `/api/voice-generation-ingest`; when present, each successful tts synth is logged to the voice talent's §6 transparency panel. Absent → logging silently skipped, synth unaffected. (`VOICE_STATUS_URL` / `VOICE_INGEST_URL` override the PlayMaker endpoints for testing.)

## ⚠ Netlify deploy gotcha (found 2026-07-24)
The bill-talk Netlify site is linked to the WRONG repo — `eldrgeek/cora-talk`, not
`eldrgeek/bill-talk` — so pushing to this repo does NOT deploy. The live site had been
running a pre-TTS el-proxy since 2026-07-04 (izzy-chat's tts calls 400'd) until a manual
`netlify deploy --prod` from this repo on 2026-07-24. Until the link is fixed in the
Netlify UI (Site settings → Build & deploy → Link repository), every change here must be
shipped with `netlify deploy --prod`.

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
