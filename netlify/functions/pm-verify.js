// POST { txId, idToken } -> { paid, changed }   Asks PayMongo if the order was really paid, then marks it Success.
const { json, httpErr, wrap, verifyUser, isOwner, getTx, patchTx, pm } = require('./lib/common');

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
  const at = j.data.attributes || {}, pays = at.payments || [], pi = at.payment_intent;
  const pay = pays.find(p => p.attributes && p.attributes.status === 'paid');
  const paid = !!pay || !!(pi && pi.attributes && pi.attributes.status === 'succeeded');
  if (!paid) return json(200, { paid: false, status: (pi && pi.attributes && pi.attributes.status) || 'pending' });
  if (pay && Number(pay.attributes.amount) < Math.round(Number(tx.amount) * 100)) return json(200, { paid: false, reason: 'amount-mismatch' });
  await patchTx(tx.id, { status: 'Success', ref: String(pay ? pay.id : (at.reference_number || tx.pmId)), updated: Date.now(), paidVia: String(tx.method) });
  return json(200, { paid: true, changed: true });
});
