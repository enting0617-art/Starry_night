import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { projectRoot } from './config.js';

const database = new DatabaseSync(join(projectRoot, 'data', 'chat.sqlite'));
database.exec(`
  CREATE TABLE IF NOT EXISTS companion_preferences (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS companion_proactive_state (
    conversation_id TEXT PRIMARY KEY,
    last_proactive_at INTEGER NOT NULL DEFAULT 0
  );
`);

const defaults = Object.freeze({ enabled: false, idleMinutes: 180, checkSeconds: 60 });

function read(key, fallback) {
  const value = database.prepare('SELECT value FROM companion_preferences WHERE key = ?').get(key)?.value;
  if (value === undefined) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function write(key, value) {
  database.prepare(`INSERT INTO companion_preferences (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, JSON.stringify(value));
}

export function getCompanionPreferences() {
  return {
    enabled: Boolean(read('proactive.enabled', defaults.enabled)),
    idleMinutes: Math.min(1440, Math.max(15, Number(read('proactive.idleMinutes', defaults.idleMinutes)) || defaults.idleMinutes)),
    checkSeconds: defaults.checkSeconds,
  };
}

export function updateCompanionPreferences(value = {}) {
  const current = getCompanionPreferences();
  const next = {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : current.enabled,
    idleMinutes: Math.min(1440, Math.max(15, Number(value.idleMinutes ?? current.idleMinutes) || current.idleMinutes)),
  };
  write('proactive.enabled', next.enabled);
  write('proactive.idleMinutes', next.idleMinutes);
  return { ...next, checkSeconds: defaults.checkSeconds };
}

function messageTime(message, fallback) {
  return Number(message?.createdAt || message?.timestamp || fallback || 0) || fallback;
}

export function shouldSendProactiveMessage({ conversation, now = Date.now() }) {
  const preferences = getCompanionPreferences();
  if (!preferences.enabled || !conversation?.id || !Array.isArray(conversation.messages)) return { due: false, preferences, reason: 'disabled' };
  const messages = conversation.messages;
  const latest = messages.at(-1);
  if (latest?.role === 'assistant' && latest.proactive) return { due: false, preferences, reason: 'already-sent' };
  let lastUserAt = 0;
  for (const message of messages) if (message.role === 'user') lastUserAt = Math.max(lastUserAt, messageTime(message, conversation.updatedAt));
  if (!lastUserAt) return { due: false, preferences, reason: 'no-user-message' };
  if (now - lastUserAt < preferences.idleMinutes * 60_000) return { due: false, preferences, reason: 'not-idle' };
  const previous = database.prepare('SELECT last_proactive_at AS lastProactiveAt FROM companion_proactive_state WHERE conversation_id = ?').get(conversation.id)?.lastProactiveAt || 0;
  if (previous >= lastUserAt) return { due: false, preferences, reason: 'already-sent' };
  return { due: true, preferences, lastUserAt };
}

export function markProactiveMessage(conversationId, timestamp = Date.now()) {
  database.prepare(`INSERT INTO companion_proactive_state (conversation_id, last_proactive_at) VALUES (?, ?)
    ON CONFLICT(conversation_id) DO UPDATE SET last_proactive_at = excluded.last_proactive_at`).run(conversationId, timestamp);
}
