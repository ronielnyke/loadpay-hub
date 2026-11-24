'use strict';

const { cert, getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { isConfirmedCheckout } = require('../../functions/lib/paymongo-payment');

const OWNER_EMAIL = (process.env.OWNER_EMAIL || 'ronielnyke@gmail.com').toLowerCase();
const PAYMENT_TYPES = { GCash: 'gcash', Maya: 'paymaya', GrabPay: 'grab_pay', Card: 'card' };

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function firebaseAdmin() {
  const existing = getApps()[0];
  if (existing) return existing;

  const serializedAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!serializedAccount) {
    throw httpError(503, 'Firebase Admin credentials are not configured on the server.');
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(serializedAccount);
  } catch (error) {
    throw httpError(503, 'Firebase Admin credentials are not valid JSON.');
  }

  const projectId = process.env.FIREBASE_PROJECT_ID || 'loadpay-hub';
  if (serviceAccount.project_id !== projectId || !serviceAccount.client_email || !serviceAccount.private_key) {
    throw httpError(503, 'Firebase Admin credentials are incomplete.');
  }

  serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
  return initializeApp({ credential: cert(serviceAccount), projectId });
}

function parseBody(req) {
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
    const decoded = await getAuth(firebaseAdmin()).verifyIdToken(idToken);
    return {
      uid: decoded.uid,
      email: String(decoded.email || '').toLowerCase(),
      verified: decoded.email_verified === true
    };
  } catch (error) {
    if (error.status) throw error;
    throw httpError(401, 'Invalid session. Please sign in again.');
  }
}

function database() {
  return getFirestore(firebaseAdmin());
}

async function getTransaction(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) return null;
  const snapshot = await database().collection('transactions').doc(id).get();
  return snapshot.exists ? { ...snapshot.data(), id: snapshot.id } : null;
}

async function paymongo(path, method = 'GET', body) {
  const key = process.env.PAYMONGO_SECRET_KEY;
  if (!key || !/^sk_(test|live)_/.test(key)) {
    throw httpError(503, 'PayMongo secret key is missing or invalid on the server.');
  }

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

async function createCheckout(body) {
  const user = await verifyUser(body.idToken);
  const tx = await getTransaction(body.txId);
  if (!tx || tx.uid !== user.uid) throw httpError(404, 'Order not found.');
  if (tx.status !== 'Awaiting Payment') throw httpError(400, 'This order is not waiting for payment.');

  const paymentType = PAYMENT_TYPES[tx.method];
  if (!paymentType) throw httpError(400, 'Unsupported payment method.');
  const amount = Math.round(Number(tx.amount) * 100);
  if (!Number.isSafeInteger(amount) || amount < 2000) {
    throw httpError(400, 'Online payment minimum is ₱20.00.');
  }

  const previewUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '';
  const siteUrl = (process.env.SITE_URL || previewUrl || 'https://lambaconnect.netlify.app').replace(/\/$/, '');
  const result = await paymongo('/checkout_sessions', 'POST', { data: { attributes: {
    billing: { name: tx.name || 'Customer', email: tx.email || user.email },
    line_items: [{
      currency: 'PHP',
      amount,
      name: String(tx.service || 'LoadPay Hub order'),
      description: String(tx.detail || tx.service || 'Digital service'),
      quantity: 1
    }],
    payment_method_types: [paymentType],
    success_url: `${siteUrl}/?pm=ok&tx=${encodeURIComponent(tx.id)}`,
    cancel_url: `${siteUrl}/?pm=cancel&tx=${encodeURIComponent(tx.id)}`,
    description: `${tx.service} - ${tx.id}`,
    reference_number: tx.id,
    send_email_receipt: false,
    show_description: true,
    show_line_items: true,
    metadata: { txId: tx.id, uid: tx.uid }
  } } });

  const checkout = result.data;
  const url = checkout && checkout.attributes && checkout.attributes.checkout_url;
  if (!checkout || !checkout.id || !url) {
    throw httpError(502, 'PayMongo returned an incomplete checkout session.');
  }

  await database().collection('transactions').doc(tx.id).update({ pmId: checkout.id, online: true });
  return { url, id: checkout.id };
}

async function verifyCheckout(body) {
  const user = await verifyUser(body.idToken);
  const tx = await getTransaction(body.txId);
  if (!tx) throw httpError(404, 'Order not found.');

  const isOwner = user.verified && user.email === OWNER_EMAIL;
  if (tx.uid !== user.uid && !isOwner) throw httpError(403, 'Not allowed.');
  if (tx.status === 'Success') return { paid: true, changed: false };
  if (tx.status !== 'Awaiting Payment' || !tx.pmId) return { paid: false, reason: 'not-awaiting' };

  const result = await paymongo(`/checkout_sessions/${encodeURIComponent(tx.pmId)}`);
  const checkout = result.data;
  const attributes = checkout && checkout.attributes || {};
  if (!isConfirmedCheckout(checkout, tx)) {
    return {
      paid: false,
      status: attributes.status || 'pending',
      reason: attributes.status === 'paid' ? 'payment-details-mismatch' : 'not-paid'
    };
  }

  const amount = Math.round(Number(tx.amount) * 100);
  const payment = (attributes.payments || []).find(item => {
    const paymentAttributes = item && item.attributes;
    return paymentAttributes &&
      paymentAttributes.status === 'paid' &&
      Number(paymentAttributes.amount) === amount &&
      String(paymentAttributes.currency || '').toUpperCase() === 'PHP';
  });

  const reference = String(payment ? payment.id : tx.pmId);
  const transactionRef = database().collection('transactions').doc(tx.id);
  const changed = await database().runTransaction(async transaction => {
    const current = await transaction.get(transactionRef);
    if (!current.exists) throw httpError(404, 'Order not found.');
    if (current.data().status === 'Success') return false;
    if (current.data().status !== 'Awaiting Payment' || current.data().pmId !== tx.pmId) {
      return false;
    }
    transaction.update(transactionRef, {
      status: 'Success',
      ref: reference,
      updated: Date.now(),
      paidVia: String(tx.method)
    });
    return true;
  });

  return { paid: true, changed };
}

module.exports = {
  createCheckout,
  httpError,
  parseBody,
  verifyCheckout,
  verifyUser
};
