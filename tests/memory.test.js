import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isUsableMemory } from '../server/memory.js';

test('rejects assistant-role and temporary memory pollution', () => {
  assert.equal(isUsableMemory({ text: '我会一直在这里为你服务' }), false);
  assert.equal(isUsableMemory({ text: '希望用户保持愉快和舒适' }), false);
  assert.equal(isUsableMemory({ text: '1D045A0EA879C23A74CCB74625ED23F7.png' }), false);
});

test('keeps useful user facts', () => {
  assert.equal(isUsableMemory({ text: '用户喜欢简洁、自然的回复' }), true);
  assert.equal(isUsableMemory({ text: '我喜欢你' }), true);
});
