import test from 'node:test';
import assert from 'node:assert/strict';
import { countValidCalendarProposals, expectedCalendarProposalCount } from '../server/calendar-proposal-repair.js';

test('detects the number of pasted calendar items referenced by a follow-up', () => {
  const messages = [
    { role: 'user', content: 'Event\nAssignment #3 Due\nOct 27 at 11:59pm\n\nEvent\nContent Quiz 6\nOct 29 at 11:59pm\n\nAssignment\nThe Human Arm\nDue: Oct 27 at 8am' },
    { role: 'assistant', content: '需要确认细节。' },
    { role: 'user', content: '每个各生成一个就好啦' },
  ];
  assert.equal(expectedCalendarProposalCount(messages), 3);
});

test('counts only structurally valid calendar proposal blocks', () => {
  const valid = '[[CALENDAR_PROPOSAL]]{"title":"A","startAt":"2026-10-27T08:00:00-06:00","endAt":"2026-10-27T09:00:00-06:00"}[[/CALENDAR_PROPOSAL]]';
  const invalid = '[[CALENDAR_PROPOSAL]]{"title":"B","startAt":"bad","endAt":"bad"}[[/CALENDAR_PROPOSAL]]';
  assert.equal(countValidCalendarProposals(`${valid}\n${invalid}`, 'America/Denver'), 1);
});

test('accepts a deadline proposal without an artificial end time', () => {
  const deadline = '[[CALENDAR_PROPOSAL]]{"title":"Lab Due","kind":"deadline","startAt":"2026-10-27T08:00:00-06:00"}[[/CALENDAR_PROPOSAL]]';
  assert.equal(countValidCalendarProposals(deadline, 'America/Denver'), 1);
});
