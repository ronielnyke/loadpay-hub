'use strict';

const { createCheckout, parseBody } = require('./_lib/payment');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'POST only' });
  }

  try {
    const checkout = await createCheckout(parseBody(req));
    return res.status(200).json(checkout);
  } catch (error) {
    console.error(error);
    const status = Number.isInteger(error.status) ? error.status : 500;
    return res.status(status).json({
      error: status >= 500 ? (error.status ? error.message : 'Payment service error.') : error.message
    });
  }
};
