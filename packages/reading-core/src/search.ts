// Compatibility normalization also matches full-width Latin text; accents are optional.
export function normalizeSearch(value: string) {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/gu, ' ');
}

export function excerptMatch(text: string, query: string) {
  const needle = normalizeSearch(query.trim());
  if (!needle) return null;
  const normalized = normalizeSearch(text);
  const index = normalized.indexOf(needle);
  if (index < 0) return null;
  // Build offsets only for hits. Normalization can expand ligatures or remove accents;
  // normalized indices must never be applied directly to the original paragraph.
  const starts: number[] = [],
    ends: number[] = [];
  let offset = 0,
    whitespace = false;
  for (const character of text) {
    const folded = normalizeSearch(character);
    for (const unit of folded.split('')) {
      if (unit === ' ' && whitespace) continue;
      starts.push(offset);
      ends.push(offset + character.length);
      whitespace = unit === ' ';
    }
    offset += character.length;
  }
  const start = starts[index];
  let end = ends[index + needle.length - 1];
  if (start === undefined || end === undefined) return null;
  while (end < text.length && /\p{M}/u.test(text[end])) end++;
  const from = Math.max(0, start - 72),
    to = Math.min(text.length, Math.max(end + 140, from + 230));
  const prefix = from ? '…' : '';
  return {
    sourceStart: start,
    sourceEnd: end,
    excerpt: prefix + text.slice(from, to) + (to < text.length ? '…' : ''),
    matchStart: start - from + prefix.length,
    matchEnd: end - from + prefix.length,
  };
}
