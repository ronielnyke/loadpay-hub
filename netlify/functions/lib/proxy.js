'use strict';

const FUNCTIONS_URL = process.env.FIREBASE_PAYMENT_FUNCTIONS_URL ||
  'https://asia-southeast1-loadpay-hub.cloudfunctions.net';
const APP_ORIGIN = 'https://lambaconnect.netlify.app';

function proxy(functionName) {
  return async event => {
    try {
      const headers = { Origin: APP_ORIGIN };
      if (event.httpMethod !== 'GET' && event.body) headers['Content-Type'] = 'application/json';
      const body = event.isBase64Encoded
        ? Buffer.from(event.body || '', 'base64').toString('utf8')
        : event.body;
      const response = await fetch(`${FUNCTIONS_URL}/${functionName}`, {
        method: event.httpMethod,
        headers,
        body: event.httpMethod === 'GET' || event.httpMethod === 'HEAD' ? undefined : body
      });
      return {
        statusCode: response.status,
        headers: {
          'Content-Type': response.headers.get('content-type') || 'application/json',
          'Cache-Control': 'no-store'
        },
        body: await response.text()
      };
    } catch (error) {
      console.error(`Firebase Functions proxy failed (${functionName})`, error);
      return {
        statusCode: 502,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        body: JSON.stringify({ error: 'Payment service is temporarily unavailable.' })
      };
    }
  };
}

module.exports = { proxy };
