// POST { txId, idToken } -> { url, id }   Creates a PayMongo Checkout Session for the customer's own order.
const { json, httpErr, wrap, verifyUser, getTx, patchTx, pm } = require('./lib/common');
const TYPES = { GCash: 'gcash', Maya: 'paymaya', GrabPay: 'grab_pay', Card: 'card' };

exports.handler = wrap(async event => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  const b = JSON.parse(event.body || '{}');
  const u = await verifyUser(b.idToken);
  const tx = await getTx(b.txId);
  if (!tx || tx.uid !== u.uid) throw httpErr(404, 'Order not found.');
  if (tx.status !== 'Awaiting Payment') throw httpErr(400, 'This order is not waiting for payment.');
  const type = TYPES[tx.method];
  if (!type) throw httpErr(400, 'Unsupported payment method.');
  const centavos = Math.round(Number(tx.amount) * 100);
  if (!(centavos >= 2000)) throw httpErr(400, 'Online payment minimum is \u20B120.00.');
  const site = (process.env.SITE_URL || process.env.URL || (event.headers && event.headers.origin) || '').replace(/\/$/, '');
  if (!site) throw httpErr(500, 'Site URL unknown. Set SITE_URL in Netlify.');
  const j = await pm('/checkout_sessions', 'POST', { data: { attributes: {
    billing: { name: tx.name || 'Customer', email: tx.email || u.email },
    line_items: [{ currency: 'PHP', amount: centavos, name: String(tx.service), description: String(tx.detail || tx.service), quantity: 1 }],
    payment_method_types: [type],
    success_url: `${site}/?pm=ok&tx=${encodeURIComponent(tx.id)}`,
    cancel_url: `${site}/?pm=cancel&tx=${encodeURIComponent(tx.id)}`,
    description: `${tx.service} - ${tx.id}`,
    reference_number: tx.id,
    send_email_receipt: false, show_description: true, show_line_items: true,
    metadata: { txId: tx.id, uid: tx.uid }
  } } });
  await patchTx(tx.id, { pmId: j.data.id, online: true });
  return json(200, { url: j.data.attributes.checkout_url, id: j.data.id });
});
