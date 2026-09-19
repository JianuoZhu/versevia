import { normalizeCues, reconstructSentences, joinText } from './core.js';

export const SEMANTIC_VERSION = 1;
export const SEMANTIC_TOKEN_LIMIT = 1600;
export const SEMANTIC_CHAR_LIMIT = 16000;

// Only source spans own timestamps. Model output never supplies text or times.
export function indexSource(raw, language = 'und') {
  const cues = normalizeCues(raw), spans = [];
  let text = '';
  for (const cue of cues) {
    if (text) text += joinText(text, cue.text);
    const lo = text.length; text += cue.text;
    spans.push({ ...cue, lo, hi: text.length });
  }
  let segmenter;
  try { segmenter = new Intl.Segmenter(language === 'auto' ? 'und' : language, { granularity: 'word' }); }
  catch { segmenter = new Intl.Segmenter('und', { granularity: 'word' }); }
  function timeAt(offset, end = false) {
    let low = 0, high = spans.length - 1;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (end ? spans[mid].hi >= offset : spans[mid].hi > offset) high = mid; else low = mid + 1;
    }
    const span = spans[low];
    return span ? span.start + (span.end - span.start) * Math.max(0, Math.min(1, (offset - span.lo) / (span.hi - span.lo))) : 0;
  }
  const tokens = [...segmenter.segment(text)].filter(s => s.segment.trim()).map((s, id) => ({ id, text: s.segment,
    lo: s.index, hi: s.index + s.segment.length, start: timeAt(s.index), end: timeAt(s.index + s.segment.length, true) }));
  return { text, cues, spans, tokens, language, timeAt };
}

export function sourceRange(source, from, to) {
  const first = source.tokens[from], last = source.tokens[to];
  if (!first || !last || from > to) throw new Error('Invalid source range.');
  return { text: source.text.slice(first.lo, last.hi), start: first.start, end: last.end, from, to };
}

export function validateSemanticRequest(input) {
  const tokens = input?.tokens;
  if (!Array.isArray(tokens) || !tokens.length || tokens.length > SEMANTIC_TOKEN_LIMIT ||
      tokens.some((t, i) => !t || !Number.isSafeInteger(t.id) || t.id < 0 || (i && t.id !== tokens[i - 1].id + 1) ||
        typeof t.text !== 'string' || !t.text.trim() || t.text.length > 4000) ||
      tokens.reduce((n, t) => n + t.text.length, 0) > SEMANTIC_CHAR_LIMIT ||
      typeof input.text !== 'string' || input.text.length > SEMANTIC_CHAR_LIMIT + 2000 ||
      !Number.isSafeInteger(input.commitEnd) || input.commitEnd < tokens[0].id || input.commitEnd > tokens.at(-1).id ||
      typeof input.openLeft !== 'boolean' || typeof input.final !== 'boolean' ||
      typeof input.before !== 'string' || input.before.length > 4000 || typeof input.after !== 'string' || input.after.length > 4000 ||
      typeof input.source !== 'string' || !/^(?:auto|[a-zA-Z]{2,3}(?:-[\w]{2,8})*)$/.test(input.source)) throw new Error('Invalid semantic segmentation request.');
  // Ensure the model's readable text and its indexed units represent the same data.
  if (tokens.map(t => t.text).join('').replace(/\s/gu, '') !== input.text.replace(/\s/gu, '')) throw new Error('Semantic source text does not match its tokens.');
}

export function validateBoundaries(input, result) {
  validateSemanticRequest(input);
  const first = input.tokens[0].id, last = input.tokens.at(-1).id;
  if (!result || !Number.isSafeInteger(result.leadingEnd) || result.leadingEnd < first - 1 || result.leadingEnd > last ||
      (!input.openLeft && result.leadingEnd !== first - 1) || !Array.isArray(result.sentences) || result.sentences.length > 400)
    throw new Error('Invalid semantic boundaries.');
  let previous = result.leadingEnd;
  for (const s of result.sentences) {
    if (!s || !Number.isSafeInteger(s.end) || s.end <= previous || s.end > last ||
        !Array.isArray(s.parts) || !s.parts.length || s.parts.length > 64 || s.parts.at(-1) !== s.end ||
        s.parts.some((p, i) => !Number.isSafeInteger(p) || p <= (i ? s.parts[i - 1] : previous) || p > s.end))
      throw new Error('Invalid semantic boundaries.');
    previous = s.end;
  }
  if (input.final && previous !== last) throw new Error('Semantic result omitted the end of the source.');
  return result;
}

function semanticSentence(source, from, item) {
  const sentence = { ...sourceRange(source, from, item.end), semantic: true };
  let start = from;
  sentence.parts = item.parts.map((end, id) => {
    const part = sourceRange(source, start, end);
    const offsetStart = source.tokens[start].lo - source.tokens[from].lo, offsetEnd = source.tokens[end].hi - source.tokens[from].lo;
    start = end + 1;
    return { ...part, id, offsetStart, offsetEnd };
  });
  return sentence;
}

