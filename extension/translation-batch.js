export const BATCH_SIZE = 48;
export const BATCH_CHARS = 24000;
export const SENTENCE_CHARS = 16000;
export const CONTEXT_CHARS = 4000;

// Prioritize playback, then fill the rest only after an explicit whole-video request.
export function planTranslation(timeline, current, translated, { full = false, warm = false, batch = true, semanticOnly = false } = {}) {
  const start = current < 0 ? timeline.length : current;
  // A seek into unresolved source must wait for that area's semantic boundaries.
  // Whole-video backfill must not occupy the queue with old sentences meanwhile.
  if (semanticOnly && timeline[start] && !timeline[start].semantic) return [];
  let first = -1;
  const ahead = batch ? BATCH_SIZE : 3;
  for (let i = start; i < Math.min(start + ahead, timeline.length); i++) {
    if (!translated.has(i) && (!semanticOnly || timeline[i].semantic)) { first = i; break; }
  }
  if (first < 0 && full) first = timeline.findIndex((s, i) => !translated.has(i) && (!semanticOnly || s.semantic));
  if (first < 0) return [];
  const limit = batch ? (warm ? BATCH_SIZE : semanticOnly ? 8 : 2) : 1;
  const items = [];
  let chars = 0;
  for (let i = first; i < timeline.length && items.length < limit; i++) {
    if (translated.has(i) || (semanticOnly && !timeline[i].semantic)) break;
    const text = timeline[i].text;
    if (items.length && chars + text.length > BATCH_CHARS) break;
    items.push({ id: i, text }); chars += text.length;
  }
  return items;
}

export function validateBatch(items) {
  if (!Array.isArray(items) || !items.length || items.length > BATCH_SIZE ||
      items.some(s => !s || !Number.isSafeInteger(s.id) || s.id < 0 || typeof s.text !== 'string' || !s.text.trim() || s.text.length > SENTENCE_CHARS) ||
      new Set(items.map(s => s.id)).size !== items.length || items.reduce((n, s) => n + s.text.length, 0) > BATCH_CHARS) {
    throw new Error('Invalid translation batch.');
  }
}

export function translationContext(timeline, items, translated) {
  const first = items[0].id, last = items.at(-1).id;
  const beforeItems = timeline.slice(Math.max(0, first - 8), first);
  const afterItems = timeline.slice(last + 1, last + 9);
  const references = [];
  let chars = 0;
  for (const s of [...beforeItems].reverse()) {
    const translation = translated.get(s.id);
    if (!translation || chars + s.text.length + translation.length > CONTEXT_CHARS) continue;
    references.unshift({ source: s.text, translation }); chars += s.text.length + translation.length;
  }
  return { before: beforeItems.map(s => s.text).join('\n').slice(-CONTEXT_CHARS),
    after: afterItems.map(s => s.text).join('\n').slice(0, CONTEXT_CHARS), references };
}

export function validateReferences(value = []) {
  if (!Array.isArray(value) || value.length > 8 || value.some(r => !r || typeof r.source !== 'string' || typeof r.translation !== 'string') ||
      value.reduce((n, r) => n + r.source.length + r.translation.length, 0) > CONTEXT_CHARS) throw new Error('Invalid translation references.');
  return value.map(({ source, translation }) => ({ source, translation }));
}
