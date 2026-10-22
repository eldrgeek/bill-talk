/* Caller checks shared by the bill-talk functions (2026-10-22, bead es-vmo).
 *
 * Before this, every function answered `Access-Control-Allow-Origin: *` and
 * checked no caller, so any web page or script could spend ElevenLabs
 * characters through el-proxy or add documents to Bill's knowledge base.
 *
 * An Origin header can be forged outside a browser, so the origin check only
 * stops other websites from using these functions from their visitors'
 * browsers. The controls that hold against a forged request are the admin
 * token on kb-upload and the daily character cap on el-proxy's tts action. */

const crypto = require('crypto');

/* Sites that load soma-guide with ttsProxyUrl pointing here (Legends, the
 * AGI-26 speaker sites, Joscha, Levinese), plus Bill's own page. A leading
 * `<hash>--` is a Netlify deploy preview of the same site. */
const TTS_ORIGIN_RES = [
  /^https:\/\/([a-z0-9-]+--)?(bill-talk|legends-[a-z0-9-]+|legendsintake|agi26-[a-z0-9-]+|agi2026|agi-connect-26|joschese|levinese-preview|soma-guide)\.netlify\.app$/,
  /^https:\/\/([a-z0-9-]+\.)*mike-wolf\.com$/,
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
];

/* Bill's page is the only caller of the knowledge-base and transcript actions. */
const BILL_ORIGIN_RES = [
  /^https:\/\/([a-z0-9-]+--)?bill-talk\.netlify\.app$/,
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
];

function extraOrigins() {
  return (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
}

/* The calling page's origin: the Origin header, or failing that the origin of
 * the Referer (a same-origin GET from Bill's page sends no Origin header). */
function callerOrigin(event) {
  const h = event.headers || {};
  if (h.origin && h.origin !== 'null') return h.origin;
  if (h.referer) {
    try { return new URL(h.referer).origin; } catch (_) { /* fall through */ }
  }
  return null;
}

function originAllowed(origin, res) {
  if (!origin) return false;
  return res.some((re) => re.test(origin)) || extraOrigins().includes(origin);
}

function corsHeaders(origin, allowed) {
  const h = {
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
    'Vary': 'Origin',
  };
  if (allowed && origin) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

/* Constant-time comparison of `Authorization: Bearer <token>` against an env
 * secret. An unset secret matches nothing, so a missing env var fails closed. */
function bearerMatches(event, secret) {
  if (!secret) return false;
  const auth = (event.headers || {}).authorization || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return false;
  const a = Buffer.from(m[1].trim());
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = {
  TTS_ORIGIN_RES,
  BILL_ORIGIN_RES,
  callerOrigin,
  originAllowed,
  corsHeaders,
  bearerMatches,
};
