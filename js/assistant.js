(() => {
  'use strict';

  const launcher = document.getElementById('aiLauncher');
  const panel = document.getElementById('aiPanel');
  const messagesEl = document.getElementById('aiMessages');
  const form = document.getElementById('aiForm');
  const input = document.getElementById('aiInput');
  const sendButton = document.getElementById('aiSend');
  const closeButton = document.getElementById('aiClose');
  const clearButton = document.getElementById('aiClear');
  if (!launcher || !panel || !messagesEl || !form || !input || !sendButton) return;

  const welcome = messagesEl.innerHTML;
  const conversation = [];
  let sending = false;

  function scrollToLatest() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function addMessage(role, text) {
    const message = document.createElement('div');
    message.className = `ai-message ${role === 'user' ? 'ai-message-user' : 'ai-message-assistant'}`;
    message.textContent = text;
    messagesEl.appendChild(message);
    scrollToLatest();
    return message;
  }

  function setOpen(open) {
    panel.hidden = !open;
    launcher.setAttribute('aria-expanded', String(open));
    if (open) {
      panel.classList.remove('ai-opening');
      requestAnimationFrame(() => panel.classList.add('ai-opening'));
    }
    if (open && window.matchMedia('(min-width: 576px)').matches) input.focus();
    else if (!open) launcher.focus();
  }

  function setSending(value) {
    sending = value;
    input.disabled = value;
    sendButton.disabled = value;
    sendButton.innerHTML = value
      ? '<span class="ai-send-spinner" aria-hidden="true"></span>'
      : '<i class="bi bi-arrow-up" aria-hidden="true"></i>';
    sendButton.setAttribute('aria-label', value ? 'Sending message' : 'Send message');
  }

  async function sendMessage(rawText) {
    const text = rawText.trim();
    if (!text || sending) return;

    messagesEl.querySelector('.ai-welcome')?.remove();
    conversation.push({ role: 'user', text });
    addMessage('user', text);
    input.value = '';
    input.style.height = '';
    setSending(true);

    const typing = document.createElement('div');
    typing.className = 'ai-message ai-message-assistant ai-typing';
    typing.setAttribute('aria-label', 'Assistant is thinking');
    typing.innerHTML = '<i></i><i></i><i></i>';
    messagesEl.appendChild(typing);
    scrollToLatest();

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 25000);
      let response;
      try {
        response = await fetch('/.netlify/functions/assistant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: conversation.slice(-12) }),
          signal: controller.signal
        });
      } finally {
        clearTimeout(timeout);
      }

      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'The assistant is unavailable. Please try again.');
      if (typeof result.answer !== 'string' || !result.answer.trim()) {
        throw new Error('The assistant returned an empty answer. Please try again.');
      }
      conversation.push({ role: 'model', text: result.answer.trim() });
      typing.remove();
      addMessage('assistant', result.answer.trim());
    } catch (error) {
      if (conversation.length && conversation[conversation.length - 1].role === 'user') {
        conversation.pop();
      }
      typing.remove();
      addMessage('assistant', error.name === 'AbortError'
        ? 'The assistant took too long to respond. Please try again.'
        : error.message || 'Could not reach the assistant. Please check your connection and try again.');
    } finally {
      setSending(false);
      input.focus();
    }
  }

  launcher.addEventListener('click', () => setOpen(panel.hidden));
  closeButton?.addEventListener('click', () => setOpen(false));
  clearButton?.addEventListener('click', () => {
    if (sending) return;
    conversation.length = 0;
    messagesEl.innerHTML = welcome;
    scrollToLatest();
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    sendMessage(input.value);
  });
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 100)}px`;
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  messagesEl.addEventListener('click', event => {
    const button = event.target.closest('[data-prompt]');
    if (button) sendMessage(button.dataset.prompt);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !panel.hidden) setOpen(false);
  });
})();
