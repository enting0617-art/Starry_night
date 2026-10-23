import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { projectRoot } from './config.js';

const database = new DatabaseSync(join(projectRoot, 'data', 'chat.sqlite'));
const MAX_RECENT_CHARACTERS = 14_000;
const MAX_SUMMARY_CHARACTERS = 2_400;

database.exec(`
  CREATE TABLE IF NOT EXISTS conversation_summaries (
    conversation_id TEXT PRIMARY KEY,
    summary TEXT NOT NULL,
    source_message_count INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  );
`);

function cleanText(value, limit = 900) {
  return String(value || '').replace(/\s+/gu, ' ').trim().slice(0, limit);
}

function messageText(message) {
  const role = message?.role === 'assistant' ? '星空' : '用户';
  const text = cleanText(message?.content, 700);
  return text ? `${role}：${text}` : '';
}

function makeSummary(messages) {
  const lines = messages.map(messageText).filter(Boolean);
  if (!lines.length) return '';
  let summary = '';
  for (const line of lines) {
    const next = summary ? `${summary}\n${line}` : line;
    if (next.length > MAX_SUMMARY_CHARACTERS) break;
    summary = next;
  }
  return summary;
}

export function buildShortTermContext({ conversationId, messages }) {
  const source = Array.isArray(messages) ? messages : [];
  let used = 0;
  let splitAt = source.length;
  for (let index = source.length - 1; index >= 0; index -= 1) {
    const size = String(source[index]?.content || '').length;
    if (used + size > MAX_RECENT_CHARACTERS && index < source.length - 1) break;
    used += size;
    splitAt = index;
  }
  const earlier = source.slice(0, splitAt);
  const recent = source.slice(splitAt);
  const freshSummary = makeSummary(earlier);
  if (!conversationId || !earlier.length) return { recent, summary: freshSummary };
  if (freshSummary) {
    database.prepare(`INSERT INTO conversation_summaries (conversation_id, summary, source_message_count, updated_at)
      VALUES (?, ?, ?, ?) ON CONFLICT(conversation_id) DO UPDATE SET summary = excluded.summary, source_message_count = excluded.source_message_count, updated_at = excluded.updated_at`)
      .run(String(conversationId).slice(0, 100), freshSummary, earlier.length, Date.now());
  }
  return { recent, summary: freshSummary };
}

export function getConversationSummary(conversationId) {
  if (!conversationId) return null;
  return database.prepare('SELECT conversation_id AS conversationId, summary, source_message_count AS sourceMessageCount, updated_at AS updatedAt FROM conversation_summaries WHERE conversation_id = ?')
    .get(String(conversationId).slice(0, 100)) || null;
}
