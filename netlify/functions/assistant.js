'use strict';

const SYSTEM_INSTRUCTION = `You are a helpful, general-purpose AI assistant built into LoadPay Hub. Answer the customer's actual question, whether it is about LoadPay Hub or another ordinary topic; do not limit yourself to website-support questions or generic greetings. Be useful, clear, and appropriately detailed. For LoadPay Hub questions, explain the steps for mobile load, data promos, bills, e-wallets, and payment methods.
Understand and reply in the language and writing system the customer uses, including languages other than English and Filipino, mixed-language messages, and transliteration. Match the customer's latest message; if they explicitly request another language, use that language. Do not claim you only support a fixed list of languages. If a message is genuinely unclear, ask a brief clarifying question in the language you can identify.
Use your general knowledge to answer what you can, but be honest about uncertainty and knowledge limitations. Do not claim to browse the internet, see this website's live data, or perform actions unless that information or capability is explicitly provided in the conversation. Treat the current prices and availability shown in the app as the source of truth.
You cannot access customer accounts, transactions, order status, payment-provider systems, or the website operator's private information, and you cannot place orders, take payments, deliver load, or issue refunds. Never claim any such action or status was completed. For account-specific requests, explain this limitation and guide the customer to their signed-in account/history screens or the website operator.
Never ask for passwords, one-time codes, full card details, or payment credentials. Keep answers respectful, safe, and relevant; when a request is outside your knowledge or capability, say so plainly and offer the most useful next step instead of inventing an answer.`;

// Current supported model (gemini-2.0-flash was discontinued, use gemini-3.8-flash)
const GEMINI_MODEL = (process.env.GEMINI_MODEL || '').trim() || 'gemini-3.8-flash';

const reply = (statusCode, body) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  },
  body: JSON.stringify(body)
});

// Extract text from either Interactions API or generateContent response shapes
function extractText(result) {
  // Interactions API: steps[*].type === 'model_output', content[*].text
  const stepsText = (result.steps || [])
    .filter(s => s && s.type === 'model_output')
    .flatMap(s => Array.isArray(s.content) ? s.content : [])
    .map(p => (p && typeof p.text === 'string') ? p.text : '')
    .join('')
    .trim();
  if (stepsText) return stepsText;

  // Interactions API outputs fallback
  const outputsText = (result.outputs || [])
    .flatMap(o => Array.isArray(o && o.content) ? o.content : (o && typeof o.text === 'string' ? [o] : []))
    .map(p => (p && typeof p.text === 'string') ? p.text : '')
    .join('')
    .trim();
  if (outputsText) return outputsText;

  // generateContent response: candidates[0].content.parts[*].text
  return (result.candidates || [])
    .flatMap(c => (c && c.content && Array.isArray(c.content.parts)) ? c.content.parts : [])
    .map(p => (p && typeof p.text === 'string') ? p.text : '')
    .join('')
    .trim();
}

// PRIMARY: Interactions API
// NOTE: system_instruction MUST be a plain string for the Interactions API (not an object)
async function callInteractionsAPI(apiKey, messages, signal) {
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
      'Api-Revision': '2026-05-20'
    },
    signal,
    body: JSON.stringify({
      model: GEMINI_MODEL,
      system_instruction: SYSTEM_INSTRUCTION,          // plain string — required by Interactions API
      input: messages.map(m => ({
        type: m.role === 'user' ? 'user_input' : 'model_output',
        content: m.parts.map(p => ({ type: 'text', text: p.text }))
      })),
      generation_config: { temperature: 0.4, thinking_level: 'low', max_output_tokens: 1000 },
      store: false
    })
  });
  return response;
}

// FALLBACK: generateContent API
// NOTE: system_instruction MUST be an object { parts: [{ text }] } for generateContent
async function callGenerateContent(apiKey, messages, signal) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_INSTRUCTION }] }, // object — required by generateContent
      contents: messages,
      generationConfig: { temperature: 0.4, maxOutputTokens: 1000 }
    })
  });
  return response;
}

