'use strict';

const MODEL = process.env.GEMINI_MODEL || 'gemini-4-hydrogen';
const SYSTEM_INSTRUCTION = `You are a helpful, general-purpose AI assistant built into LoadPay Hub. Answer the customer's actual question, whether it is about LoadPay Hub or another ordinary topic; do not limit yourself to website-support questions or generic greetings. Be useful, clear, and appropriately detailed. For LoadPay Hub questions, explain the steps for mobile load, data promos, bills, e-wallets, and payment methods.
Understand and reply in the language and writing system the customer uses, including languages other than English and Filipino, mixed-language messages, and transliteration. Match the customer's latest message; if they explicitly request another language, use that language. Do not claim you only support a fixed list of languages. If a message is genuinely unclear, ask a brief clarifying question in the language you can identify.
Use your general knowledge to answer what you can, but be honest about uncertainty and knowledge limitations. Do not claim to browse the internet, see this website's live data, or perform actions unless that information or capability is explicitly provided in the conversation. Treat the current prices and availability shown in the app as the source of truth.
You cannot access customer accounts, transactions, order status, payment-provider systems, or the website operator's private information, and you cannot place orders, take payments, deliver load, or issue refunds. Never claim any such action or status was completed. For account-specific requests, explain this limitation and guide the customer to their signed-in account/history screens or the website operator.
Never ask for passwords, one-time codes, full card details, or payment credentials. Keep answers respectful, safe, and relevant; when a request is outside your knowledge or capability, say so plainly and offer the most useful next step instead of inventing an answer.`;

const reply = (statusCode, body) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  },
  body: JSON.stringify(body)
});

async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return reply(405, { error: 'Use POST to send a message.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return reply(503, { error: 'The AI assistant is not configured yet. Please try again later.' });
  }

  if (!event.body || event.body.length > 20000) {
    return reply(400, { error: 'The message is empty or too large.' });
  }

  let input;
  try {
    input = JSON.parse(event.body);
  } catch (error) {
    return reply(400, { error: 'The message could not be read. Please try again.' });
  }

  if (!input || !Array.isArray(input.messages) || input.messages.length === 0) {
    return reply(400, { error: 'Please enter a message first.' });
  }

  const parsedMessages = input.messages.slice(-12).map(message => {
    if (!message || !['user', 'model'].includes(message.role) || typeof message.text !== 'string') {
      return null;
    }
    const text = message.text.trim();
    return text ? { role: message.role, parts: [{ text: text.slice(0, 1200) }] } : null;
  });

  if (parsedMessages.some(message => !message)) {
    return reply(400, { error: 'The conversation contains an invalid message. Please start a new chat.' });
  }
  const messages = parsedMessages;
  if (messages[0] && messages[0].role === 'model') messages.shift();
  if (!messages.length || messages[messages.length - 1].role !== 'user' ||
      messages.some((message, index) => index > 0 && message.role === messages[index - 1].role)) {
    return reply(400, { error: 'Please enter a valid message and try again.' });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const url = new URL(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`);
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      signal: controller.signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        contents: messages,
        generationConfig: { temperature: 0.4, maxOutputTokens: 1000 }
      })
    });

    if (!response.ok) {
      console.error('Gemini assistant request failed with status', response.status);
      if (response.status === 429) {
        return reply(503, { error: 'The AI assistant is busy right now. Please wait a moment and try again.' });
      }
      if (response.status === 400 || response.status === 403 || response.status === 404) {
        return reply(502, { error: 'The AI assistant could not answer right now. Please check the Gemini API key and model configuration.' });
      }
      return reply(502, { error: 'The AI assistant is temporarily unavailable. Please try again shortly.' });
    }

    const result = await response.json();
    const answer = (result.candidates || [])
      .flatMap(candidate => candidate.content && candidate.content.parts ? candidate.content.parts : [])
      .map(part => typeof part.text === 'string' ? part.text : '')
      .join('')
      .trim();

    if (!answer) {
      return reply(502, { error: 'The AI assistant returned an empty answer. Please try asking another way.' });
    }
    return reply(200, { answer });
  } catch (error) {
    console.error('Gemini assistant request failed:', error.name === 'AbortError' ? 'request timed out' : error.message);
    return reply(502, {
      error: error.name === 'AbortError'
        ? 'The AI assistant took too long to respond. Please try again.'
        : 'Could not connect to the AI assistant. Please check your connection and try again.'
    });
  } finally {
    clearTimeout(timeout);
  }
}

exports.handler = handler;