// An unresolved interval is bounded by committed sentence boundaries. Overlapping
// lookahead is re-read, but only the owned prefix is committed; no batch edge is a sentence.
export class SemanticTimeline {
  constructor(cues, language) {
    this.source = indexSource(cues, language); this.sentences = []; this.expansions = new Map();
    this.pending = false; this.blocked = false; this.paused = false; this.full = false;
  }
  get complete() { return this.gaps().length === 0; }
  gaps() {
    const out = []; let start = 0;
    for (const sentence of this.sentences) {
      if (start < sentence.from) out.push({ from: start, to: sentence.from - 1 });
      start = sentence.to + 1;
    }
    if (start < this.source.tokens.length) out.push({ from: start, to: this.source.tokens.length - 1 });
    return out;
  }
  plan(time, full = this.full) {
    if (this.pending || this.blocked || this.paused) return null;
    const { tokens, text, language } = this.source;
    const gaps = this.gaps();
    let gap = gaps.find(g => tokens[g.to].end > time && tokens[g.from].start <= time + 60);
    if (!gap && full) gap = gaps[0];
    if (!gap) return null;
    let from = gap.from;
    // Jump into an unprocessed video with left context. A leading partial thought
    // is explicitly left uncommitted and remains visible through the fallback.
    if (tokens[from].start < time - 30 && tokens[gap.to].end > time) {
      const near = tokens.findIndex(t => t.start >= time - 20);
      if (near > from && near <= gap.to) from = near;
    }
    const attempt = this.expansions.get(from) || 0;
    const target = tokens[from].start + 60 * (attempt + 1);
    let to = from, chars = 0, commitEnd = from;
    for (let i = from; i <= gap.to && i < from + SEMANTIC_TOKEN_LIMIT; i++) {
      if (chars + tokens[i].text.length > SEMANTIC_CHAR_LIMIT) break;
      if (i > from && tokens[i].start > target + 15) break;
      to = i; chars += tokens[i].text.length;
      if (tokens[i].end <= target) commitEnd = i;
    }
    const final = to === gap.to;
    // Generated clips may end in an unfinished utterance. 'final' means the end
    // of available input, not proof the speaker finished a grammatical sentence.
    const request = { source: language, tokens: tokens.slice(from, to + 1).map(({ id, text }) => ({ id, text })),
      text: text.slice(tokens[from].lo, tokens[to].hi), before: text.slice(Math.max(0, tokens[from].lo - 4000), tokens[from].lo),
      after: text.slice(tokens[to].hi, tokens[to].hi + 4000), openLeft: from !== gap.from,
      final, commitEnd: final ? to : commitEnd };
    validateSemanticRequest(request); return request;
  }
  accept(request, result) {
    validateBoundaries(request, result);
    let from = result.leadingEnd + 1;
    const additions = [];
    for (const item of result.sentences) {
      if (item.end > request.commitEnd) break;
      const sentence = semanticSentence(this.source, from, item);
      if (this.sentences.some(s => s.from <= sentence.to && s.to >= sentence.from)) throw new Error('Semantic ranges overlap.');
      additions.push(sentence); from = item.end + 1;
    }
    if (!additions.length) {
      const anchor = request.tokens[0].id, attempts = (this.expansions.get(anchor) || 0) + 1;
      this.expansions.set(anchor, attempts);
      if (request.final || attempts >= 2 || request.tokens.length >= SEMANTIC_TOKEN_LIMIT)
        throw new Error('No complete sentence found in the available context. Original captions remain available.');
      return false;
    }
    this.sentences = [...this.sentences, ...additions].sort((a, b) => a.from - b.from);
    return true;
  }
  timeline() {
    const result = [...this.sentences], source = this.source;
    for (const gap of this.gaps()) {
      const lo = source.tokens[gap.from].lo, hi = source.tokens[gap.to].hi;
      const cues = source.spans.filter(s => s.hi > lo && s.lo < hi).map(s => {
        const a = Math.max(lo, s.lo), b = Math.min(hi, s.hi);
        return { text: source.text.slice(a, b), start: source.timeAt(a), end: source.timeAt(b, true) };
      });
      result.push(...reconstructSentences(cues, { language: source.language }).map(s => ({ ...s, semantic: false })));
    }
    return result.sort((a, b) => a.start - b.start).map((s, id) => ({ ...s, id }));
  }
}

export function validateAlignment(parts, groups) {
  if (!Array.isArray(groups) || !groups.length || groups.length > parts.length) throw new Error('Invalid bilingual alignment.');
  let next = 0;
  for (const group of groups) {
    if (!group || group.from !== next || !Number.isSafeInteger(group.to) || group.to < group.from || group.to >= parts.length ||
        typeof group.translation !== 'string' || !group.translation.trim() || group.translation.length > 16000) throw new Error('Invalid bilingual alignment.');
    next = group.to + 1;
  }
  if (next !== parts.length) throw new Error('Incomplete bilingual alignment.');
  return groups;
}

// Layout chooses only model-approved clause boundaries. A group may exceed the
// reading budget when splitting it would break bilingual correspondence.
export function displayGroups(sentence, translation, alignment, fits = () => false) {
  if (!sentence?.parts?.length || (translation && !alignment)) return [{ ...sentence, translation }];
  const groups = translation ? validateAlignment(sentence.parts, alignment) : sentence.parts.map((_, id) => ({ from: id, to: id, translation: '' }));
  const result = [];
  for (const group of groups) {
    const first = sentence.parts[group.from], last = sentence.parts[group.to];
    const item = { text: sentence.text.slice(first.offsetStart, last.offsetEnd), start: first.start, end: last.end,
      translation: group.translation, offsetStart: first.offsetStart, offsetEnd: last.offsetEnd };
    const prev = result.at(-1);
    const combined = prev && { ...prev, text: sentence.text.slice(prev.offsetStart, item.offsetEnd), end: item.end,
      translation: prev.translation + (prev.translation && item.translation ? joinText(prev.translation, item.translation) : '') + item.translation,
      offsetEnd: item.offsetEnd };
    if (combined && fits(combined.text, combined.translation)) result[result.length - 1] = combined;
    else result.push(item);
  }
  return result;
}
