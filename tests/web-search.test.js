import test from 'node:test';
import assert from 'node:assert/strict';
import { planWebSearch } from '../server/web-search.js';

test('uses the local clock instead of web search for current time', () => {
  assert.deepEqual(planWebSearch('现在是几点钟呀', true), { shouldSearch: false, reason: 'local-clock', needsClock: true });
});

test('forces search for freshness-sensitive questions', () => {
  assert.equal(planWebSearch('今天埃德蒙顿天气怎么样', true).shouldSearch, true);
  assert.equal(planWebSearch('Ollama 最新版本是什么', true).shouldSearch, true);
});

test('does not search stable knowledge automatically', () => {
  assert.equal(planWebSearch('解释一下什么是光合作用', true).shouldSearch, false);
});

test('honors an explicit search request', () => {
  assert.equal(planWebSearch('帮我上网查一下这个问题', true).reason, 'explicit');
});
