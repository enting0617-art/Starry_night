export function sanitizeAssistantContent(text, { preserveEmojiMarkers = false } = {}) {
  let value = String(text || '');
  if (!preserveEmojiMarkers) value = value.replace(/\s*\[\[EMOJI:\d+\]\]\s*/giu, '\n');
  return value
    // Markdown interprets paired ASCII tildes as strikethrough. Full-width waves preserve the tone safely.
    .replace(/~{2,}/gu, (match) => '～'.repeat(match.length))
    .replace(/\s*\[\[NOTE:[a-z]+\|[^\]\r\n]+\]\]\s*/giu, '\n')
    .replace(/\s*\[\[TASK_UPDATE:(?:active|blocked|done)\|[^|\]\r\n]*\|[^\]\r\n]*\]\]\s*/giu, '\n')
    .replace(/\s*\[\[PYTHON_CODE:[^\]\r\n]+\]\][\s\S]*?\[\[\/PYTHON_CODE\]\]\s*/giu, '\n')
    .replace(/\p{Extended_Pictographic}(?:[\uFE0E\uFE0F])?(?:\u200D\p{Extended_Pictographic}(?:[\uFE0E\uFE0F])?)*/gu, '')
    .replace(/[\uFE0E\uFE0F]/gu, '')
    .replace(/^\s*(?:星空|助手|AI)发送的表情(?:包)?含义[:：].*$/gimu, '')
    .replace(/!\[[^\]]*\]\(https?:\/\/(?:127\.0\.0\.1|localhost):\d+\/api\/emojis\/\d+\/image\)/giu, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function findSelectedAssistantEmoji(text, emojis) {
  const ids = [...String(text || '').matchAll(/\[\[EMOJI:(\d+)\]\]/giu)].map((match) => Number(match[1]));
  return [...ids].reverse().map((id) => emojis.find((emoji) => emoji.id === id)).find(Boolean) || null;
}
