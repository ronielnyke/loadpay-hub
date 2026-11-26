'use strict';

const MODEL = process.env.GEMINI_MODEL || 'gemini-4-hydrogen';
const SYSTEM_INSTRUCTION = `You are LoadPay Hub's customer support assistant. Help customers understand how to use this Philippine digital-services website for prepaid mobile load, data promos, bills payment, e-wallets, and payment methods.
Be friendly, concise, and comfortable replying in English or Filipino/Taglish to match the customer. Give simple steps based on the website flow: sign in, choose a service, enter the required details, review the order, then choose an available payment method. Explain that orders and payment status can only be checked inside the signed-in account; you do not have access to customer accounts, transactions, live prices, or payment-provider systems.
Never claim an order was placed, a payment was received, a load was delivered, or a refund was processed. Do not invent prices, promo details, service availability, or support contact details; tell the customer to check the current options shown in the app. Do not ask for passwords, one-time codes, full card details, or payment credentials. For account-specific issues, direct the customer to the app's account/history screens or the website operator.`;

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
        generationConfig: { temperature: 0.4, maxOutputTokens: 600 }
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
