'use strict';
// TEMPORARY DIAGNOSTIC — delete after debugging
// DO NOT LEAVE THIS IN PRODUCTION (it echoes API details)
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'POST only' };
  }
  const apiKey = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
  if (!apiKey) {
    return { statusCode: 200, headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ error: 'NO_API_KEY', keyLen: 0 }) };
  }

  const messages = [{ role: 'user', parts: [{ text: 'Say hi in one word.' }] }];

  // Test generateContent
  let gcStatus, gcBody;
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: 'You are a helpful assistant.' }] },
          contents: messages,
          generationConfig: { temperature: 0.4, maxOutputTokens: 50 }
        })
      }
    );
    gcStatus = r.status;
    gcBody = (await r.text()).slice(0, 500);
  } catch (e) {
    gcStatus = 'FETCH_ERROR';
    gcBody = e.message;
  }

  // Test Interactions API
  let intStatus, intBody;
  try {
    const r2 = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
        'Api-Revision': '2026-05-20'
      },
      body: JSON.stringify({
        model: 'gemini-2.0-flash',
        system_instruction: { parts: [{ text: 'You are a helpful assistant.' }] },
        input: [{ type: 'user_input', content: [{ type: 'text', text: 'Say hi in one word.' }] }],
        generation_config: { temperature: 0.4, max_output_tokens: 50 },
        store: false
      })
    });
    intStatus = r2.status;
    intBody = (await r2.text()).slice(0, 500);
  } catch (e) {
    intStatus = 'FETCH_ERROR';
    intBody = e.message;
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      keyLen: apiKey.length,
      keyPrefix: apiKey.slice(0, 8) + '...',
      generateContent: { status: gcStatus, body: gcBody },
      interactionsAPI: { status: intStatus, body: intBody }
    }, null, 2)
  };
};
