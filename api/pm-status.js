'use strict';

function validFirebaseAdminCredentials(value) {
  if (!value) return false;
  try {
    const account = JSON.parse(value);
    return account.project_id === (process.env.FIREBASE_PROJECT_ID || 'loadpay-hub') &&
      !!(account.client_email && account.private_key);
  } catch (error) {
    return false;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'GET only' });
  }

  const key = process.env.PAYMONGO_SECRET_KEY || '';
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    ok: /^sk_(test|live)_/.test(key) &&
      validFirebaseAdminCredentials(process.env.FIREBASE_SERVICE_ACCOUNT),
    mode: key.startsWith('sk_live') ? 'live' : 'test'
  });
};
