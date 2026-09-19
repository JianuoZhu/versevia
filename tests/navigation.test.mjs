import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { DEFAULTS } from '../extension/config.js';

test('translation follows the current YouTube video across same-document navigation', { timeout: 10000 }, async t => {
  const first = 'abcdefghijk', next = 'lmnopqrstuv';
  let listener, updated;
  let tabURL = `https://www.youtube.com/watch?v=${first}`;
  const storage = { preferences: { ...DEFAULTS, engine: 'ai', mode: 'bilingual', targetLanguage: 'zh' },
    providers: { ai: { endpoint: 'https://navigation.example/chat/completions', model: 'fixture', key: '' } } };
  const originalChrome = globalThis.chrome, originalFetch = globalThis.fetch;
  const sender = { id: 'navigation', frameId: 0, tab: { id: 7, url: tabURL }, url: tabURL };
  globalThis.chrome = {
    runtime: { id: 'navigation', getURL: file => `chrome-extension://navigation/${file}`, onMessage: { addListener: fn => { listener = fn; } } },
    storage: { local: { setAccessLevel: async () => {}, get: async key => ({ [key]: storage[key] }) },
      session: { get: async () => ({}) }, onChanged: { addListener() {} } },
    permissions: { contains: async () => true },
    tabs: { get: async () => ({ id: 7, url: tabURL }),
      sendMessage: async () => ({ ok: false }),
      onUpdated: { addListener: fn => { updated = fn; } }, onRemoved: { addListener() {} } }
  };
  const request = (message, from = sender) => new Promise(resolve => listener(message, from, resolve));
  let calls = 0;
  const success = async (_url, options) => {
    calls++;
    if (storage.preferences.engine === 'mymemory') return Response.json({ responseStatus: 200, responseData: { translatedText: '译文' } });
    const payload = JSON.parse(JSON.parse(options.body).messages[1].content);
    return Response.json({ choices: [{ message: { content: JSON.stringify(payload.translateIds.map(id => ({ id, translation: `译文${id}` }))) } }] });
  };
  const message = (videoId, text) => storage.preferences.engine === 'ai'
    ? { type: 'translate-batch', videoId, source: 'en', sentences: [{ id: 0, text }] }
    : { type: 'translate', videoId, source: 'en', text };
  try {
    await import(`../extension/background.js?navigation=${Date.now()}`);
    for (const engine of ['ai', 'mymemory']) {
      await t.test(`${engine}: navigation, retry and cancellation`, async t => {
        storage.preferences.engine = engine;
        globalThis.fetch = success;
        await t.test('new video works with a stale sender URL, including a document opened on Home', async () => {
          tabURL = `https://www.youtube.com/watch?v=${next}`;
          for (const url of [sender.url, 'https://www.youtube.com/']) {
            const result = await request(message(next, `${engine} new video from ${url}`), { ...sender, url });
            assert.equal(result.ok, true, result.error);
          }
        });
        await t.test('old-video requests and non-watch URLs are rejected before provider access', async () => {
          const before = calls;
          assert.match((await request(message(first, 'Old video.'))).error, /Video changed/);
          tabURL = `https://www.youtube.com/shorts/${next}?v=${next}`;
          assert.match((await request(message(next, 'Not a watch page.'))).error, /Video changed/);
          assert.equal(calls, before);
          tabURL = `https://www.youtube.com/watch?v=${next}`;
        });
        await t.test('explicit retry succeeds on the new video after a provider failure', async () => {
          globalThis.fetch = async () => new Response('', { status: 503 });
          const m = message(next, `${engine} retry sentence.`);
          assert.equal((await request(m)).ok, false);
          await request({ type: 'cancel-translation' });
          globalThis.fetch = success;
          const result = await request(m);
          assert.equal(result.ok, true, result.error);
        });
        await t.test('cancelling during provider setup prevents a late request from entering the queue', async () => {
          let started, release;
          const checking = new Promise(resolve => { started = resolve; });
          chrome.permissions.contains = () => new Promise(resolve => { release = resolve; started(); });
          const before = calls;
          const pending = request(message(next, `${engine} cancelled during setup.`));
          await checking;
          await request({ type: 'cancel-translation' });
          release(true);
          try {
            assert.match((await pending).error, /cancelled/);
            assert.equal(calls, before);
          } finally { chrome.permissions.contains = async () => true; }
        });
        await t.test('navigation during provider setup rejects the old video before sending text', async () => {
          let started, release;
          const checking = new Promise(resolve => { started = resolve; });
          chrome.permissions.contains = () => new Promise(resolve => { release = resolve; started(); });
          const before = calls;
          const pending = request(message(next, `${engine} navigation during setup.`));
          await checking;
          tabURL = `https://www.youtube.com/watch?v=${first}`;
          await updated(7, { url: tabURL }, { id: 7, url: tabURL });
          release(true);
          try {
            assert.match((await pending).error, /Video changed/);
            assert.equal(calls, before);
          } finally {
            chrome.permissions.contains = async () => true;
            tabURL = `https://www.youtube.com/watch?v=${next}`;
          }
        });
        await t.test('late navigation events and same-video query changes keep the new request alive', async () => {
          let started, release, signal;
          const fetching = new Promise(resolve => { started = resolve; });
          globalThis.fetch = (url, options) => new Promise((resolve, reject) => {
            signal = options.signal;
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
            release = () => resolve(success(url, options)); started();
          });
          const pending = request(message(next, `${engine} pending new video.`));
          await fetching;
          try {
            await updated(7, { url: tabURL }, { id: 7, url: tabURL });
            await updated(7, { url: `${tabURL}&t=20` }, { id: 7, url: `${tabURL}&t=20` });
            assert.equal(signal.aborted, false);
          } finally { release(); }
          assert.equal((await pending).ok, true);
        });
        await t.test('navigation still aborts a request belonging to the previous video', async () => {
          let started;
          const fetching = new Promise(resolve => { started = resolve; });
          globalThis.fetch = (_url, options) => new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }); started();
          });
          const pending = request(message(next, `${engine} leaving this video.`));
          await fetching;
          tabURL = `https://www.youtube.com/watch?v=${first}`;
          await updated(7, { url: tabURL }, { id: 7, url: tabURL });
          assert.equal((await pending).ok, false);
          globalThis.fetch = success;
        });
      });
    }
    await t.test('speech cache restoration also accepts the current video with a stale sender URL', async () => {
      tabURL = `https://www.youtube.com/watch?v=${next}`;
      const result = await request({ type: 'speech-cached', videoId: next });
      assert.equal(result.ok, true, result.error);
    });
  } finally { globalThis.chrome = originalChrome; globalThis.fetch = originalFetch; }
});
