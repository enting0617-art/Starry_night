import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCalendarContext, calendarContextWindow } from '../server/calendar-context.js';

const now = new Date('2026-10-25T18:00:00.000Z');

test('uses a wider calendar window for schedule questions', () => {
  const ordinary = calendarContextWindow('我们聊点别的', now);
  const focused = calendarContextWindow('我下个月有什么日程？', now);
  assert.equal(ordinary.limit, 24);
  assert.equal(focused.limit, 80);
  assert.ok(new Date(focused.to) > new Date(ordinary.to));
  assert.ok(new Date(focused.from) < new Date(ordinary.from));
});

test('formats saved events as factual calendar context', () => {
  const window = calendarContextWindow('我今天有什么安排？', now);
  const context = buildCalendarContext([{
    title: '统计课复习',
    description: '准备期中考试',
    startAt: '2026-10-26T01:00:00.000Z',
    endAt: '2026-10-26T02:00:00.000Z',
    timezone: 'America/Edmonton',
    allDay: false,
    remindBeforeMinutes: 10,
  }], { userText: '我今天有什么安排？', now, timeZone: 'America/Edmonton', window });
  assert.match(context, /统计课复习/);
  assert.match(context, /准备期中考试/);
  assert.match(context, /提前10分钟提醒/);
  assert.match(context, /不得虚构列表之外的事件/);
});

test('does not claim the whole calendar is empty for a bounded empty window', () => {
  const window = calendarContextWindow('你好', now);
  const context = buildCalendarContext([], { userText: '你好', now, timeZone: 'America/Edmonton', window });
  assert.match(context, /该范围内没有已保存的日程/);
  assert.match(context, /超出范围时应说明当前上下文未提供/);
});
