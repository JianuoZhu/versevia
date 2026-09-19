import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { readFile } from 'node:fs/promises';
import { DEFAULTS } from '../extension/config.js';

test('speech popup explains setup, requires readiness and consent, and offers explicit viewing after completion', async () => {
  const window = new Window({ url: 'chrome-extension://fixture/popup.html' });
  window.document.write(await readFile(new URL('../extension/popup.html', import.meta.url), 'utf8'));
  const previous = { document: globalThis.document, chrome: globalThis.chrome, setInterval: globalThis.setInterval };
  let refresh, ready = false, capture;
  const requests = [], opened = [], grants = [];
  const snapshot = { videoId: 'abcdefghijk', enabled: true, paused: false, ad: false, rate: 1, duration: 300, generatedCount: 0 };
  globalThis.document = window.document;
  globalThis.setInterval = callback => { refresh = callback; return 1; };
  globalThis.chrome = { runtime: {
    getURL: path => `chrome-extension://fixture/${path}`, openOptionsPage: async () => {},
    sendMessage: async m => {
      requests.push(m);
      if (m.type === 'get-preferences') return { ok: true, preferences: { ...DEFAULTS } };
      if (m.type === 'capture-state') return { ok: true, capture };
      if (m.type === 'speech-readiness') return { ok: true, ready, message: ready ? 'Configured' : 'Add a speech API key.' };
      if (m.type === 'capture-start') capture = { tabId: 7, status: 'Recording up to 30 seconds…' };
      if (m.type === 'audio-start') capture = { tabId: 7, kind: 'audio', status: 'Downloading…' };
      return { ok: true };
    }
  }, permissions: { request: async p => { grants.push(p); return true; } }, tabs: { query: async () => [{ id: 7, url: 'https://www.youtube.com/watch?v=abcdefghijk' }],
    create: async spec => opened.push(spec), sendMessage: async (id, m) => { requests.push(m); return m.type === 'snapshot' ? snapshot : { ok: true }; } } };
  try {
    await import(`../extension/popup.js?test=${Date.now()}`);
    const $ = id => document.getElementById(id);
    assert.match($('speech-readiness').textContent, /API key/);
    assert.equal($('audio-test').disabled, false);
    await $('audio-test').onclick();
    assert.equal(requests.find(m => m.type === 'audio-test').confirmed, true);
    assert.equal(grants.length, 0);
    $('consent').checked = true; $('consent').onchange();
    assert.equal($('start').disabled, true);
    await $('speech-options').onclick();
    assert.deepEqual(opened, [{ url: 'chrome-extension://fixture/options.html?provider=asr' }]);
    ready = true; await refresh();
    assert.equal($('start').disabled, false);
    snapshot.paused = true; await refresh(); assert.equal($('start').disabled, true);
    assert.match($('capture-status').textContent, /play a regular video at 1×/);
    snapshot.paused = false; await refresh();
    assert.equal(requests.some(m => m.type === 'capture-start'), false);
    await $('start').onclick();
    assert.equal(requests.find(m => m.type === 'capture-start').confirmed, true);
    assert.equal($('consent').checked, false); assert.equal($('finish').hidden, false);
    capture = undefined; snapshot.generatedCount = 3; await refresh();
    assert.equal($('view-generated').hidden, false);
    await $('view-generated').onclick();
    assert.equal(requests.at(-1).type, 'view-generated');
    assert.match($('status').textContent, /press play when ready/);
    snapshot.paused = true; snapshot.rate = 2; await refresh();
    $('audio-consent').checked = true; $('audio-consent').onchange();
    assert.equal($('audio-start').disabled, false);
    await $('audio-start').onclick();
    assert.equal(requests.find(m => m.type === 'audio-start').confirmed, true);
    assert.equal($('finish').hidden, true); assert.equal($('cancel').hidden, false);
    assert.equal($('audio-consent').checked, false);
    assert.deepEqual(grants, [{ origins: ['https://*.googlevideo.com/*'] }]);
  } finally {
    Object.assign(globalThis, previous); await window.happyDOM.abort();
  }
});
