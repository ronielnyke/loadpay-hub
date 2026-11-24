function isConfirmedCheckout(checkout, tx) {
  const attributes = checkout && checkout.attributes;
  const amount = Math.round(Number(tx.amount) * 100);
  if (!attributes || attributes.status !== 'paid' || attributes.reference_number !== tx.id ||
      !Number.isSafeInteger(amount) || amount < 1) return false;

  const paymentConfirmed = (attributes.payments || []).some(payment => {
    const paymentAttributes = payment && payment.attributes;
    return paymentAttributes &&
      paymentAttributes.status === 'paid' &&
      Number(paymentAttributes.amount) === amount &&
      String(paymentAttributes.currency || '').toUpperCase() === 'PHP';
  });

  const intent = attributes.payment_intent && attributes.payment_intent.attributes;
  const intentConfirmed = intent &&
    intent.status === 'succeeded' &&
    Number(intent.amount) === amount &&
    String(intent.currency || '').toUpperCase() === 'PHP';

  return !!(paymentConfirmed || intentConfirmed);
}

module.exports = { isConfirmedCheckout };
