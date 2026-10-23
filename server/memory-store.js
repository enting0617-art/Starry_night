import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { projectRoot } from './config.js';

const database = new DatabaseSync(join(projectRoot, 'data', 'chat.sqlite'));

database.exec(`
  CREATE TABLE IF NOT EXISTS memory_records (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK(kind IN ('memory', 'notebook')),
    text TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT '',
    pinned INTEGER NOT NULL DEFAULT 0,
    importance INTEGER NOT NULL DEFAULT 1,
    source TEXT NOT NULL DEFAULT 'local',
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_memory_records_kind_updated ON memory_records(kind, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_memory_records_kind_pinned ON memory_records(kind, pinned DESC, updated_at DESC);
  CREATE TABLE IF NOT EXISTS memory_store_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

function legacyArray(fileName) {
  try {
    const value = JSON.parse(readFileSync(join(projectRoot, 'data', fileName), 'utf8'));
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}

function itemRow(kind, item) {
  const now = new Date().toISOString();
  const value = { ...item, id: String(item.id || globalThis.crypto.randomUUID()), text: String(item.text || '').trim() };
  return {
    id: value.id,
    kind,
    text: value.text,
    category: String(value.category || ''),
    pinned: value.pinned ? 1 : 0,
    importance: Number.isInteger(value.importance) ? value.importance : (value.pinned ? 3 : 1),
    source: String(value.source || 'legacy'),
    payload: JSON.stringify({ ...value, createdAt: value.createdAt || now, updatedAt: value.updatedAt || now }),
    createdAt: value.createdAt || now,
    updatedAt: value.updatedAt || now,
  };
}

function migrateLegacyOnce() {
  const migrated = database.prepare("SELECT value FROM memory_store_meta WHERE key = 'legacy-json-v1'").get();
  if (migrated) return;
  const memories = legacyArray('memories.json');
  const notes = legacyArray('xingkong-notes.json');
  const insert = database.prepare(`INSERT OR IGNORE INTO memory_records (id, kind, text, category, pinned, importance, source, payload_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  database.exec('BEGIN IMMEDIATE');
  try {
    for (const item of memories) {
      const row = itemRow('memory', item);
      if (row.text) insert.run(row.id, row.kind, row.text, row.category, row.pinned, row.importance, row.source, row.payload, row.createdAt, row.updatedAt);
    }
    for (const item of notes) {
      const row = itemRow('notebook', item);
      if (row.text) insert.run(row.id, row.kind, row.text, row.category, row.pinned, row.importance, row.source, row.payload, row.createdAt, row.updatedAt);
    }
    database.prepare("INSERT INTO memory_store_meta (key, value) VALUES ('legacy-json-v1', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(new Date().toISOString());
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

export function readMemoryItems(kind) {
  migrateLegacyOnce();
  return database.prepare('SELECT payload_json AS payload FROM memory_records WHERE kind = ? ORDER BY updated_at DESC').all(kind)
    .flatMap(({ payload }) => {
      try { return [JSON.parse(payload)]; } catch { return []; }
    });
}

export function replaceMemoryItems(kind, items) {
  migrateLegacyOnce();
  const insert = database.prepare(`INSERT INTO memory_records (id, kind, text, category, pinned, importance, source, payload_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  database.exec('BEGIN IMMEDIATE');
  try {
    database.prepare('DELETE FROM memory_records WHERE kind = ?').run(kind);
    for (const item of items) {
      const row = itemRow(kind, item);
      if (row.text) insert.run(row.id, row.kind, row.text, row.category, row.pinned, row.importance, row.source, row.payload, row.createdAt, row.updatedAt);
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}
