const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('./pm-status');

function response() {
  return {
    headers: {},
    statusCode: 0,
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }
  };
}

test('reports payments unavailable unless both server credentials are configured', async () => {
  const oldKey = process.env.PAYMONGO_SECRET_KEY;
  const oldAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
  delete process.env.PAYMONGO_SECRET_KEY;
  delete process.env.FIREBASE_SERVICE_ACCOUNT;

  try {
    const res = response();
    await handler({ method: 'GET' }, res);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.mode, 'test');
    assert.equal(res.headers['Cache-Control'], 'no-store');
  } finally {
    if (oldKey === undefined) delete process.env.PAYMONGO_SECRET_KEY;
    else process.env.PAYMONGO_SECRET_KEY = oldKey;
    if (oldAccount === undefined) delete process.env.FIREBASE_SERVICE_ACCOUNT;
    else process.env.FIREBASE_SERVICE_ACCOUNT = oldAccount;
  }
});

test('reports live mode only when the server key and Firebase credential are configured', async () => {
  const oldKey = process.env.PAYMONGO_SECRET_KEY;
  const oldAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
  process.env.PAYMONGO_SECRET_KEY = 'sk_live_configured';
  process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({
    project_id: 'loadpay-hub',
    client_email: 'firebase-admin@example.iam.gserviceaccount.com',
    private_key: 'configured'
  });

  try {
    const res = response();
    await handler({ method: 'GET' }, res);
    assert.deepEqual(res.body, { ok: true, mode: 'live' });

    process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({
      project_id: 'a-different-project',
      client_email: 'firebase-admin@example.iam.gserviceaccount.com',
      private_key: 'configured'
    });
    const wrongProject = response();
    await handler({ method: 'GET' }, wrongProject);
    assert.equal(wrongProject.body.ok, false);
  } finally {
    if (oldKey === undefined) delete process.env.PAYMONGO_SECRET_KEY;
    else process.env.PAYMONGO_SECRET_KEY = oldKey;
    if (oldAccount === undefined) delete process.env.FIREBASE_SERVICE_ACCOUNT;
    else process.env.FIREBASE_SERVICE_ACCOUNT = oldAccount;
  }
});

test('rejects requests with the wrong HTTP method', async () => {
  const res = response();
  await handler({ method: 'POST' }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.Allow, 'GET');
});
