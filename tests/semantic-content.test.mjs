import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import 'fake-indexeddb/auto';
import { DEFAULTS } from '../extension/config.js';
import { indexSource } from '../extension/semantic.js';
const settle = () => new Promise(resolve => setImmediate(resolve));

test('production content and background complete the semantic, translation and alignment pipeline', { timeout: 10000 }, async t => {
  const window = new Window({ url: 'https://www.youtube.com/watch?v=abcdefghijk' });
  window.document.body.innerHTML = '<div id="movie_player"><video></video><div class="ytp-caption-window-container"></div><div class="ytp-right-controls"></div></div>';
  const player = window.document.getElementById('movie_player'), video = player.querySelector('video');
  player.getBoundingClientRect = () => ({ width: 400, height: 300 });
  Object.defineProperty(video, 'paused', { get: () => true });
  Object.defineProperty(video, 'duration', { get: () => 100 });
  let background, content, changed;
  const intervals = [], calls = [];
  const data = { preferences: { ...DEFAULTS, engine: 'ai', targetLanguage: 'zh', fontSize: 32 },
    providers: { ai: { endpoint: 'https://e2e.example/chat/completions', model: 'fixture', key: '' } } };
  const phrases = ['おはようございます', 'かずきです',
    '今回はミセスグリーンアップルのかっこいいギターフレーズを紹介しますので最後まで見ていただけるとうれしいです', '皆さんこの曲を聞いたことがありますか'];
  const cues = phrases.map((text, i) => ({ start: [0, 2, 4, 14][i], end: [2, 4, 14, 18][i], text }));
  const source = indexSource(cues, 'ja');
  const ends = phrases.map(p => source.tokens.find(t => t.hi === source.text.indexOf(p) + p.length).id);
  const clause = source.tokens.find(t => t.hi === source.text.indexOf('ので') + 2).id;
  const boundaries = { leadingEnd: -1, sentences: ends.map((end, i) => ({ end, parts: i === 2 ? [clause, end] : [end] })) };
  let release, defer = true, failAlignment = false;
  const sender = () => ({ id: 'pipeline', frameId: 0, tab: { id: 1 }, url: 'https://www.youtube.com/watch?v=abcdefghijk' });
  const dispatch = m => new Promise(resolve => background(m, sender(), resolve));
  const chrome = {
    runtime: { id: 'pipeline', getURL: file => `chrome-extension://pipeline/${file}`, onMessage: { addListener: fn => { if (!background) background = fn; else content = fn; } }, sendMessage: dispatch },
    permissions: { contains: async () => true },
    storage: { local: { setAccessLevel: async () => {}, get: async key => ({ [key]: data[key] }),
      set: async patch => {
        const changes = {};
        for (const [key, value] of Object.entries(patch)) { changes[key] = { oldValue: data[key], newValue: value }; data[key] = value; }
        await changed(changes, 'local');
      } }, session: { get: async () => ({}) }, onChanged: { addListener: fn => { changed = fn; } } },
    tabs: { get: async () => ({ id: 1, url: window.location.href }), query: async () => [{ id: 1 }],
      sendMessage: async (_id, m) => new Promise(resolve => content(m, { id: 'pipeline' }, resolve)), onUpdated: { addListener() {} }, onRemoved: { addListener() {} } }
  };
  window.postMessage = m => {
    if (m.direction !== 'request') return;
    const response = m.type === 'discover' ? { ready: true, tracks: [{ id: '.ja', language: 'ja', label: 'Japanese', kind: 'automatic', isDefault: true }] } :
      { body: JSON.stringify({ events: cues.map(c => ({ tStartMs: c.start * 1000, dDurationMs: (c.end - c.start) * 1000, segs: [{ utf8: c.text }] })) }) };
    queueMicrotask(() => window.dispatchEvent(new window.MessageEvent('message', { source: window, origin: window.location.origin,
      data: { ...response, channel: m.channel, direction: 'response', requestId: m.requestId, videoId: m.videoId } })));
  };
  const fetch = async (_url, options) => {
    const payload = JSON.parse(JSON.parse(options.body).messages[1].content); calls.push(payload);
    let result;
    if (payload.tokens) {
      if (defer) await new Promise((resolve, reject) => { release = resolve; options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }); });
      result = boundaries;
    } else if (payload.translateIds) result = payload.translateIds.map(id => ({ id, translation: id === 2 ? '这次会为大家介绍这支乐队非常酷的吉他乐句，希望大家能一直看到最后。' : `完整句译文${id}` }));
    else {
      if (failAlignment) return new Response('', { status: 503 });
      result = { groups: [{ from: 0, to: 0, translation: '这次为大家介绍这支乐队的吉他乐句，' }, { from: 1, to: 1, translation: '希望大家能看到最后。' }] };
    }
    return Response.json({ choices: [{ message: { content: JSON.stringify(result) } }] });
  };
  const saved = new Map();
  for (const [key, value] of Object.entries({ window, document: window.document, navigator: window.navigator, location: window.location, DOMParser: window.DOMParser, chrome, fetch,
    setInterval: fn => { intervals.push(fn); return 1; } })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const root = () => window.document.getElementById('sentence-extension').shadowRoot;
  const tick = async () => { intervals.forEach(fn => fn()); await settle(); };
  const until = async condition => { for (let i = 0; i < 80; i++) { if (condition()) return; await tick(); } assert.fail('Pipeline did not reach expected state'); };
  try {
    await import(`../extension/background.js?pipeline=${Date.now()}`);
    await import(`../extension/content.js?pipeline=${Date.now()}`);
    video.currentTime = 0.5;
    await until(() => !!release);
    await t.test('pending semantics displays labelled fallback and never translates provisional segments', async () => {
      assert.ok(root().getElementById('original').textContent);
      assert.match(root().getElementById('semantic-progress').textContent, /temporary source captions/);
      assert.equal(calls.some(c => c.translateIds), false);
    });
    await t.test('accepted boundaries feed full sentences to actual batch adapter and show matched translations', async () => {
      defer = false; release();
      await until(() => root().getElementById('translated').textContent === '完整句译文0');
      assert.equal(root().getElementById('original').textContent, phrases[0]);
      assert.deepEqual(calls.find(c => c.translateIds).sentences.map(s => s.text), phrases);
      assert.match(root().getElementById('semantic-progress').textContent, /4 confirmed/);
    });
    await t.test('long sentence aligns natural clauses and next sentence jumps over its internal display break', async () => {
      video.currentTime = 5;
      await until(() => calls.some(c => c.parts));
      await until(() => root().getElementById('translated').textContent === '这次为大家介绍这支乐队的吉他乐句，');
      assert.equal(calls.find(c => c.parts).translation, '这次会为大家介绍这支乐队非常酷的吉他乐句，希望大家能一直看到最后。');
      root().getElementById('next').click(); await tick();
      assert.ok(Math.abs(video.currentTime - 14) < .01);
      assert.equal(root().getElementById('original').textContent, phrases[3]);
    });
    await t.test('target language changes reuse semantic boundaries and repeat only translation', async () => {
      const count = calls.filter(c => c.tokens).length;
      await dispatch({ type: 'set-preferences', preferences: { targetLanguage: 'fr' } });
      await until(() => calls.filter(c => c.translateIds).length > 1);
      assert.equal(calls.filter(c => c.tokens).length, count);
    });
    await t.test('alignment failure pauses retries while original semantic clauses remain available', async () => {
      failAlignment = true; video.currentTime = 5;
      await until(() => root().getElementById('status').textContent.includes('Bilingual alignment:'));
      const count = calls.filter(c => c.parts).length;
      await tick(); await tick(); assert.equal(calls.filter(c => c.parts).length, count);
      assert.ok(root().getElementById('original').textContent);
      assert.equal(root().getElementById('retry').hidden, false);
      failAlignment = false; root().getElementById('retry').click();
      await until(() => root().getElementById('translated').textContent === '这次为大家介绍这支乐队的吉他乐句，');
    });
    await t.test('original-only display retains semantic processing without making translation requests', async () => {
      await dispatch({ type: 'set-preferences', preferences: { mode: 'original' } });
      const count = calls.length; await tick(); await tick();
      assert.equal(calls.length, count); assert.equal(root().getElementById('translated').hidden, true);
      assert.match(root().getElementById('semantic-progress').textContent, /4 confirmed/);
    });
    await t.test('disabling semantic mode restores rule segments and disabling overlay restores native captions', async () => {
      await dispatch({ type: 'set-preferences', preferences: { semanticSegmentation: false } }); await tick();
      assert.match(root().getElementById('semantic-progress').textContent, /semantic sentences off/);
      await dispatch({ type: 'set-preferences', preferences: { enabled: false } }); await tick();
      assert.equal(player.classList.contains('sentence-native-hidden'), false);
    });
  } finally {
    for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
    await window.happyDOM.abort();
  }
});
