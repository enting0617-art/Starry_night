import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildShortTermContext } from '../server/context-memory.js';

test('keeps recent messages and summarizes older context within a bounded window', () => {
  const messages = Array.from({ length: 24 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user',
    content: `第 ${index} 条对话：${'内容'.repeat(900)}`,
  }));
  const result = buildShortTermContext({ messages });
  assert.ok(result.recent.length < messages.length);
  assert.ok(result.summary.length > 0);
  assert.ok(result.summary.length <= 2400);
});
