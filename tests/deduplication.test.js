import test from 'node:test';
import assert from 'node:assert/strict';
import { Temporal } from 'temporal-polyfill';
import { deduplicateItems, duplicateScore, findDuplicate } from '../server/deduplication.js';
import { millisecondsUntilNightly } from '../server/memory-maintenance.js';

test('detects repeated memory wording while preserving contradictions', () => {
  assert.ok(duplicateScore('用户喜欢在晚上学习。', '用户喜欢在晚上学习') >= 0.88);
  assert.ok(duplicateScore('用户喜欢喝咖啡', '用户喜欢喝咖啡，尤其是拿铁') >= 0.88);
  assert.equal(duplicateScore('用户喜欢喝咖啡', '用户不喜欢喝咖啡'), 0);
  assert.ok(findDuplicate([{ id: '1', text: '用户计划学习统计学' }], '用户计划学习统计学。'));
});

test('deduplication keeps pinned information and merges metadata', () => {
  const result = deduplicateItems([
    { id: 'old', text: '用户喜欢本地模型', pinned: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z' },
    { id: 'new', text: '用户喜欢本地模型。', pinned: false, createdAt: '2026-02-01T00:00:00Z', updatedAt: '2026-02-02T00:00:00Z' },
  ]);
  assert.equal(result.removed, 1);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].id, 'old');
  assert.equal(result.items[0].pinned, true);
  assert.equal(result.items[0].updatedAt, '2026-02-02T00:00:00Z');
});

test('nightly maintenance schedules the next local 23:30', () => {
  const before = millisecondsUntilNightly('America/Denver', Temporal.Instant.from('2026-10-25T18:00:00Z'));
  const after = millisecondsUntilNightly('America/Denver', Temporal.Instant.from('2026-10-26T05:45:00Z'));
  assert.ok(before > 0 && before < 12 * 60 * 60 * 1000);
  assert.ok(after > 23 * 60 * 60 * 1000 && after < 24 * 60 * 60 * 1000);
});
