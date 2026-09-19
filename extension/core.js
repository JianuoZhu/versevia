// Pure timing and text functions shared by the content script and tests.
export function cleanText(text) {
  return String(text ?? '').replace(/\u200b/g, '').replace(/\s+/g, ' ').trim();
}

const unspaced = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
const terminal = /[.!?。！？｡؟۔।॥።፧။]/u;
const closing = /["'”’»）)\]】」』》〉]/u;
export function joinText(left, right) {
  const last = [...left].at(-1), first = [...right][0];
  return (unspaced.test(last || '') && unspaced.test(first || '')) || /^[,.;:!?，。！？、；：؟۔।॥]/u.test(right) ? '' : ' ';
}

export function normalizeCues(cues) {
  const out = [];
  for (const cue of cues.filter(c => Number.isFinite(c.start) && Number.isFinite(c.end) && c.end > c.start)
    .sort((a, b) => a.start - b.start)) {
    let text = cleanText(cue.text);
    if (!text || cue.start < 0) continue;
    const prev = out.at(-1);
    // Rolling captions repeat a prefix while the preceding event is still on screen.
    if (prev && cue.start < prev.end) {
      if (prev.text === text) { prev.end = Math.max(prev.end, cue.end); continue; }
      const a = prev.text.split(' '), b = text.split(' ');
      let matched = false;
      for (let n = Math.min(a.length, b.length); n >= 1; n--) {
        if (a.slice(-n).join(' ') === b.slice(0, n).join(' ')) {
          text = b.slice(n).join(' '); matched = true; break;
        }
      }
      // Rolling Chinese/Japanese captions often have no whitespace at all.
      if (!matched && unspaced.test(prev.text) && unspaced.test(text)) {
        const left = [...prev.text], right = [...text];
        for (let n = Math.min(left.length, right.length); n >= 2; n--) {
          if (left.slice(-n).join('') === right.slice(0, n).join('')) { text = right.slice(n).join(''); break; }
        }
      }
      prev.end = Math.min(prev.end, cue.start);
    }
    if (text) out.push({ start: cue.start, end: cue.end, text });
  }
  return out.filter(c => c.end > c.start);
}

export function parseJson3(data) {
  const cues = [];
  for (const event of data.events ?? []) {
    if (!event.segs || !Number.isFinite(event.tStartMs)) continue;
    const start = event.tStartMs / 1000;
    const end = start + Math.max(0.02, (event.dDurationMs ?? 2000) / 1000);
    // Offset-bearing ASR segments provide substantially better sentence boundaries.
    if (event.segs.some(s => Number.isFinite(s.tOffsetMs))) {
      event.segs.forEach((seg, i) => {
        const segStart = start + Math.max(0, seg.tOffsetMs ?? 0) / 1000;
        const next = event.segs.slice(i + 1).find(s => Number.isFinite(s.tOffsetMs));
        cues.push({ start: segStart, end: Math.max(segStart + 0.02, next ? start + next.tOffsetMs / 1000 : end), text: seg.utf8 });
      });
    } else cues.push({ start, end, text: event.segs.map(s => s.utf8 ?? '').join('') });
  }
  return normalizeCues(cues);
}

function boundaryAt(text, index, language) {
  const char = text[index];
  if (!terminal.test(char)) return false;
  if (char === '.' && (/\p{N}/u.test(text[index - 1] ?? '') && /\p{N}/u.test(text[index + 1] ?? ''))) return false;
  const before = text.slice(0, index + 1);
  if (char === '.' && /(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc)|\b[A-Z]|\be\.g|\bi\.e)\.$/i.test(before)) return false;
  const abbreviations = { ru: /(?:^|\s)(?:г|ул|им|д|рис|стр|т\.д|т\.п)\.$/iu,
    uk: /(?:^|\s)(?:м|вул|ім|стор|р)\.$/iu, de: /(?:^|\s)(?:Hr|Fr|bzw|usw|z\.B)\.$/iu,
    fr: /(?:^|\s)(?:M|Mme|Mlle|Pr)\.$/iu, es: /(?:^|\s)(?:Sr|Sra|Srta|Ud|Uds)\.$/iu };
  if (char === '.' && abbreviations[language]?.test(before)) return false;
  // Initials can use any alphabet (e.g. А. П. Чехов).
  if (char === '.' && /(?:^|\s)\p{Lu}\.$/u.test(before)) return false;
  return char !== '.' || index === text.length - 1 || /\s/.test(text[index + 1]) || closing.test(text[index + 1]) || unspaced.test(text[index + 1]);
}

