export function sanitizeAssistantContent(text, { preserveEmojiMarkers = false } = {}) {
  let value = String(text || '');
  if (!preserveEmojiMarkers) value = value.replace(/\s*\[\[EMOJI:\d+\]\]\s*/giu, '\n');
  return value
    // Markdown interprets paired ASCII tildes as strikethrough. Full-width waves preserve the tone safely.
    .replace(/~{2,}/gu, (match) => '～'.repeat(match.length))
    .replace(/\s*\[\[NOTE:[a-z]+\|[^\]\r\n]+\]\]\s*/giu, '\n')
    .replace(/\s*\[\[TASK_UPDATE:(?:active|blocked|done)\|[^|\]\r\n]*\|[^\]\r\n]*\]\]\s*/giu, '\n')
    .replace(/\s*\[\[PYTHON_CODE:[^\]\r\n]+\]\][\s\S]*?\[\[\/PYTHON_CODE\]\]\s*/giu, '\n')
    .replace(/\s*\[\[CALENDAR_PROPOSAL\]\][\s\S]*?\[\[\/CALENDAR_PROPOSAL\]\]\s*/giu, '\n')
    .replace(/\s*\[\[WORKSPACE_ACTIONS\]\][\s\S]*?\[\[\/WORKSPACE_ACTIONS\]\]\s*/giu, '\n')
    .replace(/\s*\[\[WORKSPACE_ACTIONS\]\][\s\S]*$/giu, '\n')
    .replace(/\s*\[\[CALENDAR_PROPOSAL\]\][\s\S]*$/giu, '\n')
    .replace(/\p{Extended_Pictographic}(?:[\uFE0E\uFE0F])?(?:\u200D\p{Extended_Pictographic}(?:[\uFE0E\uFE0F])?)*/gu, '')
    .replace(/[\uFE0E\uFE0F]/gu, '')
    .replace(/^\s*(?:星空|助手|AI)发送的表情(?:包)?含义[:：].*$/gimu, '')
    .replace(/!\[[^\]]*\]\(https?:\/\/(?:127\.0\.0\.1|localhost):\d+\/api\/emojis\/\d+\/image\)/giu, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseCalendarProposal(source) {
  try {
    const value = JSON.parse(source);
    const title = String(value.title || '').trim().slice(0, 160);
    const startAt = new Date(value.startAt);
    const kind = value.kind === 'deadline' ? 'deadline' : 'event';
    const endAt = kind === 'deadline' ? new Date(startAt.getTime() + 1000) : new Date(value.endAt);
    const reminder = value.remindBeforeMinutes === null || value.remindBeforeMinutes === undefined || value.remindBeforeMinutes === '' ? null : Number(value.remindBeforeMinutes);
    if (!title || Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt) return null;
    if (reminder !== null && (!Number.isFinite(reminder) || reminder < 0 || reminder > 10080)) return null;
    return {
      title,
      description: String(value.description || '').trim().slice(0, 2000),
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      timezone: String(value.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC').slice(0, 100),
      allDay: Boolean(value.allDay),
      kind,
      remindBeforeMinutes: reminder,
    };
  } catch {
    return null;
  }
}

export function extractCalendarProposals(text) {
  return [...String(text || '').matchAll(/\[\[CALENDAR_PROPOSAL\]\]\s*([\s\S]*?)\s*\[\[\/CALENDAR_PROPOSAL\]\]/giu)]
    .map((match) => parseCalendarProposal(match[1]))
    .filter(Boolean)
    .slice(0, 20);
}

export function extractCalendarProposal(text) {
  return extractCalendarProposals(text)[0] || null;
}

export function findSelectedAssistantEmoji(text, emojis) {
  const ids = [...String(text || '').matchAll(/\[\[EMOJI:(\d+)\]\]/giu)].map((match) => Number(match[1]));
  return [...ids].reverse().map((id) => emojis.find((emoji) => emoji.id === id)).find(Boolean) || null;
}