async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return reply(405, { error: 'Use POST to send a message.' });
  }

  const apiKey = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
  if (!apiKey) {
    console.error('Gemini assistant: GEMINI_API_KEY is not set.');
    return reply(503, {
      error: 'AI setup is incomplete: add GEMINI_API_KEY to the Netlify Function environment variables, then redeploy.'
    });
  }

  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : (event.body || '');
  if (!rawBody || rawBody.length > 20000) {
    return reply(400, { error: 'The message is empty or too large.' });
  }

  let input;
  try {
    input = JSON.parse(rawBody);
  } catch (e) {
    return reply(400, { error: 'The message could not be read. Please try again.' });
  }

  if (!input || !Array.isArray(input.messages) || input.messages.length === 0) {
    return reply(400, { error: 'Please enter a message first.' });
  }

  const parsedMessages = input.messages.slice(-12).map(m => {
    if (!m || !['user', 'model'].includes(m.role) || typeof m.text !== 'string') return null;
    const text = m.text.trim();
    return text ? { role: m.role, parts: [{ text: text.slice(0, 1200) }] } : null;
  });

  if (parsedMessages.some(m => !m)) {
    return reply(400, { error: 'The conversation contains an invalid message. Please start a new chat.' });
  }
  const messages = parsedMessages;
  if (messages[0] && messages[0].role === 'model') messages.shift();
  if (!messages.length || messages[messages.length - 1].role !== 'user' ||
      messages.some((m, i) => i > 0 && m.role === messages[i - 1].role)) {
    return reply(400, { error: 'Please enter a valid message and try again.' });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);

  try {
    // ── Try Interactions API first ──
    let response;
    let triedFallback = false;

    try {
      response = await callInteractionsAPI(apiKey, messages, controller.signal);
    } catch (fetchErr) {
      if (fetchErr.name === 'AbortError') throw fetchErr;
      console.warn('Interactions API network error, trying generateContent:', fetchErr.message);
      response = await callGenerateContent(apiKey, messages, controller.signal);
      triedFallback = true;
    }

    // If Interactions API gave a hard error (not 429/auth), try generateContent
    if (!triedFallback && !response.ok && response.status !== 429 &&
        response.status !== 401 && response.status !== 403) {
      const errBody = await response.json().catch(() => ({}));
      console.warn('Interactions API returned', response.status, JSON.stringify(errBody).slice(0, 200),
        '— trying generateContent fallback');
      try {
        const fb = await callGenerateContent(apiKey, messages, controller.signal);
        if (fb.ok) {
          response = fb;
          triedFallback = true;
        } else {
          // Both failed — stick with Interactions API error for reporting
          console.error('Both APIs failed. Interactions:', response.status, 'generateContent:', fb.status);
        }
      } catch (fbErr) {
        if (fbErr.name === 'AbortError') throw fbErr;
        console.warn('generateContent fallback also threw:', fbErr.message);
      }
    }

    if (!response.ok) {
      const providerResult = await response.json().catch(() => ({}));
      const providerError = providerResult.error || {};
      console.error('Gemini request failed', {
        httpStatus: response.status,
        providerStatus: providerError.status || 'unknown',
        providerCode: providerError.code || 'unknown',
        providerMessage: (providerError.message || '').slice(0, 300)
      });

      if (response.status === 429 || providerError.status === 'RESOURCE_EXHAUSTED') {
        return reply(503, { error: 'AI quota or rate limit reached. Please try again in a few minutes.' });
      }
      if (response.status === 401 || response.status === 403) {
        return reply(502, { error: 'AI API key is invalid or expired. Please contact the site administrator.' });
      }
      return reply(502, { error: 'The AI assistant is temporarily unavailable. Please try again shortly.' });
    }

    const result = await response.json();
    const answer = extractText(result);

    if (!answer) {
      console.error('Empty answer from Gemini. Response keys:', Object.keys(result || {}).join(', '));
      return reply(502, { error: 'The AI assistant returned an empty answer. Please try asking another way.' });
    }
    return reply(200, { answer });

  } catch (error) {
    const isAbort = error.name === 'AbortError';
    console.error('Gemini assistant error:', isAbort ? 'timed out' : error.message);
    return reply(502, {
      error: isAbort
        ? 'The AI assistant took too long to respond. Please try again.'
        : 'Could not connect to the AI assistant. Please check your connection and try again.'
    });
  } finally {
    clearTimeout(timeout);
  }
}

exports.handler = handler;
