function proposalBlocks(text) {
  return [...String(text || '').matchAll(/\[\[CALENDAR_PROPOSAL\]\]\s*([\s\S]*?)\s*\[\[\/CALENDAR_PROPOSAL\]\]/giu)];
}

function validProposal(value, defaultTimeZone) {
  const title = String(value?.title || '').trim().slice(0, 160);
  const startAt = new Date(value?.startAt);
  const kind = value?.kind === 'deadline' ? 'deadline' : 'event';
  const endAt = kind === 'deadline' ? new Date(startAt.getTime() + 1000) : new Date(value?.endAt);
  if (!title || Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt) return null;
  const rawReminder = value.remindBeforeMinutes;
  const reminder = rawReminder === null || rawReminder === undefined || rawReminder === '' ? null : Number(rawReminder);
  if (reminder !== null && (!Number.isFinite(reminder) || reminder < 0 || reminder > 10080)) return null;
  return {
    title,
    description: String(value.description || '').trim().slice(0, 2000),
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    timezone: String(value.timezone || defaultTimeZone || 'UTC').slice(0, 100),
    allDay: Boolean(value.allDay),
    kind,
    remindBeforeMinutes: reminder,
  };
}

export function countValidCalendarProposals(text, defaultTimeZone = 'UTC') {
  return proposalBlocks(text).map((match) => {
    try { return validProposal(JSON.parse(match[1]), defaultTimeZone); } catch { return null; }
  }).filter(Boolean).length;
}

export function expectedCalendarProposalCount(messages) {
  const recent = Array.isArray(messages) ? messages.slice(-8) : [];
  const latestUserText = [...recent].reverse().find((message) => message.role === 'user')?.content || '';
  if (!/(?:日程|日历|草案|设定|创建|生成|每个|各(?:生成|创建|设定)?一个)/u.test(latestUserText)) return 0;
  for (const message of [...recent].reverse()) {
    if (message.role !== 'user') continue;
    const text = String(message.content || '');
    const headings = text.match(/^\s*(?:Event|Assignment)\s*$/gimu)?.length || 0;
    if (headings >= 2) return Math.min(headings, 20);
  }
  return 0;
}

export async function repairMissingCalendarProposals({ assistantText, expectedCount, messages, model, config, localClock }) {
  const existing = proposalBlocks(assistantText).map((match) => {
    try { return validProposal(JSON.parse(match[1]), config.webSearch.timeZone); } catch { return null; }
  }).filter(Boolean);
  const missing = expectedCount - existing.length;
  if (missing <= 0) return '';
  const recentUserText = (messages || []).filter((message) => message.role === 'user').slice(-4).map((message) => String(message.content || '')).join('\n\n--- 后续要求 ---\n');
  const response = await fetch(`${config.ollamaBaseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      format: 'json',
      messages: [{
        role: 'user',
        content: `你是日程草案补全器。用户一共提供了 ${expectedCount} 项待建日程，但已有草案只有 ${existing.length} 条。请找出遗漏项，只返回严格 JSON：{"proposals":[{"title":"标题","description":"说明","kind":"deadline或event","startAt":"ISO 8601","endAt":"普通事件的ISO 8601结束时间","timezone":"${config.webSearch.timeZone}","allDay":false,"remindBeforeMinutes":30}]}。proposals 必须恰好包含 ${missing} 条遗漏项，不得重复已有标题和时间。带 Due、deadline、截止或提交时限的事项必须使用 kind:"deadline"，startAt 就是截止时间点，提醒提前量只放在 remindBeforeMinutes，不能把提醒时刻当成事件开始时间。当前本地时间：${localClock}。\n\n用户原始内容：\n${recentUserText}\n\n已有有效草案：\n${JSON.stringify(existing)}`,
      }],
      options: { temperature: 0, num_predict: Math.min(1800, 500 * missing) },
    }),
    signal: AbortSignal.timeout(Math.min(config.debug.requestTimeoutMs, 90000)),
  });
  if (!response.ok) return '';
  const data = await response.json();
  let parsed;
  try { parsed = JSON.parse(data.message?.content || '{}'); } catch { return ''; }
  const existingKeys = new Set(existing.map((item) => `${item.title.toLowerCase()}|${item.startAt}`));
  const additions = (Array.isArray(parsed.proposals) ? parsed.proposals : [])
    .map((value) => validProposal(value, config.webSearch.timeZone))
    .filter((value) => value && !existingKeys.has(`${value.title.toLowerCase()}|${value.startAt}`))
    .slice(0, missing);
  return additions.map((value) => `[[CALENDAR_PROPOSAL]]${JSON.stringify(value)}[[/CALENDAR_PROPOSAL]]`).join('\n');
}
