// Shared helpers for the PayMongo functions (no npm dependencies; needs Node 18+ for fetch)
const crypto = require('crypto');

const PROJECT = process.env.FIREBASE_PROJECT_ID || 'loadpay-hub';
const API_KEY = process.env.FIREBASE_API_KEY || 'AIzaSyDjDV5q0vo2wbBzVzEVcke2mtlMOqGUIvs';
const OWNER = (process.env.OWNER_EMAIL || 'ronielnyke@gmail.com').toLowerCase();

const json = (code, obj) => ({ statusCode: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(obj) });
const httpErr = (status, message) => { const e = new Error(message); e.status = status; return e; };
const wrap = fn => async event => {
  try { return await fn(event); }
  catch (e) { console.error(e); return json(e.status || 500, { error: e.message || 'Server error' }); }
};

/* ---------- Google OAuth for Firestore REST (service account) ---------- */
const b64u = x => Buffer.from(x).toString('base64url');
let cached = null;
async function accessToken() {
  if (cached && cached.exp > Date.now() + 60000) return cached.v;
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) throw httpErr(500, 'FIREBASE_SERVICE_ACCOUNT is not set in Netlify.');
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT), now = Math.floor(Date.now() / 1000);
  const h = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const p = b64u(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const sig = crypto.createSign('RSA-SHA256').update(h + '.' + p).sign(sa.private_key).toString('base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: h + '.' + p + '.' + sig })
  });
  const j = await r.json();
  if (!j.access_token) throw httpErr(500, 'Google auth failed: ' + (j.error_description || j.error || r.status));
  cached = { v: j.access_token, exp: Date.now() + 3500 * 1000 };
  return cached.v;
}

/* ---------- Who is calling? (Firebase ID token) ---------- */
async function verifyUser(idToken) {
  if (!idToken) throw httpErr(401, 'Please sign in again.');
  const r = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + API_KEY, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken })
  });
  const j = await r.json(), u = j.users && j.users[0];
  if (!u) throw httpErr(401, 'Invalid session. Please sign in again.');
  return { uid: u.localId, email: (u.email || '').toLowerCase(), verified: !!u.emailVerified };
}
const isOwner = u => u.verified && u.email === OWNER;

/* ---------- Firestore REST ---------- */
const base = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const fromF = f => {
  const o = {};
  for (const k of Object.keys(f || {})) {
    const v = f[k];
    o[k] = 'stringValue' in v ? v.stringValue : 'integerValue' in v ? Number(v.integerValue) : 'doubleValue' in v ? v.doubleValue : 'booleanValue' in v ? v.booleanValue : null;
  }
  return o;
};
const toF = o => {
  const f = {};
  for (const k of Object.keys(o)) {
    const v = o[k];
    f[k] = typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }) : typeof v === 'boolean' ? { booleanValue: v } : { stringValue: String(v) };
  }
  return f;
};
async function getTx(id) {
  const r = await fetch(`${base}/transactions/${encodeURIComponent(id || '-')}`, { headers: { Authorization: 'Bearer ' + await accessToken() } });
  if (r.status === 404) return null;
  const j = await r.json();
  if (!r.ok) throw httpErr(500, 'Firestore read failed: ' + ((j.error && j.error.message) || r.status));
  return fromF(j.fields);
}
async function patchTx(id, obj) {
  const mask = Object.keys(obj).map(k => 'updateMask.fieldPaths=' + encodeURIComponent(k)).join('&');
  const r = await fetch(`${base}/transactions/${encodeURIComponent(id)}?${mask}&currentDocument.exists=true`, {
    method: 'PATCH', headers: { Authorization: 'Bearer ' + await accessToken(), 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: toF(obj) })
  });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw httpErr(500, 'Firestore write failed: ' + ((j.error && j.error.message) || r.status)); }
}

/* ---------- PayMongo ---------- */
async function pm(path, method = 'GET', body) {
  const key = process.env.PAYMONGO_SECRET_KEY;
  if (!key) throw httpErr(500, 'PAYMONGO_SECRET_KEY is not set in Netlify.');
  const r = await fetch('https://api.paymongo.com/v1' + path, {
    method, headers: { Authorization: 'Basic ' + Buffer.from(key + ':').toString('base64'), 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw httpErr(r.status >= 500 ? 502 : 400, 'PayMongo: ' + ((j.errors && j.errors[0] && (j.errors[0].detail || j.errors[0].code)) || 'error ' + r.status));
  return j;
}

module.exports = { json, httpErr, wrap, verifyUser, isOwner, getTx, patchTx, pm };
