import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { DEFAULTS } from '../extension/config.js';
import { SemanticTimeline } from '../extension/semantic.js';

test('semantic background validates, caches and isolates source and translation jobs', { timeout: 10000 }, async t => {
  let listener, storageChanged, updated;
  let url = 'https://www.youtube.com/watch?v=abcdefghijk';
  const data = { preferences: { ...DEFAULTS, engine: 'ai', targetLanguage: 'zh' }, providers: { ai: { endpoint: 'https://semantic.example/chat/completions', model: 'fixture', key: '' } } };
  const previousChrome = globalThis.chrome, previousFetch = globalThis.fetch;
  globalThis.chrome = {
    runtime: { id: 'semantic', getURL: file => `chrome-extension://semantic/${file}`, onMessage: { addListener: fn => { listener = fn; } } },
    storage: { local: { setAccessLevel: async () => {}, get: async key => ({ [key]: data[key] }) }, session: { get: async () => ({}) },
      onChanged: { addListener: fn => { storageChanged = fn; } } },
    permissions: { contains: async () => true },
    tabs: { get: async () => ({ id: 1, url }), query: async () => [{ id: 1, url }], sendMessage: async () => ({}),
      onUpdated: { addListener: fn => { updated = fn; } }, onRemoved: { addListener() {} } }
  };
  const sender = { id: 'semantic', frameId: 0, tab: { id: 1 }, url };
  const request = (m, from = sender) => new Promise(resolve => listener(m, from, resolve));
  const input = new SemanticTimeline([{ start: 0, end: 4, text: 'Hello there. Next thought.' }], 'en').plan(0);
  const message = { type: 'segment-subtitles', videoId: 'abcdefghijk', input };
  let calls = 0;
  const success = async (_url, options) => {
    calls++;
    const body = JSON.parse(options.body), p = JSON.parse(body.messages[1].content);
    const result = p.tokens ? { leadingEnd: p.tokens[0].id - 1, sentences: [{ end: p.tokens.at(-1).id, parts: [p.tokens.at(-1).id] }] } :
      p.translateIds ? p.translateIds.map(id => ({ id, translation: `译文${id}` })) : { groups: [{ from: 0, to: p.parts.length - 1, translation: p.translation }] };
    return Response.json({ choices: [{ message: { content: JSON.stringify(result) } }] });
  };
  globalThis.fetch = success;
  try {
    await import(`../extension/background.js?semantic=${Date.now()}`);
    await t.test('rejects wrong sender, video, unindexed text and disabled semantic mode before fetching', async () => {
      const before = calls;
      assert.equal((await request({ type: 'benchmark-provider', engine: 'ai', effort: 'none' })).ok, false);
      assert.equal((await request(message, { id: 'semantic', url: 'chrome-extension://semantic/options.html' })).ok, false);
      assert.equal((await request({ ...message, videoId: 'lmnopqrstuv' })).ok, false);
      assert.equal((await request({ ...message, input: { ...input, text: 'Different source' } })).ok, false);
      data.preferences.semanticSegmentation = false;
      assert.equal((await request(message)).ok, false);
      data.preferences.semanticSegmentation = true;
      assert.equal(calls, before);
    });
    await t.test('caches validated boundary results across target language changes but not context changes', async () => {
      assert.equal((await request(message)).ok, true);
      const before = calls;
      assert.equal((await request(message)).cached, true);
      data.preferences.targetLanguage = 'fr';
      assert.equal((await request(message)).cached, true);
      assert.equal(calls, before);
      assert.equal((await request({ ...message, input: { ...input, after: 'Another topic' } })).cached, false);
      assert.equal(calls, before + 1);
    });
    await t.test('cancelling translation or changing target language leaves semantic work running', async () => {
      let start, release, signal;
      const started = new Promise(resolve => { start = resolve; });
      globalThis.fetch = (u, options) => new Promise((resolve, reject) => {
        signal = options.signal; signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        release = () => resolve(success(u, options)); start();
      });
      const pending = request({ ...message, input: { ...input, before: 'Pending source context' } });
      await started;
      await request({ type: 'cancel-translation' });
      const oldValue = { ...data.preferences }; data.preferences.targetLanguage = 'ja';
      await storageChanged({ preferences: { oldValue, newValue: data.preferences } }, 'local');
      assert.equal(signal.aborted, false); release();
      assert.equal((await pending).ok, true);
      globalThis.fetch = success;
    });
    await t.test('semantic cancellation during setup prevents any provider request', async () => {
      let start, release;
      const started = new Promise(resolve => { start = resolve; });
      chrome.permissions.contains = () => new Promise(resolve => { release = resolve; start(); });
      const before = calls, pending = request({ ...message, input: { ...input, before: 'Cancelled setup' } });
      await started; await request({ type: 'cancel-semantic' }); release(true);
      assert.match((await pending).error, /cancelled/); assert.equal(calls, before);
      chrome.permissions.contains = async () => true;
    });
    await t.test('navigation aborts a running semantic request and rejects late previous-video input', async () => {
      let start;
      const started = new Promise(resolve => { start = resolve; });
      globalThis.fetch = (_url, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }); start();
      });
      const pending = request({ ...message, input: { ...input, before: 'Navigation source context' } });
      await started; url = 'https://www.youtube.com/watch?v=lmnopqrstuv';
      await updated(1, { url }, { id: 1, url });
      assert.equal((await pending).ok, false); assert.match((await request(message)).error, /Video changed/);
      url = sender.url; globalThis.fetch = success;
    });
    await t.test('bilingual alignment validates source coverage and caches separately', async () => {
      const m = { type: 'align-subtitle', videoId: 'abcdefghijk', input: { source: 'en', text: 'Hello there.', translation: '你好。', parts: ['Hello', 'there.'] } };
      const before = calls;
      assert.equal((await request({ ...m, input: { ...m.input, parts: ['Other', 'source'] } })).ok, false);
      assert.equal(calls, before);
      const response = await request(m); assert.equal(response.ok, true, response.error);
      assert.deepEqual(response.result.groups, [{ from: 0, to: 1, translation: '你好。' }]);
      assert.equal((await request(m)).cached, true);
    });
    await t.test('larger batches keep neighbouring references and reject oversized reference input', async () => {
      const m = { type: 'translate-batch', videoId: 'abcdefghijk', source: 'en',
        sentences: Array.from({ length: 48 }, (_, id) => ({ id, text: `Thought ${id}.` })),
        before: '前'.repeat(4000), after: '后'.repeat(4000), references: [{ source: 'bass', translation: '贝斯' }] };
      let received;
      globalThis.fetch = async (u, options) => { received = JSON.parse(JSON.parse(options.body).messages[1].content); return success(u, options); };
      const response = await request(m); assert.equal(response.ok, true, response.error);
      assert.equal(response.translations.length, 48); assert.equal(received.previous.length, 4000);
      assert.equal(received.next.length, 4000); assert.deepEqual(received.references, m.references);
      assert.equal((await request({ ...m, references: [{ source: 'a', translation: 'b'.repeat(4001) }] })).ok, false);
    });
  } finally { globalThis.chrome = previousChrome; globalThis.fetch = previousFetch; }
});
