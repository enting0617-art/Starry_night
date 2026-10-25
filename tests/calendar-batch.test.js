import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('creates multiple calendar events atomically in an isolated database', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'xingkong-calendar-'));
  process.env.STARRY_CALENDAR_DB_PATH = join(folder, 'calendar.sqlite');
  const { closeCalendarStore, createCalendarEvents, listCalendarEvents, removeCalendarEvent } = await import('../server/calendar-store.js');
  const marker = globalThis.crypto.randomUUID();
  try {
    assert.throws(() => createCalendarEvents([
      { title: `valid-${marker}`, startAt: '2026-11-01T10:00:00Z', endAt: '2026-11-01T11:00:00Z' },
      { title: `invalid-${marker}`, startAt: '2026-11-01T12:00:00Z', endAt: '2026-11-01T11:00:00Z' },
    ]), /结束时间必须晚于开始时间/);
    assert.equal(listCalendarEvents({ from: '2026-11-01T00:00:00Z', to: '2026-11-02T00:00:00Z' }).some((event) => event.title.includes(marker)), false);
    const created = createCalendarEvents([
      { title: `first-${marker}`, startAt: '2026-11-01T10:00:00Z', endAt: '2026-11-01T11:00:00Z' },
      { title: `second-${marker}`, kind: 'deadline', startAt: '2026-11-01T12:00:00Z' },
    ]);
    try {
      assert.equal(created.length, 2);
      assert.deepEqual(created.map((event) => event.title), [`first-${marker}`, `second-${marker}`]);
      assert.equal(created[1].kind, 'deadline');
      assert.equal(new Date(created[1].endAt) - new Date(created[1].startAt), 1000);
    } finally {
      created.forEach((event) => removeCalendarEvent(event.id));
    }
  } finally {
    closeCalendarStore();
    delete process.env.STARRY_CALENDAR_DB_PATH;
    await rm(folder, { recursive: true, force: true });
  }
});
