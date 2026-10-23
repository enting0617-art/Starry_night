import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isRepetitiveThinking } from '../server/chat-guards.js';

test('detects long repeated reasoning loops', () => {
  const paragraph = '我先回顾一下斐波那契数列与植物排列的关系，再想想还有哪些例子。'.repeat(5);
  assert.equal(isRepetitiveThinking(paragraph.repeat(8)), true);
});

test('does not stop ordinary unique reasoning', () => {
  const unique = Array.from({ length: 100 }, (_, index) => `第${index}项有不同的解释和数字${index * 17}。`).join('');
  assert.equal(isRepetitiveThinking(unique), false);
});

