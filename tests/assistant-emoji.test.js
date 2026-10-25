import test from 'node:test';
import assert from 'node:assert/strict';
import { extractCalendarProposal, findSelectedAssistantEmoji, sanitizeAssistantContent } from '../src/chat-format.js';

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

test('hides sandbox source blocks from the visible reply', () => {
  assert.equal(sanitizeAssistantContent('我来算一下。\n[[PYTHON_CODE:demo.py]]\nprint(2 + 2)\n[[/PYTHON_CODE]]'), '我来算一下。');
});

test('extracts and hides a valid calendar proposal', () => {
  const text = '我准备了一条日程。\n[[CALENDAR_PROPOSAL]]{"title":"复习 SQL","description":"CMPUT 291","startAt":"2026-10-27T15:00:00-06:00","endAt":"2026-10-27T16:00:00-06:00","timezone":"America/Edmonton","allDay":false,"remindBeforeMinutes":10}[[/CALENDAR_PROPOSAL]]';
  const proposal = extractCalendarProposal(text);
  assert.equal(proposal.title, '复习 SQL');
  assert.equal(proposal.startAt, '2026-10-27T21:00:00.000Z');
  assert.equal(proposal.remindBeforeMinutes, 10);
  assert.equal(sanitizeAssistantContent(text), '我准备了一条日程。');
});

test('rejects invalid calendar proposal ranges', () => {
  const text = '[[CALENDAR_PROPOSAL]]{"title":"错误日程","startAt":"2026-10-27T16:00:00Z","endAt":"2026-10-27T15:00:00Z"}[[/CALENDAR_PROPOSAL]]';
  assert.equal(extractCalendarProposal(text), null);
});
