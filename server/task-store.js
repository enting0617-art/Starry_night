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

function clean(value, limit) {
  return String(value || '').replace(/\s+/gu, ' ').trim().slice(0, limit);
}

function row(item) {
  return {
    id: item.id,
    conversationId: item.conversation_id,
    title: item.title,
    goal: item.goal,
    status: item.status,
    currentState: item.current_state,
    nextStep: item.next_step,
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
  const item = {
    id: globalThis.crypto.randomUUID(), conversationId, title: clean(value.title, 120) || goal.slice(0, 36), goal,
    status: 'active', currentState: clean(value.currentState, 1000), nextStep: clean(value.nextStep, 500), createdAt: now, updatedAt: now,
  };
  database.prepare(`INSERT INTO companion_tasks (id, conversation_id, title, goal, status, current_state, next_step, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(item.id, item.conversationId, item.title, item.goal, item.status, item.currentState, item.nextStep, item.createdAt, item.updatedAt);
  return item;
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

export function getActiveTaskContext(conversationId) {
  const task = database.prepare("SELECT * FROM companion_tasks WHERE conversation_id = ? AND status IN ('active', 'blocked') ORDER BY updated_at DESC LIMIT 1").get(String(conversationId || ''));
  return task ? row(task) : null;
}

export function applyTaskUpdates(conversationId, output) {
  const task = getActiveTaskContext(conversationId);
  if (!task) return null;
  const match = String(output || '').match(/\[\[TASK_UPDATE:(active|blocked|done)\|([^|\]\r\n]{0,1000})\|([^\]\r\n]{0,500})\]\]/iu);
  if (!match) return null;
  return updateTask(task.id, { status: match[1].toLowerCase(), currentState: match[2], nextStep: match[3] });
}
