function normalize(value) {
  return String(value || '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function bigrams(value) {
  const text = normalize(value);
  if (text.length < 2) return new Set(text ? [text] : []);
  const result = new Set();
  for (let index = 0; index < text.length - 1; index += 1) result.add(text.slice(index, index + 2));
  return result;
}

function hasNegation(value) {
  return /(?:不再|不喜欢|不想|不需要|没有|并非|不是|讨厌|拒绝|禁止)/u.test(normalize(value));
}

export function duplicateScore(left, right) {
  const a = normalize(left);
  const b = normalize(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (hasNegation(a) !== hasNegation(b)) return 0;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length > b.length ? a : b;
  if (shorter.length >= 6 && longer.includes(shorter) && shorter.length / longer.length >= 0.55) return 0.96;
  const leftPairs = bigrams(a);
  const rightPairs = bigrams(b);
  let overlap = 0;
  for (const pair of leftPairs) if (rightPairs.has(pair)) overlap += 1;
  return leftPairs.size && rightPairs.size ? (2 * overlap) / (leftPairs.size + rightPairs.size) : 0;
}

export function findDuplicate(items, text, { threshold = 0.88, excludeId = '' } = {}) {
  return items.find((item) => item.id !== excludeId && duplicateScore(item.text, text) >= threshold) || null;
}

function preferred(left, right) {
  if (Boolean(left.pinned) !== Boolean(right.pinned)) return left.pinned ? left : right;
  const leftLength = normalize(left.text).length;
  const rightLength = normalize(right.text).length;
  if (leftLength !== rightLength) return leftLength > rightLength ? left : right;
  return new Date(left.updatedAt || 0) >= new Date(right.updatedAt || 0) ? left : right;
}

function mergePair(left, right) {
  const keep = preferred(left, right);
  const other = keep === left ? right : left;
  const leftCreated = Number.isFinite(Date.parse(left.createdAt)) ? Date.parse(left.createdAt) : Number.MAX_SAFE_INTEGER;
  const rightCreated = Number.isFinite(Date.parse(right.createdAt)) ? Date.parse(right.createdAt) : Number.MAX_SAFE_INTEGER;
  return {
    ...keep,
    pinned: Boolean(left.pinned || right.pinned),
    createdAt: leftCreated <= rightCreated ? left.createdAt : right.createdAt,
    updatedAt: new Date(left.updatedAt || 0) >= new Date(right.updatedAt || 0) ? left.updatedAt : right.updatedAt,
    source: keep.source || other.source,
  };
}

export function deduplicateItems(items, { threshold = 0.88 } = {}) {
  const unique = [];
  let removed = 0;
  for (const source of items) {
    const index = unique.findIndex((item) => duplicateScore(item.text, source.text) >= threshold);
    if (index < 0) unique.push({ ...source });
    else {
      unique[index] = mergePair(unique[index], source);
      removed += 1;
    }
  }
  return { items: unique, removed };
}
