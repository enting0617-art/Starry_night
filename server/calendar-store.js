import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { projectRoot } from './config.js';

const database = new DatabaseSync(process.env.STARRY_CALENDAR_DB_PATH || join(projectRoot, 'data', 'chat.sqlite'));
database.exec('PRAGMA busy_timeout = 5000');
database.exec('PRAGMA foreign_keys = ON');
database.exec(`
  CREATE TABLE IF NOT EXISTS calendar_events (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    start_at TEXT NOT NULL,
    end_at TEXT NOT NULL,
    timezone TEXT NOT NULL,
    all_day INTEGER NOT NULL DEFAULT 0,
    event_kind TEXT NOT NULL DEFAULT 'event',
    recurrence_rule TEXT,
    linked_task_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS calendar_reminders (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL UNIQUE,
    fire_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    delivered_at TEXT,
    FOREIGN KEY (event_id) REFERENCES calendar_events(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_calendar_events_start ON calendar_events(start_at);
  CREATE INDEX IF NOT EXISTS idx_calendar_reminders_due ON calendar_reminders(status, fire_at);
`);
const eventColumns = new Set(database.prepare('PRAGMA table_info(calendar_events)').all().map((column) => column.name));
if (!eventColumns.has('event_kind')) database.exec("ALTER TABLE calendar_events ADD COLUMN event_kind TEXT NOT NULL DEFAULT 'event'");

function clean(value, limit) {
  return String(value ?? '').replace(/\s+/gu, ' ').trim().slice(0, limit);
}

function iso(value, label) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) throw new Error(`${label}不是有效日期。`);
  return date.toISOString();
}

function row(item) {
  return {
    id: item.id,
    title: item.title,
    description: item.description,
    startAt: item.start_at,
    endAt: item.end_at,
    timezone: item.timezone,
    allDay: Boolean(item.all_day),
    kind: item.event_kind === 'deadline' ? 'deadline' : 'event',
    recurrenceRule: item.recurrence_rule,
    linkedTaskId: item.linked_task_id,
    remindBeforeMinutes: item.remind_before_minutes ?? null,
    reminderStatus: item.reminder_status ?? null,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  };
}

const selectEvents = `
  SELECT e.*,
    CASE WHEN r.id IS NULL THEN NULL
      ELSE CAST(ROUND((julianday(e.start_at) - julianday(r.fire_at)) * 1440) AS INTEGER)
    END AS remind_before_minutes,
    r.status AS reminder_status
  FROM calendar_events e
  LEFT JOIN calendar_reminders r ON r.event_id = e.id
`;

function normalize(value, existing = null) {
  const title = clean(value.title ?? existing?.title, 160);
  const startAt = iso(value.startAt ?? existing?.startAt, '开始时间');
  const kind = (value.kind ?? existing?.kind) === 'deadline' ? 'deadline' : 'event';
  const endAt = kind === 'deadline'
    ? new Date(new Date(startAt).getTime() + 1000).toISOString()
    : iso(value.endAt ?? existing?.endAt, '结束时间');
  if (!title) throw new Error('请填写日程标题。');
  if (new Date(endAt) <= new Date(startAt)) throw new Error('结束时间必须晚于开始时间。');
  const rawReminder = Object.hasOwn(value, 'remindBeforeMinutes') ? value.remindBeforeMinutes : existing?.remindBeforeMinutes;
  const remindBeforeMinutes = rawReminder === '' || rawReminder === null || rawReminder === undefined
    ? null
    : Math.max(0, Math.min(10080, Math.round(Number(rawReminder))));
  if (rawReminder !== null && rawReminder !== undefined && rawReminder !== '' && !Number.isFinite(Number(rawReminder))) {
    throw new Error('提醒时间必须是有效分钟数。');
  }
  return {
    title,
    description: clean(value.description ?? existing?.description, 2000),
    startAt,
    endAt,
    timezone: clean(value.timezone ?? existing?.timezone, 100) || 'UTC',
    allDay: Boolean(value.allDay ?? existing?.allDay),
    kind,
    recurrenceRule: clean(value.recurrenceRule ?? existing?.recurrenceRule, 500) || null,
    linkedTaskId: clean(value.linkedTaskId ?? existing?.linkedTaskId, 100) || null,
    remindBeforeMinutes,
  };
}

function syncReminder(eventId, startAt, minutes) {
  if (minutes === null) {
    database.prepare('DELETE FROM calendar_reminders WHERE event_id = ?').run(eventId);
    return;
  }
  const fireAt = new Date(new Date(startAt).getTime() - minutes * 60000).toISOString();
  const existing = database.prepare('SELECT id FROM calendar_reminders WHERE event_id = ?').get(eventId);
  if (existing) {
    database.prepare(`UPDATE calendar_reminders SET fire_at = ?, status = ?, delivered_at = NULL WHERE event_id = ?`)
      .run(fireAt, 'pending', eventId);
  } else {
    database.prepare('INSERT INTO calendar_reminders (id, event_id, fire_at, status) VALUES (?, ?, ?, ?)')
      .run(globalThis.crypto.randomUUID(), eventId, fireAt, 'pending');
  }
}

