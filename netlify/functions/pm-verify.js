// POST { txId, idToken } -> { paid, changed }   Asks PayMongo if the order was really paid, then marks it Success.
const { json, httpErr, wrap, verifyUser, isOwner, getTx, patchTx, pm } = require('./lib/common');
const { isConfirmedCheckout } = require('./lib/paymongo-payment');

exports.handler = wrap(async event => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  const b = JSON.parse(event.body || '{}');
  const u = await verifyUser(b.idToken);
  const tx = await getTx(b.txId);
  if (!tx) throw httpErr(404, 'Order not found.');
  if (tx.uid !== u.uid && !isOwner(u)) throw httpErr(403, 'Not allowed.');
  if (tx.status === 'Success') return json(200, { paid: true, changed: false });
  if (tx.status !== 'Awaiting Payment' || !tx.pmId) return json(200, { paid: false, reason: 'not-awaiting' });
  const j = await pm('/checkout_sessions/' + encodeURIComponent(tx.pmId));
  const at = j.data.attributes || {};
  if (!isConfirmedCheckout(j.data, tx)) {
    return json(200, { paid: false, status: at.status || 'pending', reason: at.status === 'paid' ? 'payment-details-mismatch' : 'not-paid' });
  }
  const pay = (at.payments || []).find(p => p.attributes && p.attributes.status === 'paid');
  await patchTx(tx.id, { status: 'Success', ref: String(pay ? pay.id : tx.pmId), updated: Date.now(), paidVia: String(tx.method) });
  return json(200, { paid: true, changed: true });
});
