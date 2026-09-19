// Deterministic production-pipeline diagnostic. No network or credentials.
// Run once normally and once with --long. Gates simulate response ordering,
// not actual OpenAI response times. Production files are not modified.
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import 'fake-indexeddb/auto';
import { DEFAULTS } from '../extension/config.js';
import { indexSource } from '../extension/semantic.js';

const reindex = process.argv.includes('--reindex');
const coverage = process.argv.includes('--coverage');
const alignmentFirst = process.argv.includes('--alignment');
const seek = process.argv.includes('--seek') || reindex;
const full = process.argv.includes('--full') || reindex;
const long = process.argv.includes('--long') || seek || alignmentFirst;
const window = new Window({ url: 'https://www.youtube.com/watch?v=abcdefghijk' });
window.document.body.innerHTML = '<div id="movie_player"><video></video><div class="ytp-right-controls"></div></div>';
const player = window.document.getElementById('movie_player'), video = player.querySelector('video');
player.getBoundingClientRect = () => ({ width: 400, height: 300 });
Object.defineProperty(video, 'paused', { get: () => true });
Object.defineProperty(video, 'duration', { get: () => 200 });
let background, content, changed;
const intervals = [], calls = [], trace = [];
const data = { preferences: { ...DEFAULTS, engine: 'ai', targetLanguage: 'zh', fontSize: 32 },
  providers: { ai: { endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-5.6-luna', key: '' } } };
const phrases = ['おはようございます', 'かずきです',
  '今回はミセスグリーンアップルのかっこいいギターフレーズを紹介しますので最後まで見ていただけるとうれしいです', '皆さんこの曲を聞いたことがありますか'];
const cues = phrases.map((text, i) => ({ start: [0, 2, 4, 14][i], end: [2, 4, 14, 18][i], text }));
if (long) for (let i = 0; i < 70; i++) cues.push({ start: 18 + i * 2, end: 20 + i * 2, text: `続いて第${i + 1}の例を紹介します。` });
if (coverage) cues.splice(0, cues.length, ...Array.from({ length: 95 }, (_, i) => ({ start: i * 7, end: i * 7 + 6, text: `続いて第${i + 1}の練習方法を紹介します。` })));
const source = indexSource(cues, 'ja');
const ends = source.spans.map(s => source.tokens.find(t => t.hi === s.hi).id);
const clause = coverage ? -1 : source.tokens.find(t => t.hi === source.text.indexOf('ので') + 2).id;
const sender = () => ({ id: 'latency', frameId: 0, tab: { id: 1 }, url: window.location.href });
const dispatch = m => new Promise(resolve => background(m, sender(), resolve));
const chrome = {
  runtime: { id: 'latency', getURL: f => `chrome-extension://latency/${f}`, onMessage: { addListener: f => { if (!background) background = f; else content = f; } }, sendMessage: dispatch },
  permissions: { contains: async () => true },
  storage: { local: { setAccessLevel: async () => {}, get: async k => ({ [k]: data[k] }), set: async patch => {
    const changes = {}; for (const [k, v] of Object.entries(patch)) { changes[k] = { oldValue: data[k], newValue: v }; data[k] = v; }
    await changed(changes, 'local');
  } }, session: { get: async () => ({}) }, onChanged: { addListener: f => { changed = f; } } },
  tabs: { get: async () => ({ id: 1, url: window.location.href }), query: async () => [{ id: 1 }],
    sendMessage: async (_id, m) => new Promise(resolve => content(m, { id: 'latency' }, resolve)), onUpdated: { addListener() {} }, onRemoved: { addListener() {} } }
};
window.postMessage = m => {
  if (m.direction !== 'request') return;
  const response = m.type === 'discover' ? { ready: true, tracks: [{ id: '.ja', language: 'ja', label: 'Japanese', kind: 'automatic', isDefault: true }] } :
    { body: JSON.stringify({ events: cues.map(c => ({ tStartMs: c.start * 1000, dDurationMs: (c.end - c.start) * 1000, segs: [{ utf8: c.text }] })) }) };
  queueMicrotask(() => window.dispatchEvent(new window.MessageEvent('message', { source: window, origin: window.location.origin,
    data: { ...response, channel: m.channel, direction: 'response', requestId: m.requestId, videoId: m.videoId } })));
};
const fetch = async (_url, options) => {
  const body = JSON.parse(options.body), input = JSON.parse(body.messages[1].content);
  const kind = input.tokens ? 'segmentation' : input.translateIds ? 'translation' : 'alignment';
  const call = { id: calls.length + 1, kind, input, aborted: false };
  calls.push(call);
  trace.push({ event: 'request', id: call.id, kind, reasoning: body.reasoning_effort ?? 'omitted', stream: body.stream ?? false,
    inputChars: options.body.length, sentences: input.translateIds?.length, from: input.tokens?.[0].id, to: input.tokens?.at(-1).id });
  await new Promise((resolve, reject) => {
    call.release = () => { call.released = true; resolve(); };
    options.signal.addEventListener('abort', () => { call.aborted = true; trace.push({ event: 'aborted', id: call.id, kind }); reject(options.signal.reason); }, { once: true });
  });
  let result;
  if (kind === 'segmentation') {
    let selected = ends.filter(e => e >= input.tokens[0].id && e <= input.tokens.at(-1).id);
    if (input.final && selected.at(-1) !== input.tokens.at(-1).id) selected.push(input.tokens.at(-1).id);
    if (reindex && call.id > 4) selected = selected.filter((_, i, a) => i % 2 === 1 || i === a.length - 1);
    result = { leadingEnd: input.tokens[0].id - 1,
      sentences: selected.map(end => ({ end, parts: !coverage && end === ends[2] ? [clause, end] : [end] })) };
  }
  else if (kind === 'translation') result = input.translateIds.map(id => ({ id, translation: id === 2 ? '这次会为大家介绍这支乐队非常酷的吉他乐句，希望大家能一直看到最后。' : `完整句译文${id}` }));
  else result = { groups: [{ from: 0, to: 0, translation: '这次介绍精彩的吉他乐句，' }, { from: 1, to: 1, translation: '希望大家看到最后。' }] };
  trace.push({ event: 'response', id: call.id, kind });
  return Response.json({ choices: [{ message: { content: JSON.stringify(result) } }] });
};
const saved = new Map();
for (const [key, value] of Object.entries({ window, document: window.document, navigator: window.navigator, location: window.location,
  DOMParser: window.DOMParser, chrome, fetch, setInterval: f => { intervals.push(f); return 1; } })) {
  saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const root = () => window.document.getElementById('sentence-extension').shadowRoot;
const tick = async () => { intervals.forEach(f => f()); await new Promise(resolve => setImmediate(resolve)); };
const until = async condition => { for (let i = 0; i < 200; i++) { if (condition()) return; await tick(); } assert.fail('Pipeline did not reach expected state'); };
try {
  await import('../extension/background.js'); await import('../extension/content.js'); video.currentTime = 5;
  await until(() => calls.length === 1);
  assert.equal(calls[0].kind, 'segmentation');
  if (full) root().getElementById('translate-all').click();
  if (coverage) {
    for (let i = 0; i < 500; i++) {
      for (const call of calls) if (!call.aborted && !call.released) call.release();
      await tick();
    }
    const translated = root().getElementById('translation-progress').textContent;
    const segmented = root().getElementById('semantic-progress').textContent;
    if (full) assert.match(translated, /Complete · 95 \/ 95/);
    else { assert.match(translated, /Nearby/); assert.doesNotMatch(translated, /95 \/ 95/); }
    assert.equal(calls.some(c => !c.aborted && !c.released), false);
    console.log(JSON.stringify({ mode: 'production pipeline, mocked responses; not API timing', full,
      sourceSentences: 95, sourceSeconds: cues.at(-1).end, translated, segmented,
      segmentationRequests: calls.filter(c => c.kind === 'segmentation').length,
      translationBatchSizes: calls.filter(c => c.kind === 'translation').map(c => c.input.translateIds.length),
      abortedRequests: calls.filter(c => c.aborted).length }, null, 2));
  } else {
  calls[0].release();
  await until(() => calls.some(c => c.kind === 'translation'));
  const translation = calls.find(c => c.kind === 'translation');
  if (long) {
    await until(() => calls.filter(c => c.kind === 'segmentation').length === 2);
    const second = calls.filter(c => c.kind === 'segmentation')[1];
    if (seek) {
      video.currentTime = 135;
      video.dispatchEvent(new window.Event('seeking', { bubbles: true }));
      await until(() => calls.filter(c => c.kind === 'segmentation').length >= 3);
      assert.equal(second.aborted, true, 'seek cancels unrelated segmentation, including whole-video mode');
      assert.equal(translation.aborted, true, 'seek cancels old translation');
      const near = calls.filter(c => c.kind === 'segmentation')[2];
      assert.ok(source.tokens[near.input.tokens[0].id].start >= 110, 'restart near seek, not at old gap start');
      const count = calls.filter(c => c.kind === 'translation').length;
      for (let i = 0; i < 10; i++) await tick();
      assert.equal(calls.filter(c => c.kind === 'translation').length, count, 'do not backfill old translations while current semantics are pending');
      near.release();
      await until(() => calls.filter(c => c.kind === 'translation').length > count);
      const priority = calls.filter(c => c.kind === 'translation').at(-1);
      assert.ok(priority.input.sentences[0].text.includes('第59'), 'translate the sentence at 135 seconds first');
      const expected = `完整句译文${priority.input.translateIds[0]}`;
      if (reindex) {
        const backfill = calls.filter(c => c.kind === 'segmentation').at(-1);
        assert.notEqual(backfill, near);
        assert.ok(source.tokens[backfill.input.tokens[0].id].start < 110, 'whole-video resumes the older gap at its beginning');
        const snapshot = () => new Promise(resolve => content({ type: 'snapshot' }, { id: 'latency' }, resolve));
        const before = (await snapshot()).sentences;
        backfill.release();
        for (let i = 0; i < 30; i++) await tick();
        assert.notEqual((await snapshot()).sentences, before, 'gap resolution shifts sentence IDs');
        assert.equal(priority.aborted, false, 'pending translation survives positional ID changes');
        assert.equal(calls.filter(c => c.kind === 'translation').length, count + 1);
      }
      priority.release();
      await until(() => !!root().getElementById('translated').textContent);
      assert.equal(root().getElementById('translated').textContent, expected, 'late result maps back to its exact source sentence');
      trace.push({ finding: 'seek prioritizes new semantics and translations; old work is aborted', full });
    } else {
      let aligning;
      if (alignmentFirst) {
        translation.release();
        await until(() => calls.some(c => c.kind === 'alignment'));
        aligning = calls.find(c => c.kind === 'alignment');
      }
      second.release();
      for (let i = 0; i < 40; i++) await tick();
      assert.equal(translation.aborted, false, 'unchanged translation must survive semantic timeline updates');
      assert.equal(calls.filter(c => c.kind === 'translation' && JSON.stringify(c.input.translateIds) === JSON.stringify(translation.input.translateIds)).length, 1, 'no duplicate translation');
      if (aligning) assert.equal(aligning.aborted, false, 'alignment survives unrelated semantic updates');
      else translation.release();
      await until(() => calls.some(c => c.kind === 'alignment'));
      calls.find(c => c.kind === 'alignment').release();
      await until(() => !!root().getElementById('translated').textContent);
      trace.push({ finding: 'unchanged translation survives next semantic window and reaches display without resending' });
    }
  } else {
    assert.equal(root().getElementById('translated').textContent, '');
    translation.release();
    await until(() => calls.some(c => c.kind === 'alignment'));
    assert.equal(root().getElementById('translated').textContent, '');
    calls.find(c => c.kind === 'alignment').release();
    await until(() => !!root().getElementById('translated').textContent);
    trace.push({ finding: 'first long-sentence translation appears only after three sequential provider responses' });
  }
  console.log(JSON.stringify({ mode: 'simulation; no live API timings', scenario: long ? 'prefetch cancellation' : 'cold long sentence', trace }, null, 2));
  }
} finally {
  await dispatch({ type: 'cancel-semantic' }); await dispatch({ type: 'cancel-translation' });
  for (const [k, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, k, descriptor); else delete globalThis[k]; }
  await window.happyDOM.abort();
}