export function listCalendarEvents({ from, to, limit } = {}) {
  const clauses = [];
  const values = [];
  if (from) { clauses.push('e.end_at >= ?'); values.push(iso(from, '查询起点')); }
  if (to) { clauses.push('e.start_at <= ?'); values.push(iso(to, '查询终点')); }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  const safeLimit = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(200, Math.round(Number(limit)))) : 200;
  return database.prepare(`${selectEvents}${where} ORDER BY e.start_at ASC LIMIT ?`).all(...values, safeLimit).map(row);
}

export function createCalendarEvent(value = {}) {
  const item = normalize(value);
  const now = new Date().toISOString();
  const id = globalThis.crypto.randomUUID();
  database.prepare(`INSERT INTO calendar_events
    (id, title, description, start_at, end_at, timezone, all_day, event_kind, recurrence_rule, linked_task_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, item.title, item.description, item.startAt, item.endAt, item.timezone, Number(item.allDay), item.kind, item.recurrenceRule, item.linkedTaskId, now, now);
  syncReminder(id, item.startAt, item.remindBeforeMinutes);
  return row(database.prepare(`${selectEvents} WHERE e.id = ?`).get(id));
}

export function createCalendarEvents(values = []) {
  if (!Array.isArray(values) || !values.length) throw new Error('请至少提供一条日程。');
  if (values.length > 20) throw new Error('一次最多创建 20 条日程。');
  const items = values.map((value) => normalize(value));
  const created = [];
  database.exec('BEGIN');
  try {
    for (const item of items) {
      const now = new Date().toISOString();
      const id = globalThis.crypto.randomUUID();
      database.prepare(`INSERT INTO calendar_events
        (id, title, description, start_at, end_at, timezone, all_day, event_kind, recurrence_rule, linked_task_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, item.title, item.description, item.startAt, item.endAt, item.timezone, Number(item.allDay), item.kind, item.recurrenceRule, item.linkedTaskId, now, now);
      syncReminder(id, item.startAt, item.remindBeforeMinutes);
      created.push(row(database.prepare(`${selectEvents} WHERE e.id = ?`).get(id)));
    }
    database.exec('COMMIT');
    return created;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

export function updateCalendarEvent(id, changes = {}) {
  const source = database.prepare(`${selectEvents} WHERE e.id = ?`).get(String(id));
  if (!source) return null;
  const item = normalize(changes, row(source));
  const updatedAt = new Date().toISOString();
  database.prepare(`UPDATE calendar_events SET title = ?, description = ?, start_at = ?, end_at = ?, timezone = ?, all_day = ?, event_kind = ?, recurrence_rule = ?, linked_task_id = ?, updated_at = ? WHERE id = ?`)
    .run(item.title, item.description, item.startAt, item.endAt, item.timezone, Number(item.allDay), item.kind, item.recurrenceRule, item.linkedTaskId, updatedAt, String(id));
  syncReminder(String(id), item.startAt, item.remindBeforeMinutes);
  return row(database.prepare(`${selectEvents} WHERE e.id = ?`).get(String(id)));
}

export function removeCalendarEvent(id) {
  return database.prepare('DELETE FROM calendar_events WHERE id = ?').run(String(id)).changes > 0;
}

export function listCalendarReminders() {
  return database.prepare(`SELECT r.id, r.event_id AS eventId, r.fire_at AS fireAt, r.status, r.delivered_at AS deliveredAt, e.title
    FROM calendar_reminders r JOIN calendar_events e ON e.id = r.event_id ORDER BY r.fire_at ASC`).all();
}

export function updateCalendarReminder(id, changes = {}) {
  const status = ['pending', 'delivered', 'dismissed'].includes(String(changes.status)) ? String(changes.status) : null;
  if (!status) throw new Error('提醒状态无效。');
  const deliveredAt = status === 'delivered' ? new Date().toISOString() : null;
  const result = database.prepare('UPDATE calendar_reminders SET status = ?, delivered_at = ? WHERE id = ?').run(status, deliveredAt, String(id));
  return result.changes > 0;
}

export function takeDueCalendarNotifications(now = new Date()) {
  const due = database.prepare(`SELECT r.id AS reminderId, r.event_id AS eventId, r.fire_at AS fireAt, e.title, e.description, e.start_at AS startAt
    FROM calendar_reminders r JOIN calendar_events e ON e.id = r.event_id
    WHERE r.status = 'pending' AND r.fire_at <= ? ORDER BY r.fire_at ASC LIMIT 20`).all(now.toISOString());
  const deliveredAt = now.toISOString();
  const mark = database.prepare("UPDATE calendar_reminders SET status = 'delivered', delivered_at = ? WHERE id = ? AND status = 'pending'");
  database.exec('BEGIN');
  try {
    for (const item of due) mark.run(deliveredAt, item.reminderId);
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
  return due;
}

export function listDueCalendarNotifications(now = new Date()) {
  return database.prepare(`SELECT r.id AS reminderId, r.event_id AS eventId, r.fire_at AS fireAt, e.title, e.description, e.start_at AS startAt
    FROM calendar_reminders r JOIN calendar_events e ON e.id = r.event_id
    WHERE r.status = 'pending' AND r.fire_at <= ? ORDER BY r.fire_at ASC LIMIT 20`).all(now.toISOString());
}

export function markCalendarReminderDelivered(id, deliveredAt = new Date()) {
  return database.prepare("UPDATE calendar_reminders SET status = 'delivered', delivered_at = ? WHERE id = ? AND status = 'pending'")
    .run(deliveredAt.toISOString(), String(id)).changes > 0;
}

export function closeCalendarStore() {
  database.close();
}
