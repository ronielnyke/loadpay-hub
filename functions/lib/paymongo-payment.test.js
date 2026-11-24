const test = require('node:test');
const assert = require('node:assert/strict');
const { isConfirmedCheckout } = require('./paymongo-payment');

const tx = { id: 'LPH-ORDER-1', amount: 125, uid: 'user-1' };
const checkout = overrides => ({
  id: 'cs_test_1',
  attributes: {
    status: 'paid',
    reference_number: tx.id,
    payments: [{
      id: 'pay_1',
      attributes: { status: 'paid', amount: 12500, currency: 'PHP' }
    }],
    ...overrides
  }
});

test('confirms a paid PHP checkout with the exact order reference and amount', () => {
  assert.equal(isConfirmedCheckout(checkout(), tx), true);
});

test('rejects unpaid, misreferenced, underpaid, and wrong-currency checkouts', () => {
  assert.equal(isConfirmedCheckout(checkout({ status: 'active' }), tx), false);
  assert.equal(isConfirmedCheckout(checkout({ reference_number: 'ANOTHER-ORDER' }), tx), false);
  assert.equal(isConfirmedCheckout(checkout({
    payments: [{ attributes: { status: 'paid', amount: 12499, currency: 'PHP' } }]
  }), tx), false);
  assert.equal(isConfirmedCheckout(checkout({
    payments: [{ attributes: { status: 'paid', amount: 12500, currency: 'USD' } }]
  }), tx), false);
});

test('confirms a successful PHP payment intent only for the exact amount', () => {
  assert.equal(isConfirmedCheckout(checkout({
    payments: [],
    payment_intent: { attributes: { status: 'succeeded', amount: 12500, currency: 'PHP' } }
  }), tx), true);
  assert.equal(isConfirmedCheckout(checkout({
    payments: [],
    payment_intent: { attributes: { status: 'succeeded', amount: 12501, currency: 'PHP' } }
  }), tx), false);
});
