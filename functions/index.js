'use strict';

const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { defineSecret } = require('firebase-functions/params');
const { onRequest } = require('firebase-functions/v2/https');
const { isConfirmedCheckout } = require('./lib/paymongo-payment');

initializeApp();
const auth = getAuth();
const db = getFirestore();
const paymongoSecret = defineSecret('PAYMONGO_SECRET_KEY');
const REGION = 'asia-southeast1';
const SITE_URL = process.env.SITE_URL || 'https://lambaconnect.netlify.app';
const OWNER_EMAIL = (process.env.OWNER_EMAIL || 'ronielnyke@gmail.com').toLowerCase();
const PAYMENT_TYPES = { GCash: 'gcash', Maya: 'paymaya', GrabPay: 'grab_pay', Card: 'card' };
const CORS_ORIGINS = [
  'https://lambaconnect.netlify.app',
  'https://loadpay-hub.firebaseapp.com',
  'https://loadpay-hub.web.app',
  'http://localhost:5000',
  'http://127.0.0.1:5000'
];

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function endpoint(handler) {
  return onRequest({
    region: REGION,
    cors: CORS_ORIGINS,
    secrets: [paymongoSecret]
  }, async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      console.error(error);
      const status = Number.isInteger(error.status) ? error.status : 500;
      res.status(status).json({ error: status >= 500 ? 'Payment service error.' : error.message });
    }
  });
}

function requestBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch (error) {
      throw httpError(400, 'Invalid JSON request body.');
    }
  }
  return {};
}

async function verifyUser(idToken) {
  if (!idToken) throw httpError(401, 'Please sign in again.');
  try {
    const decoded = await auth.verifyIdToken(idToken);
    return {
      uid: decoded.uid,
      email: String(decoded.email || '').toLowerCase(),
      verified: decoded.email_verified === true
    };
  } catch (error) {
    throw httpError(401, 'Invalid session. Please sign in again.');
  }
}

async function getTransaction(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) return null;
  const snapshot = await db.collection('transactions').doc(id).get();
  return snapshot.exists ? { ...snapshot.data(), id: snapshot.id } : null;
}

async function paymongo(path, method = 'GET', body) {
  const key = paymongoSecret.value();
  if (!key) throw httpError(503, 'PayMongo is not configured in Firebase Secret Manager.');

  const response = await fetch(`https://api.paymongo.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${key}:`).toString('base64')}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = result.errors && result.errors[0] &&
      (result.errors[0].detail || result.errors[0].code);
    throw httpError(response.status >= 500 ? 502 : 400, `PayMongo: ${detail || `error ${response.status}`}`);
  }
  return result;
}

exports.pmCreate = endpoint(async (req, res) => {
  if (req.method !== 'POST') throw httpError(405, 'POST only');
  const body = requestBody(req);
  const user = await verifyUser(body.idToken);
  const tx = await getTransaction(body.txId);
  if (!tx || tx.uid !== user.uid) throw httpError(404, 'Order not found.');
  if (tx.status !== 'Awaiting Payment') throw httpError(400, 'This order is not waiting for payment.');

  const paymentType = PAYMENT_TYPES[tx.method];
  if (!paymentType) throw httpError(400, 'Unsupported payment method.');
  const centavos = Math.round(Number(tx.amount) * 100);
  if (!Number.isSafeInteger(centavos) || centavos < 2000) {
    throw httpError(400, 'Online payment minimum is ₱20.00.');
  }

  const result = await paymongo('/checkout_sessions', 'POST', { data: { attributes: {
    billing: { name: tx.name || 'Customer', email: tx.email || user.email },
    line_items: [{
      currency: 'PHP',
      amount: centavos,
      name: String(tx.service || 'LoadPay Hub order'),
      description: String(tx.detail || tx.service || 'Digital service'),
      quantity: 1
    }],
    payment_method_types: [paymentType],
    success_url: `${SITE_URL}/?pm=ok&tx=${encodeURIComponent(tx.id)}`,
    cancel_url: `${SITE_URL}/?pm=cancel&tx=${encodeURIComponent(tx.id)}`,
    description: `${tx.service} - ${tx.id}`,
    reference_number: tx.id,
    send_email_receipt: false,
    show_description: true,
    show_line_items: true,
    metadata: { txId: tx.id, uid: tx.uid }
  } } });

  const checkout = result.data;
  const checkoutUrl = checkout && checkout.attributes && checkout.attributes.checkout_url;
  if (!checkout || !checkout.id || !checkoutUrl) {
    throw httpError(502, 'PayMongo returned an incomplete checkout session.');
  }

  await db.collection('transactions').doc(tx.id).update({ pmId: checkout.id, online: true });
  res.status(200).json({ url: checkoutUrl, id: checkout.id });
});

exports.pmVerify = endpoint(async (req, res) => {
  if (req.method !== 'POST') throw httpError(405, 'POST only');
  const body = requestBody(req);
  const user = await verifyUser(body.idToken);
  const tx = await getTransaction(body.txId);
  if (!tx) throw httpError(404, 'Order not found.');

  const isOwner = user.verified && user.email === OWNER_EMAIL;
  if (tx.uid !== user.uid && !isOwner) throw httpError(403, 'Not allowed.');
  if (tx.status === 'Success') return res.status(200).json({ paid: true, changed: false });
  if (tx.status !== 'Awaiting Payment' || !tx.pmId) {
    return res.status(200).json({ paid: false, reason: 'not-awaiting' });
  }

  const result = await paymongo(`/checkout_sessions/${encodeURIComponent(tx.pmId)}`);
  const checkout = result.data;
  const attributes = checkout && checkout.attributes || {};
  if (!isConfirmedCheckout(checkout, tx)) {
    return res.status(200).json({
      paid: false,
      status: attributes.status || 'pending',
      reason: attributes.status === 'paid' ? 'payment-details-mismatch' : 'not-paid'
    });
  }

  const amount = Math.round(Number(tx.amount) * 100);
  const payment = (attributes.payments || []).find(item => {
    const paymentAttributes = item && item.attributes;
    return paymentAttributes &&
      paymentAttributes.status === 'paid' &&
      Number(paymentAttributes.amount) === amount &&
      String(paymentAttributes.currency || '').toUpperCase() === 'PHP';
  });
  await db.collection('transactions').doc(tx.id).update({
    status: 'Success',
    ref: String(payment ? payment.id : tx.pmId),
    updated: Date.now(),
    paidVia: String(tx.method)
  });
  res.status(200).json({ paid: true, changed: true });
});

exports.pmStatus = endpoint(async (req, res) => {
  if (req.method !== 'GET') throw httpError(405, 'GET only');
  const key = paymongoSecret.value() || '';
  const ok = /^sk_(test|live)_/.test(key);
  res.status(200).json({ ok, mode: key.startsWith('sk_live') ? 'live' : 'test' });
});
