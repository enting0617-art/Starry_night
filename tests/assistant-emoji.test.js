import test from 'node:test';
import assert from 'node:assert/strict';
import { findSelectedAssistantEmoji, sanitizeAssistantContent } from '../src/chat-format.js';

test('recognizes a real emoji marker even when text follows it', () => {
  const text = '我发一个表情给你～ [[EMOJI:178]] 如果还想看，也可以告诉我。';
  const emoji = findSelectedAssistantEmoji(text, [{ id: 178, description: '真实表情' }]);
  assert.equal(emoji?.id, 178);
  assert.equal(sanitizeAssistantContent(text), '我发一个表情给你～\n如果还想看，也可以告诉我。');
});

test('rejects invented emoji ids while removing the raw marker', () => {
  const text = '这是一个不存在的表情 [[EMOJI:99999]]';
  assert.equal(findSelectedAssistantEmoji(text, [{ id: 178 }]), null);
  assert.equal(sanitizeAssistantContent(text), '这是一个不存在的表情');
});

test('uses at most the last valid database emoji', () => {
  const text = '[[EMOJI:12]] 正文 [[EMOJI:178]]';
  assert.equal(findSelectedAssistantEmoji(text, [{ id: 12 }, { id: 178 }])?.id, 178);
});

test('removes unicode yellow-face emoji from assistant replies', () => {
  assert.equal(sanitizeAssistantContent('讲完啦～😊 🌙❤️'), '讲完啦～');
});

test('keeps a warm wave tone without triggering Markdown strikethrough', () => {
  assert.equal(sanitizeAssistantContent('好哦~~我们继续聊吧~~'), '好哦～～我们继续聊吧～～');
});

test('hides private notebook commands from the visible reply', () => {
  assert.equal(sanitizeAssistantContent('我会记住的。\n[[NOTE:identity|用户叫星空之夜]]\n[[EMOJI:12]]'), '我会记住的。');
});

test('hides private task checkpoints from the visible reply', () => {
  assert.equal(sanitizeAssistantContent('正在继续做。\n[[TASK_UPDATE:active|已完成资料整理|开始写实现]]\n[[EMOJI:12]]'), '正在继续做。');
});