export function reconstructSentences(rawCues, { maxChars, maxSeconds = 7, gapSeconds = 0.7, language = 'und' } = {}) {
  language = String(language).split('-')[0].toLowerCase();
  const cues = normalizeCues(rawCues);
  // Unpunctuated ASR is common. CJK text needs a smaller reading budget than Latin
  // text; this is a display fallback, not evidence of a semantic sentence boundary.
  maxChars ??= /^(ja|zh|ko)$/.test(language) || cues.some(c => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(c.text)) ? 48 : 120;
  let segmenter;
  try { segmenter = new Intl.Segmenter(language === 'auto' ? 'und' : language, { granularity: 'word' }); }
  catch { segmenter = new Intl.Segmenter('und', { granularity: 'word' }); }
  const units = [];
  for (const cue of cues) {
    const text = cue.text;
    // Retain character-to-time mapping, including multiple sentences within one cue.
    let begin = 0;
    for (let i = 0; i < text.length; i++) {
      if (!boundaryAt(text, i, language) && i !== text.length - 1) continue;
      let finish = i + 1;
      while (finish < text.length && (terminal.test(text[finish]) || closing.test(text[finish]))) finish++;
      const fragment = text.slice(begin, finish).trim();
      if (fragment) units.push({ text: fragment, start: cue.start + (cue.end - cue.start) * begin / text.length,
        end: cue.start + (cue.end - cue.start) * finish / text.length, terminal: boundaryAt(text, i, language) });
      begin = finish; i = finish - 1;
    }
  }
  // Split oversized source units before merging. That keeps the actual offsets of
  // small ASR cues instead of redistributing their timing across a whole paragraph.
  const bounded = [];
  for (const unit of units) {
    const budget = Math.max(1, Math.min(maxChars, Math.floor(unit.text.length * maxSeconds / (unit.end - unit.start))));
    let remaining = unit.text, consumed = 0;
    while (remaining.length > budget) {
      const window = remaining.slice(0, budget);
      const natural = [...window.matchAll(/[,;:，；：、،؛]\s*|\s+/gu)].at(-1);
      let cut = natural && natural.index >= budget * 0.35 ? natural.index + natural[0].length : 0;
      if (!cut) {
        const boundaries = [...segmenter.segment(remaining)].map(s => s.index).filter(i => i > 0 && i <= budget);
        cut = boundaries.at(-1) || 0;
      }
      if (cut < budget * 0.35 && unspaced.test(remaining)) {
        const boundaries = [...new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(remaining)].map(s => s.index).filter(i => i > 0);
        cut = boundaries.filter(i => i <= budget).at(-1) || boundaries[0] || remaining.length;
      }
      // Preserve an indivisible word; do not truncate it or invent a word boundary.
      if (!cut) break;
      const text = remaining.slice(0, cut).trim();
      if (text) bounded.push({ text, start: unit.start + (unit.end - unit.start) * consumed / unit.text.length,
        end: unit.start + (unit.end - unit.start) * (consumed + cut) / unit.text.length, terminal: false });
      consumed += cut; remaining = remaining.slice(cut);
    }
    if (remaining.trim()) bounded.push({ text: remaining.trim(),
      start: unit.start + (unit.end - unit.start) * consumed / unit.text.length, end: unit.end, terminal: unit.terminal });
  }
  const merged = [];
  let current;
  const flush = () => { if (current) merged.push(current); current = undefined; };
  for (const unit of bounded) {
    if (current && (unit.start - current.end > gapSeconds || current.text.length + joinText(current.text, unit.text).length + unit.text.length > maxChars || unit.end - current.start > maxSeconds)) flush();
    if (!current) current = { start: unit.start, end: unit.end, text: unit.text };
    else {
      const join = joinText(current.text, unit.text);
      current.text += join + unit.text; current.end = unit.end;
    }
    if (unit.terminal) flush();
  }
  flush();
  return merged.map((s, id) => ({ ...s, id }));
}

export function sentenceIndex(timeline, time) {
  let low = 0, high = timeline.length - 1, found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (timeline[mid].start <= time) { found = mid; low = mid + 1; } else high = mid - 1;
  }
  return found >= 0 && time < timeline[found].end ? found : -1;
}

export function navigationTarget(timeline, time, direction) {
  if (direction > 0) return timeline.find(s => s.start > time + 0.08)?.start ?? null;
  const active = sentenceIndex(timeline, time);
  if (active >= 0) return timeline[active - 1]?.start ?? null;
  return timeline.findLast(s => s.start < time - 0.08)?.start ?? null;
}

export function isTypingEvent(event) {
  return event.composedPath().some(el => el?.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(el?.tagName ?? '') ||
    ['textbox', 'combobox', 'slider', 'menu', 'menuitem', 'listbox'].includes(el?.getAttribute?.('role')));
}

export function validateEndpoint(value) {
  const url = new URL(value);
  if (url.username || url.password || url.hash || url.search) throw new Error('Use an endpoint URL without credentials, query parameters, or a fragment.');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
    throw new Error('Use HTTPS, or HTTP on localhost / 127.0.0.1 for a local provider.');
  }
  return url;
}

export function transcriptionCues(data, offset, duration) {
  if (!Array.isArray(data.segments)) throw new Error('Provider did not return timestamped segments. Use a model supporting verbose_json, such as whisper-1.');
  return normalizeCues(data.segments.filter(s => Number.isFinite(s.start) && Number.isFinite(s.end) && s.start >= 0 && s.start < duration)
    .map(s => ({ start: offset + s.start, end: offset + Math.min(duration, s.end), text: s.text })));
}
