import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { loadConfig, projectRoot } from './config.js';

const database = new DatabaseSync(join(projectRoot, 'data', 'chat.sqlite'));
database.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    messages_json TEXT NOT NULL DEFAULT '[]',
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS app_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC);
`);

export function loadConversations() {
  const conversations = database.prepare('SELECT id, title, messages_json AS messagesJson, updated_at AS updatedAt FROM conversations ORDER BY updated_at DESC').all()
    .map(({ messagesJson, ...row }) => {
      try { return { ...row, messages: JSON.parse(messagesJson) }; } catch { return { ...row, messages: [] }; }
    });
  const activeId = database.prepare("SELECT value FROM app_state WHERE key = 'activeConversationId'").get()?.value || conversations[0]?.id || '';
  return { conversations, activeId };
}

export async function saveConversations({ conversations, activeId }) {
  const config = await loadConfig();
  if (!Array.isArray(conversations)) throw new Error('聊天记录格式无效。');
  if (conversations.length > config.history.maxConversations) throw new Error(`对话数量不能超过 ${config.history.maxConversations}。`);
  const serializedPayload = JSON.stringify(conversations);
  if (Buffer.byteLength(serializedPayload) > config.history.maxPayloadBytes) throw new Error(`聊天记录总大小不能超过 ${Math.round(config.history.maxPayloadBytes / 1048576)}MB。`);
  const cleaned = conversations.map((conversation) => {
    if (!conversation?.id || !Array.isArray(conversation.messages)) throw new Error('对话缺少编号或消息列表。');
    if (conversation.messages.length > config.history.maxMessagesPerConversation) throw new Error(`单个对话不能超过 ${config.history.maxMessagesPerConversation} 条消息。`);
    return {
      id: String(conversation.id).slice(0, 100),
      title: String(conversation.title || '新对话').slice(0, 120),
      messagesJson: JSON.stringify(conversation.messages),
      updatedAt: Number(conversation.updatedAt) || Date.now(),
    };
  });
  const upsert = database.prepare(`INSERT INTO conversations (id, title, messages_json, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET title = excluded.title, messages_json = excluded.messages_json, updated_at = excluded.updated_at`);
  database.exec('BEGIN IMMEDIATE');
  try {
    for (const row of cleaned) upsert.run(row.id, row.title, row.messagesJson, row.updatedAt);
    if (cleaned.length) {
      const placeholders = cleaned.map(() => '?').join(',');
      database.prepare(`DELETE FROM conversations WHERE id NOT IN (${placeholders})`).run(...cleaned.map((row) => row.id));
    } else database.exec('DELETE FROM conversations');
    database.prepare("INSERT INTO app_state (key, value) VALUES ('activeConversationId', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(activeId || cleaned[0]?.id || ''));
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
  return { saved: cleaned.length, activeId: String(activeId || cleaned[0]?.id || '') };
}
