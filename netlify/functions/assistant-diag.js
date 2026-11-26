'use strict';
// TEMPORARY DIAGNOSTIC — delete after debugging
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'POST only' };
  }
  const apiKey = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
  if (!apiKey) {
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'NO_API_KEY' }) };
  }

  const SYS = 'You are a helpful assistant.';
  const MODEL = 'gemini-3.8-flash';

  // Test 1: Interactions API with plain string system_instruction
  let intStatus, intBody;
  try {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey, 'Api-Revision': '2026-05-20' },
      body: JSON.stringify({
        model: MODEL,
        system_instruction: SYS,  // plain string
        input: [{ type: 'user_input', content: [{ type: 'text', text: 'Say hi in one word.' }] }],
        generation_config: { temperature: 0.4, max_output_tokens: 50 },
        store: false
      })
    });
    intStatus = r.status;
    intBody = (await r.text()).slice(0, 600);
  } catch (e) { intStatus = 'FETCH_ERROR'; intBody = e.message; }

  // Test 2: generateContent with object system_instruction
  let gcStatus, gcBody;
  try {
    const r2 = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYS }] },
          contents: [{ role: 'user', parts: [{ text: 'Say hi in one word.' }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 50 }
        })
      }
    );
    gcStatus = r2.status;
    gcBody = (await r2.text()).slice(0, 600);
  } catch (e) { gcStatus = 'FETCH_ERROR'; gcBody = e.message; }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, keyLen: apiKey.length,
      interactionsAPI: { status: intStatus, body: intBody },
      generateContent: { status: gcStatus, body: gcBody }
    }, null, 2)
  };
};
