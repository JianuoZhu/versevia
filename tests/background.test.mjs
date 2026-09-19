import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { DEFAULTS } from '../extension/config.js';
import { Window } from 'happy-dom';
import { readFile } from 'node:fs/promises';
test('background enforces trust boundaries and explicit capture initiation', async t => {
  const storage = { local: { preferences: { ...DEFAULTS }, providers: { asr: { endpoint: 'https://speech.example/v1/audio/transcriptions', model: 'whisper-1', key: 'fixture-key' } } }, session: {} };
  let listener, changed, removed, updated, trustedAccess, offscreenExists = false, captures = 0;
  let snapshot = { videoId: 'abcdefghijk', time: 12, duration: 100, paused: false, rate: 1, ad: false };
  const sent = [], messages = [];
  const area = name => ({ get: async key => ({ [key]: storage[name][key] }), set: async values => { Object.assign(storage[name], values); },
    remove: async key => { delete storage[name][key]; }, setAccessLevel: async value => { trustedAccess = value.accessLevel; } });
  const chrome = { runtime: { id: 'fixture', getURL: file => `chrome-extension://fixture/${file}`, openOptionsPage: async () => {},
    onMessage: { addListener: fn => { listener = fn; } }, sendMessage: async m => { messages.push(m); return { ok: true }; } },
    storage: { local: area('local'), session: area('session'), onChanged: { addListener: fn => { changed = fn; } } },
    permissions: { contains: async () => true },
    tabs: { get: async () => ({ id: 7, url: 'https://www.youtube.com/watch?v=abcdefghijk' }),
      query: async () => [{ id: 7, url: 'https://www.youtube.com/watch?v=abcdefghijk' }],
      sendMessage: async (id, m) => { sent.push({ id, m }); return m.type === 'snapshot' ? snapshot : { ok: true }; },
      onRemoved: { addListener: fn => { removed = fn; } }, onUpdated: { addListener: fn => { updated = fn; } } },
    offscreen: { hasDocument: async () => offscreenExists, createDocument: async () => { offscreenExists = true; } },
    tabCapture: { getMediaStreamId: async () => { captures++; return 'fixture-stream'; } } };
  globalThis.chrome = chrome;
  await import(`../extension/background.js?test=${Date.now()}`);
  const popup = { id: 'fixture', url: 'chrome-extension://fixture/popup.html' };
  const content = { id: 'fixture', frameId: 0, tab: { id: 7 }, url: 'https://www.youtube.com/watch?v=abcdefghijk' };
  const request = (m, sender = popup) => new Promise(resolve => listener(m, sender, resolve));
  await t.test('options opened as a browser tab can load and save every provider', async () => {
    const options = { id: 'fixture', url: 'chrome-extension://fixture/options.html', frameId: 0, tab: { id: 20 } };
    const loaded = await request({ type: 'get-providers' }, options);
    assert.equal(loaded.ok, true, loaded.error);
    for (const [id, config] of Object.entries(loaded.providers)) {
      const saved = await request({ type: 'save-provider', id, config }, options);
      assert.equal(saved.ok, true, `${id}: ${saved.error}`);
    }
    assert.equal((await request({ type: 'get-preferences' }, { ...options, url: `${options.url}?from=player#translation` })).ok, true);
  });
  await t.test('a tab alone never grants provider access to content scripts or foreign pages', async () => {
    for (const sender of [content, { ...content, url: 'https://example.com/options.html' },
      { ...content, url: 'chrome-extension://other/options.html' },
      { ...content, url: 'chrome-extension://fixture/options.html.evil' },
      { ...content, url: 'chrome-extension://fixture/options.html', frameId: 2 },
      { ...popup, id: 'other', url: 'chrome-extension://fixture/options.html' }]) {
      assert.equal((await request({ type: 'get-providers' }, sender)).ok, false);
      assert.equal((await request({ type: 'save-provider', id: 'deepl', config: {} }, sender)).ok, false);
    }
  });
  await t.test('credentials are restricted to trusted extension pages', async () => {
    assert.equal(trustedAccess, 'TRUSTED_CONTEXTS');
    assert.equal((await request({ type: 'get-providers' }, content)).ok, false);
    assert.equal((await request({ type: 'save-provider', id: 'asr' }, content)).ok, false);
    const response = await request({ type: 'get-preferences' }, content);
    assert.equal(JSON.stringify(response).includes('fixture-key'), false);
    assert.equal((await request({ type: 'get-preferences' }, { id: 'other' })).ok, false);
  });
  await t.test('selecting generated source never starts capture', async () => {
    await request({ type: 'set-preferences', preferences: { sourceKind: 'generated' } }, content);
    assert.equal(captures, 0); assert.equal(storage.local.preferences.engine, 'none');
  });
  await t.test('speech readiness checks credentials and permission without starting capture or exposing keys', async () => {
    const saved = storage.local.providers.asr;
    storage.local.providers.asr = { endpoint: 'https://api.openai.com/v1/audio/transcriptions', model: 'whisper-1', key: '' };
    const missing = await request({ type: 'speech-readiness' });
    assert.equal(missing.ready, false); assert.match(missing.message, /API key/); assert.equal(captures, 0);
    chrome.permissions.contains = async () => false;
    assert.equal((await request({ type: 'speech-readiness' })).ready, false);
    chrome.permissions.contains = async () => true;
    storage.local.providers.asr = saved;
    const configured = await request({ type: 'speech-readiness' });
    assert.equal(configured.ready, true); assert.equal(JSON.stringify(configured).includes('fixture-key'), false);
    assert.equal(captures, 0);
    assert.equal((await request({ type: 'speech-readiness' }, content)).ok, false);
  });
  await t.test('capture rejects absent consent, content-script start and unsafe playback', async () => {
    assert.equal((await request({ type: 'capture-start', tabId: 7, confirmed: false })).ok, false);
    assert.equal((await request({ type: 'capture-start', tabId: 7, confirmed: true }, content)).ok, false);
    snapshot.paused = true;
    assert.equal((await request({ type: 'capture-start', tabId: 7, confirmed: true })).ok, false); snapshot.paused = false;
    snapshot.rate = 2;
    assert.equal((await request({ type: 'capture-start', tabId: 7, confirmed: true })).ok, false); snapshot.rate = 1;
    assert.equal(captures, 0);
  });
  await t.test('explicit popup initiation captures only active tab and prevents duplicate sessions', async () => {
    const r = await request({ type: 'capture-start', tabId: 7, confirmed: true, duration: 30 }); assert.equal(r.ok, true);
    assert.equal(captures, 1); assert.equal(storage.session.capture.videoId, 'abcdefghijk');
    assert.equal(messages.find(m => m.type === 'start').config.key, 'fixture-key');
    assert.equal(JSON.stringify(sent).includes('fixture-key'), false);
    assert.equal((await request({ type: 'capture-start', tabId: 7, confirmed: true })).ok, false);
  });
  await t.test('navigation cancels recording and clears reservation', async () => {
    await updated(7, { url: 'https://www.youtube.com/watch?v=lmnopqrstuv' });
    assert.equal(storage.session.capture, undefined); assert.ok(messages.some(m => m.type === 'cancel'));
  });
  await t.test('stale capture reservation is recovered when offscreen context is lost', async () => {
    storage.session.capture = { tabId: 7, videoId: 'abcdefghijk' }; offscreenExists = false;
    assert.equal((await request({ type: 'capture-state' })).capture, undefined);
    assert.equal(storage.session.capture, undefined);
  });
  await t.test('file audio requires popup consent but accepts pause and speed changes; stale jobs cannot deliver cues', async () => {
    const offscreen = { id: 'fixture', url: 'chrome-extension://fixture/offscreen.html' };
    snapshot.paused = true; snapshot.rate = 2;
    assert.equal((await request({ type: 'audio-start', tabId: 7, confirmed: false })).ok, false);
    assert.equal((await request({ type: 'audio-start', tabId: 7, confirmed: true }, content)).ok, false);
    assert.equal((await request({ type: 'audio-start', tabId: 7, confirmed: true, scope: 'full' })).ok, true);
    assert.equal(captures, 1, 'file processing never calls tabCapture');
    const job = storage.session.capture;
    assert.equal(job.kind, 'audio');
    assert.equal(messages.find(m => m.type === 'start-audio').config.key, 'fixture-key');
    assert.equal((await request({ type: 'audio-sabr-chunk', jobId: 'old', videoId: job.videoId, start: 0, end: 30 }, offscreen)).ok, false);
    assert.equal((await request({ type: 'audio-cues', jobId: job.id, videoId: job.videoId }, content)).ok, false);
    await request({ type: 'capture-result', jobId: 'old', videoId: job.videoId, complete: true }, offscreen);
    assert.equal(storage.session.capture.id, job.id);
    const sentBefore = sent.length;
    await request({ type: 'audio-cues', jobId: job.id, videoId: job.videoId, cues: [{ start: 1, end: 2, text: 'Audio.' }], language: 'en', interval: { start: 0, end: 30 } }, offscreen);
    assert.ok(sent.slice(sentBefore).some(({ m }) => m.type === 'generated-cues' && m.autoSelect));
    await request({ type: 'capture-result', jobId: job.id, videoId: job.videoId, error: 'SABR unavailable.' }, offscreen);
    assert.equal(storage.session.capture, undefined);
    assert.equal((await request({ type: 'capture-state' })).outcome.status, 'SABR unavailable.');
    snapshot.paused = false; snapshot.rate = 1;
  });
  await t.test('late manual recording messages cannot finish or overwrite a newer job on the same video', async () => {
    const offscreen = { id: 'fixture', url: 'chrome-extension://fixture/offscreen.html' };
    storage.session.capture = { id: 'new-recording', tabId: 7, videoId: 'abcdefghijk', status: 'Recording' };
    for (const jobId of ['old-recording', undefined]) {
      await request({ type: 'capture-progress', jobId, videoId: 'abcdefghijk', status: 'Old progress' }, offscreen);
      assert.equal(storage.session.capture.status, 'Recording');
      await request({ type: 'capture-result', jobId, videoId: 'abcdefghijk', error: 'Old failure' }, offscreen);
      assert.equal(storage.session.capture?.id, 'new-recording');
    }
    await request({ type: 'capture-result', jobId: 'new-recording', videoId: 'abcdefghijk', error: 'Done' }, offscreen);
    assert.equal(storage.session.capture, undefined);
  });
  await t.test('browser audio diagnostic requires toolbar action, never receives credentials, and aborts page requests', async () => {
    const before = messages.length;
    assert.equal((await request({ type: 'audio-test', tabId: 7, confirmed: true }, content)).ok, false);
    assert.equal((await request({ type: 'audio-test', tabId: 7, confirmed: false })).ok, false);
    assert.equal((await request({ type: 'audio-test', tabId: 7, confirmed: true })).ok, true);
    const job = storage.session.capture;
    assert.equal(job.probe, true); assert.equal(messages.slice(before).find(m => m.type === 'start-audio').config, undefined);
    await request({ type: 'capture-cancel' });
    assert.ok(sent.some(({ m }) => m.type === 'audio-sabr-cancel' && m.jobId === job.id));
    assert.equal(storage.session.capture, undefined);
  });
  await t.test('real Options UI talks to the background as a tab, persists a provider and translates for YouTube', async t => {
    const window = new Window({ url: 'chrome-extension://fixture/options.html' });
    window.document.write(await readFile(new URL('../extension/options.html', import.meta.url), 'utf8'));
    const oldDocument = globalThis.document, oldFetch = globalThis.fetch, oldSend = chrome.runtime.sendMessage;
    const options = { id: 'fixture', url: 'chrome-extension://fixture/options.html', frameId: 0, tab: { id: 20 } };
    const grants = [], requests = [];
    globalThis.document = window.document;
    chrome.runtime.sendMessage = m => request(m, options);
    chrome.permissions.request = async r => { grants.push(r); return true; };
    // Explicit opt-in sends only the fixed public greeting to MyMemory. Normal
    // verification remains deterministic and makes no external API requests.
    const live = process.env.SENTENCE_LIVE_TRANSLATION === '1';
    globalThis.fetch = async (url, init) => {
      requests.push({ url: String(url), init });
      if (live) return oldFetch(url, init);
      return Response.json({ responseStatus: 200, responseData: { translatedText: 'Hola, mundo.' } });
    };
    try {
      await import(`../extension/options.js?background-integration=${Date.now()}`);
      const $ = id => document.getElementById(id);
      assert.equal($('provider').disabled, false, $('provider-status').textContent);
      $('provider').value = 'mymemory'; $('provider').onchange();
      await $('provider-form').onsubmit({ preventDefault() {} });
      assert.match($('provider-status').textContent, /Connected and selected/);
      assert.deepEqual(grants, [{ origins: ['https://api.mymemory.translated.net/*'] }]);
      assert.equal(storage.local.preferences.engine, 'mymemory');
      assert.equal(storage.local.preferences.mode, 'bilingual');
      await $('test').onclick();
      assert.match($('provider-status').textContent, live ? /Connection works: .+/ : /Connection works: Hola, mundo/);
      const response = await request({ type: 'translate', videoId: 'abcdefghijk', text: 'Hello, world.', source: 'en', before: '', after: '' }, content);
      assert.equal(response.ok, true, response.error);
      if (live) {
        assert.ok(response.text?.trim());
        assert.notEqual(response.text, 'Hello, world.');
        t.diagnostic(`Live MyMemory through Options/background: ${response.text}`);
      } else assert.equal(response.text, 'Hola, mundo.');
      assert.equal(requests.length, 2);
    } finally {
      globalThis.document = oldDocument; globalThis.fetch = oldFetch; chrome.runtime.sendMessage = oldSend;
      await window.happyDOM.abort();
    }
  });
  await t.test('batch translation validates IDs, reuses identical context and enforces cancellation', async () => {
    const oldFetch = globalThis.fetch;
    storage.local.preferences = { ...DEFAULTS, enabled: true, engine: 'ai', mode: 'bilingual', targetLanguage: 'zh' };
    storage.local.providers.ai = { endpoint: 'https://batch.example/chat/completions', model: 'fixture', key: 'fixture-key' };
    const calls = [];
    globalThis.fetch = async (_, options) => {
      const payload = JSON.parse(JSON.parse(options.body).messages[1].content); calls.push(payload);
      return Response.json({ choices: [{ message: { content: JSON.stringify(payload.translateIds.map(id => ({ id, translation: `译文${id}` }))) } }] });
    };
    const batch = { type: 'translate-batch', videoId: 'abcdefghijk', source: 'en', before: '', after: 'Three.',
      sentences: [{ id: 0, text: 'One.' }, { id: 1, text: 'Two.' }] };
    try {
      assert.equal((await request(batch, popup)).ok, false);
      assert.equal((await request({ ...batch, videoId: 'wrong' }, content)).ok, false);
      assert.equal((await request({ ...batch, sentences: [batch.sentences[0], batch.sentences[0]] }, content)).ok, false);
      const first = await request(batch, content); assert.equal(first.ok, true, first.error);
      assert.deepEqual(first.translations, [{ id: 0, translation: '译文0' }, { id: 1, translation: '译文1' }]);
      assert.equal((await request(batch, content)).cached, true); assert.equal(calls.length, 1);
      const partial = await request({ ...batch, before: 'One.', after: '', sentences: [{ id: 1, text: 'Two.' }, { id: 2, text: 'Three.' }] }, content);
      assert.equal(partial.ok, true, partial.error); assert.deepEqual(calls.at(-1).translateIds, [1, 2], 'different batch context must not reuse an interpretation from an earlier request');
      assert.equal(calls.at(-1).sentences.length, 2);
      let started;
      const fetched = new Promise(resolve => { started = resolve; });
      globalThis.fetch = (_, options) => new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }); started();
      });
      const pending = request({ ...batch, before: 'New context' }, content);
      await fetched;
      assert.match((await request(batch, content)).error, /queue is busy/);
      await request({ type: 'cancel-translation' }, content);
      assert.equal((await pending).ok, false);
      globalThis.fetch = async () => Response.json({ choices: [{ message: { content: '[]' } }] });
      assert.match((await request({ ...batch, before: 'New context' }, content)).error, /invalid sentences/);
    } finally { globalThis.fetch = oldFetch; }
  });
  delete globalThis.chrome;
});
