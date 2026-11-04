'use strict';

const { completeText } = require('./providers');

const MAX_LENGTH = 64;
const TIMEOUT_MS = 12000;

const SYSTEM = [
  'You name conversations. Reply with only a short, specific title.',
  'Use 2 to 6 words, the language the user writes in, and no trailing punctuation.',
  'Describe the work, not the greeting. Never answer the question and never explain.',
].join(' ');

function firstText(session, role) {
  for (const message of session?.messages || []) {
    if (message?.role !== role) continue;
    const text = String(message.content || '').replace(/```[\s\S]*?```/g, ' ').replace(/\s+/g, ' ').trim();
    if (text) return text;
  }
  return '';
}

function cleanTitle(raw) {
  let text = String(raw || '')
    .replace(/```[a-z0-9_-]*/gi, ' ')
    .replace(/\r/g, '\n');
  text = text.split('\n').map((line) => line.trim()).find(Boolean) || '';
  text = text.replace(/^#{1,6}\s*/, '').replace(/^[-*•]\s+/, '');
  text = text.replace(/^(title|제목|会话标题|タイトル)\s*[:：-]\s*/i, '');
  text = text.replace(/^["'“”‘’「」『』`*]+/, '').replace(/["'“”‘’「」『』`*]+$/, '');
  text = text.replace(/\s+/g, ' ').trim();
  text = text.replace(/[.!?,;:。！？、]+$/g, '').trim();
  if (text.length < 2) return '';
  if (/^(new session|untitled|새 세션|새 대화)$/i.test(text)) return '';
  if (text.length > MAX_LENGTH) {
    const clipped = text.slice(0, MAX_LENGTH);
    const space = clipped.lastIndexOf(' ');
    text = (space >= 24 ? clipped.slice(0, space) : clipped).trimEnd();
    text += '…';
  }
  return text;
}

function canAutoTitle(session) {
  if (!session || !Array.isArray(session.messages)) return false;
  // Sessions from before this field existed keep their titles; only sessions
  // created by this build opt in to automatic naming.
  if (!session.titleSource || session.titleSource === 'manual' || session.titleGeneratedAt) return false;
  return Boolean(firstText(session, 'user') && firstText(session, 'assistant'));
}

function titlePrompt(session) {
  const user = firstText(session, 'user').slice(0, 1600);
  const assistant = firstText(session, 'assistant').slice(0, 900);
  return `User:\n${user}\n\nAssistant:\n${assistant}`;
}

/**
 * Name a session once, from its first real exchange. Failures keep the
 * provisional title and are not retried on every turn.
 */
async function generateSessionTitle({ session, config, modelId, signal, complete = completeText } = {}) {
  if (!canAutoTitle(session)) return { changed: false, skipped: true };
  if (!modelId) return { changed: false, skipped: true };

  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', forwardAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const attemptedAt = new Date().toISOString();
  let raw = '';
  try {
    raw = await complete({
      modelId,
      config,
      system: SYSTEM,
      messages: [{ role: 'user', content: titlePrompt(session) }],
      signal: controller.signal,
      maxTokens: 48,
    });
  } catch (error) {
    if (signal?.aborted) {
      return { changed: false, aborted: true, error: error.message };
    }
    session.titleGeneratedAt = attemptedAt;
    return { changed: false, error: error.message || 'Title request failed.' };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
  }

  session.titleGeneratedAt = attemptedAt;
  const title = cleanTitle(raw);
  if (!title || session.titleSource === 'manual') return { changed: false, title: '' };
  session.title = title;
  session.titleSource = 'auto';
  return { changed: true, title };
}

module.exports = {
  cleanTitle,
  canAutoTitle,
  generateSessionTitle,
  titlePrompt,
  MAX_LENGTH,
};
