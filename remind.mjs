/* تذكير بوقت الصلاة: يُستدعى كل 5 دقائق، ويرسل إشعاراً لمن دخل وقت صلاته للتو */
import crypto from "node:crypto";

const PID = process.env.FB_PROJECT_ID || "salahapp-5015d";
const FS = `https://firestore.googleapis.com/v1/projects/${PID}/databases/(default)/documents`;
const NAMES = { fajr: "الفجر", dhuhr: "الظهر", asr: "العصر", maghrib: "المغرب", isha: "العشاء" };
const WINDOW_MIN = 7; /* نافذة السماح لتفادي فوات الإشعار إذا تأخر التشغيل */

const b64 = o => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
let tok = null, exp = 0;
async function access() {
  if (tok && Date.now() < exp) return tok;
  const now = Math.floor(Date.now() / 1000), em = process.env.FB_CLIENT_EMAIL,
    pk = (process.env.FB_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  const u = b64({ alg: "RS256", typ: "JWT" }) + "." + b64({
    iss: em, scope: "https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 });
  const sig = crypto.createSign("RSA-SHA256").update(u).sign(pk, "base64url");
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=" + u + "." + sig });
  const j = await r.json();
  if (!j.access_token) throw new Error("auth");
  tok = j.access_token; exp = Date.now() + 3300e3; return tok;
}

/* نفس معادلة المواقيت في التطبيق (الهيئة المصرية: فجر 19.5 وعشاء 17.5) */
function calc(lat, lng, date, tz) {
  const R = Math.PI / 180;
  const J = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 864e5 + 2440587.5 + 0.5 - lng / 360, D = J - 2451545;
  const g = (357.529 + 0.98560028 * D) % 360, q = (280.459 + 0.98564736 * D) % 360;
  const L = (q + 1.915 * Math.sin(g * R) + 0.02 * Math.sin(2 * g * R)) % 360, e = 23.439 - 3.6e-7 * D;
  let RA = Math.atan2(Math.cos(e * R) * Math.sin(L * R), Math.cos(L * R)) / R / 15; RA = ((RA % 24) + 24) % 24;
  const dec = Math.asin(Math.sin(e * R) * Math.sin(L * R)) / R, eqt = q / 15 - RA;
  const noon = 12 + tz - lng / 15 - eqt;
  const T = a => { const x = (-Math.sin(a * R) - Math.sin(dec * R) * Math.sin(lat * R)) / (Math.cos(dec * R) * Math.cos(lat * R)); return Math.acos(Math.max(-1, Math.min(1, x))) / R / 15; };
  const asrA = -Math.atan(1 / (1 + Math.tan(Math.abs(lat - dec) * R))) / R;
  const o = { fajr: noon - T(19.5), sunrise: noon - T(0.833), dhuhr: noon + 0.02, asr: noon + T(asrA), maghrib: noon + T(0.833) + 0.02, isha: noon + T(17.5) };
  Object.keys(o).forEach(k => o[k] = ((o[k] % 24) + 24) % 24 * 60);
  return o;
}
export function prayerTimesFor(lat, lng, zone, nowMs = Date.now()) {
  const c = new Date(new Date(nowMs).toLocaleString("en-US", { timeZone: zone }));
  const tz = Math.round((Date.UTC(c.getFullYear(), c.getMonth(), c.getDate(), c.getHours(), c.getMinutes(), c.getSeconds()) - nowMs) / 3.6e6 * 4) / 4;
  return { times: calc(lat, lng, c, tz), minutes: c.getHours() * 60 + c.getMinutes(),
    day: c.getFullYear() + "-" + String(c.getMonth() + 1).padStart(2, "0") + "-" + String(c.getDate()).padStart(2, "0") };
}

const num = f => f && (f.doubleValue != null ? +f.doubleValue : f.integerValue != null ? +f.integerValue : null);
async function listTokens() {
  const out = []; let page = "";
  do {
    const r = await fetch(`${FS}/tokens?pageSize=300${page ? "&pageToken=" + encodeURIComponent(page) : ""}`, { headers: { Authorization: "Bearer " + await access() } });
    if (!r.ok) throw new Error("list " + r.status);
    const j = await r.json();
    (j.documents || []).forEach(d => out.push(d)); page = j.nextPageToken || "";
  } while (page);
  return out;
}
async function sendPush(token, title, body, tag) {
  const r = await fetch(`https://fcm.googleapis.com/v1/projects/${PID}/messages:send`, { method: "POST",
    headers: { Authorization: "Bearer " + await access(), "Content-Type": "application/json" },
    body: JSON.stringify({ message: { token, data: { title, body, tag }, webpush: { headers: { Urgency: "high", TTL: "1800" } } } }) });
  return r.status;
}
const patch = async (name, fields, mask) => fetch(`https://firestore.googleapis.com/v1/${name}?updateMask.fieldPaths=${mask}`,
  { method: "PATCH", headers: { Authorization: "Bearer " + await access(), "Content-Type": "application/json" }, body: JSON.stringify({ fields }) });
const del = async name => fetch(`https://firestore.googleapis.com/v1/${name}`, { method: "DELETE", headers: { Authorization: "Bearer " + await access() } });

export async function run() {
  const docs = await listTokens(); let sent = 0, skipped = 0, removed = 0;
  for (const d of docs) {
    try {
      const f = d.fields || {}, t = f.t && f.t.stringValue, lc = f.lc && f.lc.mapValue && f.lc.mapValue.fields;
      if (!t || !lc) { skipped++; continue; }
      const lat = num(lc.a), lng = num(lc.o), zone = lc.z && lc.z.stringValue;
      if (lat == null || lng == null || !zone) { skipped++; continue; }
      const { times, minutes, day } = prayerTimesFor(lat, lng, zone);
      for (const p of Object.keys(NAMES)) {
        const since = minutes - times[p];
        if (since < 0 || since >= WINDOW_MIN) continue;
        const key = day + "_" + p;
        if (f.ln && f.ln.stringValue === key) continue; /* أُرسل من قبل */
        const st = await sendPush(t, "حان وقت صلاة " + NAMES[p] + " 🕌", "لا تنسَ تسجيل صلاتك في التطبيق بعد الأداء", "pr_" + key);
        if (st === 404 || st === 400) { await del(d.name); removed++; break; } /* توكن منتهي */
        await patch(d.name, { ln: { stringValue: key } }, "ln");
        sent++; break;
      }
    } catch (e) { skipped++; }
  }
  return { tokens: docs.length, sent, skipped, removed };
}
