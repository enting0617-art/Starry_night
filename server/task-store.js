import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { projectRoot } from './config.js';

const database = new DatabaseSync(join(projectRoot, 'data', 'chat.sqlite'));
const statuses = new Set(['active', 'blocked', 'done', 'archived']);

database.exec(`
  CREATE TABLE IF NOT EXISTS companion_tasks (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    title TEXT NOT NULL,
    goal TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    current_state TEXT NOT NULL DEFAULT '',
    next_step TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_companion_tasks_conversation ON companion_tasks(conversation_id, updated_at DESC);
`);
const taskColumns = new Set(database.prepare('PRAGMA table_info(companion_tasks)').all().map((column) => column.name));
if (!taskColumns.has('workspace_path')) database.exec('ALTER TABLE companion_tasks ADD COLUMN workspace_path TEXT');
if (!taskColumns.has('messages_json')) database.exec("ALTER TABLE companion_tasks ADD COLUMN messages_json TEXT NOT NULL DEFAULT '[]'");

function clean(value, limit) {
  return String(value || '').replace(/\s+/gu, ' ').trim().slice(0, limit);
}

function row(item) {
  let messages;
  try { messages = JSON.parse(item.messages_json || '[]'); } catch { messages = []; }
  return {
    id: item.id,
    conversationId: item.conversation_id,
    title: item.title,
    goal: item.goal,
    status: item.status,
    currentState: item.current_state,
    nextStep: item.next_step,
    workspacePath: item.workspace_path || '',
    chatConversationId: `task-${item.id}`,
    messages: Array.isArray(messages) ? messages : [],
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  };
}

export function listTasks(conversationId) {
  const query = conversationId
    ? database.prepare('SELECT * FROM companion_tasks WHERE conversation_id = ? ORDER BY updated_at DESC')
    : database.prepare("SELECT * FROM companion_tasks WHERE status != 'archived' ORDER BY updated_at DESC");
  return (conversationId ? query.all(String(conversationId)) : query.all()).map(row);
}

export function createTask(value = {}) {
  const goal = clean(value.goal, 800);
  const conversationId = clean(value.conversationId, 100);
  if (!conversationId || !goal) throw new Error('任务需要关联当前对话，并填写目标。');
  const now = new Date().toISOString();
  const title = clean(value.title, 120);
  if (!/^[A-Za-z][A-Za-z0-9_-]{1,63}$/u.test(title)) throw new Error('任务英文名必须以字母开头，只能包含英文字母、数字、- 和 _，长度为 2–64 个字符。');
  const item = {
    id: globalThis.crypto.randomUUID(), conversationId, title, goal,
    status: 'active', currentState: clean(value.currentState, 1000), nextStep: clean(value.nextStep, 500), workspacePath: clean(value.workspacePath, 1000), messages: [], createdAt: now, updatedAt: now,
  };
  database.prepare(`INSERT INTO companion_tasks (id, conversation_id, title, goal, status, current_state, next_step, workspace_path, messages_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(item.id, item.conversationId, item.title, item.goal, item.status, item.currentState, item.nextStep, item.workspacePath, '[]', item.createdAt, item.updatedAt);
  return row(database.prepare('SELECT * FROM companion_tasks WHERE id = ?').get(item.id));
}

export function updateTask(id, changes = {}) {
  const existing = database.prepare('SELECT * FROM companion_tasks WHERE id = ?').get(String(id));
  if (!existing) return null;
  const item = row(existing);
  const next = {
    ...item,
    title: Object.hasOwn(changes, 'title') ? clean(changes.title, 120) || item.title : item.title,
    goal: Object.hasOwn(changes, 'goal') ? clean(changes.goal, 800) || item.goal : item.goal,
    currentState: Object.hasOwn(changes, 'currentState') ? clean(changes.currentState, 1000) : item.currentState,
    nextStep: Object.hasOwn(changes, 'nextStep') ? clean(changes.nextStep, 500) : item.nextStep,
    status: statuses.has(String(changes.status)) ? String(changes.status) : item.status,
    updatedAt: new Date().toISOString(),
  };
  database.prepare(`UPDATE companion_tasks SET title = ?, goal = ?, status = ?, current_state = ?, next_step = ?, updated_at = ? WHERE id = ?`)
    .run(next.title, next.goal, next.status, next.currentState, next.nextStep, next.updatedAt, next.id);
  return next;
}

export function removeTask(id) {
  return database.prepare('DELETE FROM companion_tasks WHERE id = ?').run(String(id)).changes > 0;
}

export function setTaskWorkspace(id, workspacePath) {
  const updatedAt = new Date().toISOString();
  const result = database.prepare('UPDATE companion_tasks SET workspace_path = ?, updated_at = ? WHERE id = ?')
    .run(String(workspacePath || ''), updatedAt, String(id));
  if (!result.changes) return null;
  return row(database.prepare('SELECT * FROM companion_tasks WHERE id = ?').get(String(id)));
}

export function getTask(id) {
  const item = database.prepare('SELECT * FROM companion_tasks WHERE id = ?').get(String(id));
  return item ? row(item) : null;
}

export function getActiveTaskContext(conversationId) {
  const task = database.prepare("SELECT * FROM companion_tasks WHERE (conversation_id = ? OR ('task-' || id) = ?) AND status IN ('active', 'blocked') ORDER BY updated_at DESC LIMIT 1").get(String(conversationId || ''), String(conversationId || ''));
  return task ? row(task) : null;
}

export function saveTaskMessages(id, messages) {
  if (!Array.isArray(messages)) throw new Error('任务对话格式无效。');
  const cleaned = messages.slice(-200).map((message) => ({
    id: clean(message.id, 100) || globalThis.crypto.randomUUID(),
    role: message.role === 'assistant' ? 'assistant' : 'user',
    content: String(message.content || '').slice(0, 50000),
    model: clean(message.model, 120),
    createdAt: Number(message.createdAt) || Date.now(),
  }));
  const updatedAt = new Date().toISOString();
  const result = database.prepare('UPDATE companion_tasks SET messages_json = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(cleaned), updatedAt, String(id));
  return result.changes ? row(database.prepare('SELECT * FROM companion_tasks WHERE id = ?').get(String(id))) : null;
}

export function applyTaskUpdates(conversationId, output) {
  const task = getActiveTaskContext(conversationId);
  if (!task) return null;
  const match = String(output || '').match(/\[\[TASK_UPDATE:(active|blocked|done)\|([^|\]\r\n]{0,1000})\|([^\]\r\n]{0,500})\]\]/iu);
  if (!match) return null;
  return updateTask(task.id, { status: match[1].toLowerCase(), currentState: match[2], nextStep: match[3] });
}
