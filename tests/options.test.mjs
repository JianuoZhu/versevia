import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { readFile } from 'node:fs/promises';
import { DEFAULTS, PROVIDERS } from '../extension/config.js';
test('provider settings request the chosen origin and save default auto source language', async () => {
  const window = new Window({ url: 'chrome-extension://fixture/options.html' });
  window.document.write(await readFile(new URL('../extension/options.html', import.meta.url), 'utf8'));
  const calls = [], permissions = [];
  const oldDocument = globalThis.document, oldChrome = globalThis.chrome;
  globalThis.document = window.document;
  globalThis.chrome = { permissions: { request: async r => { permissions.push(r); return true; } }, runtime: { sendMessage: async m => {
    calls.push(m);
    if (m.type === 'get-providers') return { ok: true, providers: structuredClone(PROVIDERS) };
    if (m.type === 'benchmark-provider') return { ok: true, result: { effort: m.effort, totalMs: 10, reasoningTokens: 0 } };
    return { ok: true, preferences: { ...DEFAULTS, ...m.preferences } };
  } } };
  try {
    await import(`../extension/options.js?test=${Date.now()}`);
    await document.getElementById('save-preferences').onclick();
    assert.equal(calls.findLast(c => c.type === 'set-preferences').preferences.sourceLanguage, 'auto');
    document.getElementById('provider').value = 'ai'; document.getElementById('provider').onchange();
    document.getElementById('endpoint').value = 'https://translator.example/v1/chat/completions';
    document.getElementById('model').value = 'my-model';
    await document.getElementById('provider-form').onsubmit({ preventDefault() {} });
    assert.deepEqual(permissions, [{ origins: ['https://translator.example/*'] }]);
    assert.equal(calls.findLast(c => c.type === 'save-provider').config.model, 'my-model');
    assert.deepEqual(calls.findLast(c => c.type === 'set-preferences').preferences, { engine: 'ai', mode: 'bilingual' });
    const count = calls.filter(c => c.type === 'set-preferences').length;
    await document.getElementById('benchmark').onclick();
    assert.deepEqual(calls.filter(c => c.type === 'benchmark-provider').map(c => c.effort), ['default', 'low', 'none', 'none', 'low', 'default']);
    assert.match(document.getElementById('benchmark-status').textContent, /Comparison complete/);
    assert.equal(calls.filter(c => c.type === 'set-preferences').length, count);
    document.getElementById('targetLanguage').value = 'auto';
    await document.getElementById('save-preferences').onclick();
    assert.equal(calls.filter(c => c.type === 'set-preferences').length, count);
    assert.match(document.getElementById('preferences-status').textContent, /Only source may be auto/);
    document.getElementById('style-fontFamily').value = 'serif';
    document.getElementById('style-translationColor').value = '#ffe088';
    await document.getElementById('save-style').onclick();
    const stylePatch = calls.findLast(c => c.type === 'set-preferences').preferences;
    assert.equal(stylePatch.fontFamily, 'serif'); assert.equal(stylePatch.translationColor, '#ffe088');
    assert.equal(Object.hasOwn(stylePatch, 'engine'), false);
  } finally {
    globalThis.document = oldDocument; globalThis.chrome = oldChrome; await window.happyDOM.abort();
  }
});

test('provider save keeps credentials paired with the endpoint while permission is pending', async () => {
  const window = new Window({ url: 'chrome-extension://fixture/options.html' });
  window.document.write(await readFile(new URL('../extension/options.html', import.meta.url), 'utf8'));
  const oldDocument = globalThis.document, oldChrome = globalThis.chrome;
  let grant;
  const calls = [], permissions = [];
  globalThis.document = window.document;
  globalThis.chrome = { permissions: { request: r => { permissions.push(r); return new Promise(resolve => { grant = resolve; }); } },
    runtime: { sendMessage: async m => {
      calls.push(m);
      if (m.type === 'get-providers') return { ok: true, providers: structuredClone(PROVIDERS) };
      return { ok: true, preferences: { ...DEFAULTS, ...m.preferences } };
    } } };
  try {
    await import(`../extension/options.js?permission-race=${Date.now()}`);
    const $ = id => document.getElementById(id);
    $('provider').value = 'ai'; $('provider').onchange();
    $('endpoint').value = 'https://first.example/chat/completions';
    $('key').value = 'first-fixture-key'; $('model').value = 'first-model';
    const saving = $('provider-form').onsubmit({ preventDefault() {} });
    $('provider').value = 'deepseek'; $('provider').onchange();
    $('key').value = 'second-fixture-key'; $('model').value = 'second-model';
    grant(true); await saving;
    assert.deepEqual(permissions, [{ origins: ['https://first.example/*'] }]);
    assert.deepEqual(calls.findLast(m => m.type === 'save-provider'), { type: 'save-provider', id: 'ai',
      config: { endpoint: 'https://first.example/chat/completions', key: 'first-fixture-key', model: 'first-model', region: '' } });
  } finally {
    globalThis.document = oldDocument; globalThis.chrome = oldChrome; await window.happyDOM.abort();
  }
});

test('failed or incomplete settings reads cannot crash provider selection or overwrite credentials, and can be retried', async t => {
  for (const failure of ['rejected', 'incomplete', 'preferences']) await t.test(failure, async () => {
    const window = new Window({ url: 'chrome-extension://fixture/options.html' });
    window.document.write(await readFile(new URL('../extension/options.html', import.meta.url), 'utf8'));
    const oldDocument = globalThis.document, oldChrome = globalThis.chrome;
    let recover = false;
    const writes = [], permissions = [];
    globalThis.document = window.document;
    globalThis.chrome = { permissions: { request: async r => { permissions.push(r); return true; } }, runtime: { sendMessage: async m => {
      if (m.type === 'get-providers') {
        if (!recover && failure === 'rejected') return { ok: false, error: 'Unsupported sender.' };
        const providers = structuredClone(PROVIDERS);
        providers.deepl.key = 'saved-fixture-key';
        if (!recover && failure === 'incomplete') delete providers.deepl;
        return { ok: true, providers };
      }
      if (m.type === 'get-preferences') return !recover && failure === 'preferences' ? { ok: false, error: 'Storage unavailable.' } : { ok: true, preferences: { ...DEFAULTS } };
      writes.push(m); return { ok: true };
    } } };
    try {
      await import(`../extension/options.js?failure=${failure}`);
      const $ = id => document.getElementById(id);
      assert.equal($('provider').disabled, true);
      const error = $('provider-status').textContent;
      assert.match(error, /Settings could not be loaded/);
      for (const id of Object.keys(PROVIDERS)) {
        $('provider').value = id;
        assert.doesNotThrow(() => $('provider').onchange());
        await $('provider-form').onsubmit({ preventDefault() {} });
        await $('forget').onclick(); await $('test').onclick();
      }
      await $('save-preferences').onclick(); await $('clear-cache').onclick();
      assert.equal($('provider-status').textContent, error);
      assert.deepEqual(writes, []); assert.deepEqual(permissions, []);
      assert.equal($('reload-settings').hidden, false);
      recover = true;
      await $('reload-settings').onclick();
      assert.equal($('provider').disabled, false);
      assert.equal($('reload-settings').hidden, true);
      $('provider').value = 'deepl'; $('provider').onchange();
      assert.equal($('key').value, 'saved-fixture-key');
      assert.equal($('endpoint').value, PROVIDERS.deepl.endpoint);
    } finally {
      globalThis.document = oldDocument; globalThis.chrome = oldChrome; await window.happyDOM.abort();
    }
  });
});
