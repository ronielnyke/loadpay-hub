// GET /.netlify/functions/pm-status  ->  { ok, mode }
const { json } = require('./lib/common');
exports.handler = async () => {
  const k = process.env.PAYMONGO_SECRET_KEY || '';
  const ok = /^sk_(test|live)_/.test(k) && !!process.env.FIREBASE_SERVICE_ACCOUNT;
  return json(200, { ok, mode: k.startsWith('sk_live') ? 'live' : 'test' });
};
