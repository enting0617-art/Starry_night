export function isRepetitiveThinking(text) {
  if (text.length < 900) return false;
  const tail = text.slice(-2400).replace(/\s+/g, '');
  const fragment = tail.slice(-160);
  if (fragment.length < 160) return false;
  let repeats = 0;
  let from = 0;
  while (true) {
    const found = tail.indexOf(fragment, from);
    if (found < 0) break;
    repeats += 1;
    from = found + 1;
  }
  return repeats >= 3;
}
