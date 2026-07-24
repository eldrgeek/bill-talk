---
district: persona-agents
status: active
depends_on: [legends-review-pipeline]
capabilities: [elevenlabs, netlify]
last_reviewed: 2026-06-23
---

# bill-talk — ElevenLabs voice+text chat UI for "Bill" (NBRPA committee), deployed at bill-talk.netlify.app

**Where work happens:** `index.html` (the whole UI — ConvAI widget + text-chat + KB-upload panel) · `netlify/functions/{el-proxy,kb-list,kb-upload}.js`

**Key docs**
- [BREADCRUMBS.md](BREADCRUMBS.md) — layout, agent ID, el-proxy API, env var, diagnostic curls. Read first.

**Skills**
- gap: the shared `*-talk` ConvAI+Netlify-proxy pattern (5 repos) should become one scaffold/skill.

**Depends on / used by:** hosts the `el-proxy` function that soma-guide / the legends-review-pipeline calls for TTS narration during site tours. ElevenLabs agent `agent_2401ks53q6t8e2drt1h7va3f2c52`.

**Gotchas**
- el-proxy needs `ELEVENLABS_API_KEY` set in Netlify env; missing → 500 "ELEVENLABS_API_KEY not set", expired → ElevenLabs error payload.
- Agent ID is hardcoded in `index.html` AND in soma-guide's `legends-guide-config.js` — change both.
- cora-talk is a near-identical fork that still carries this repo's Bill title/agent ID — don't cross-copy edits blindly.
