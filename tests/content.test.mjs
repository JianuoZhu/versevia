import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { DEFAULTS } from '../extension/config.js';
const settle = () => new Promise(resolve => setImmediate(resolve));

test('content script integrates subtitle extraction, player controls and SPA lifecycle', async t => {
  const window = new Window({ url: 'https://www.youtube.com/watch?v=abcdefghijk' });
  window.document.body.innerHTML = '<div id="movie_player" tabindex="0"><video></video><div class="ytp-caption-window-container">Native captions</div><div class="ytp-right-controls"><button class="ytp-subtitles-button" aria-pressed="false">CC</button></div></div><input id="typing">';
  let prefs = { ...DEFAULTS, semanticSegmentation: false, mode: 'original' }, handler, paused = true, translatedResolve;
  let captions = true, calls = [], captionEmpty = false, nativeLoads = 0;
  const intervals = [];
  const video = window.document.querySelector('video');
  Object.defineProperty(video, 'paused', { get: () => paused });
  Object.defineProperty(video, 'duration', { get: () => 100 });
  const sender = { id: 'test-extension' };
  const chrome = { runtime: { id: sender.id, onMessage: { addListener: fn => { handler = fn; } },
    sendMessage: async m => {
      calls.push(m);
      if (m.type === 'get-preferences') return { ok: true, preferences: prefs };
      if (m.type === 'set-preferences') { prefs = { ...prefs, ...m.preferences }; handler({ type: 'preferences-changed', preferences: prefs }, sender, () => {}); return { ok: true, preferences: prefs }; }
      if (m.type === 'translate' || m.type === 'translate-batch') return new Promise(resolve => { translatedResolve = resolve; });
      return { ok: true };
    } } };
  window.postMessage = data => {
    if (data.direction !== 'request') return;
    queueMicrotask(() => {
      const payload = data.type === 'select-track' ? { selected: true } : data.type === 'discover' ? { ready: true, tracks: captions ? [{ id: '.en', language: 'en', label: 'English', kind: 'creator', isDefault: true }] : [] } : captionEmpty ? { error: 'YouTube returned an empty caption response.' } :
        { body: JSON.stringify({ events: [
          { tStartMs: 1000, dDurationMs: 1000, segs: [{ utf8: 'Hello' }] },
          { tStartMs: 2000, dDurationMs: 1000, segs: [{ utf8: 'world.' }] },
          { tStartMs: 4000, dDurationMs: 2000, segs: [{ utf8: 'Second sentence.' }] },
          { tStartMs: 8000, dDurationMs: 2000, segs: [{ utf8: 'Third sentence.' }] }
        ] }) };
      window.dispatchEvent(new window.MessageEvent('message', { source: window, origin: window.location.origin,
        data: { ...payload, channel: data.channel, direction: 'response', videoId: data.videoId, requestId: data.requestId } }));
    });
  };
  const cc = window.document.querySelector('.ytp-subtitles-button');
  cc.onclick = () => {
    const on = cc.getAttribute('aria-pressed') !== 'true'; cc.setAttribute('aria-pressed', String(on));
    if (on) {
      nativeLoads++; captionEmpty = false;
      queueMicrotask(() => window.dispatchEvent(new window.MessageEvent('message', { source: window, origin: window.location.origin,
        data: { channel: 'sentence-youtube-v1', direction: 'observed', videoId: 'abcdefghijk' } })));
    }
  };
  const originals = new Map();
  for (const [key, value] of Object.entries({ window, document: window.document, location: window.location, navigator: window.navigator, DOMParser: window.DOMParser,
    chrome, setInterval: fn => { intervals.push(fn); return 1; } })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const tick = async () => { intervals.forEach(fn => fn()); await settle(); };
  const root = () => window.document.getElementById('sentence-extension').shadowRoot;
  const notify = async preferences => { prefs = { ...prefs, ...preferences }; handler({ type: 'preferences-changed', preferences: prefs }, sender, () => {}); await settle(); await tick(); };
  const key = (value, target = video) => { const event = new window.KeyboardEvent('keydown', { key: value, bubbles: true, composed: true, cancelable: true }); target.dispatchEvent(event); return event; };
  try {
    await import(`../extension/content.js?test=${Date.now()}`); await settle(); await tick();
    await t.test('renders reconstructed text and suppresses native captions', async () => {
      video.currentTime = 1.5; await tick();
      assert.equal(root().getElementById('original').textContent, 'Hello world.');
      assert.equal(window.document.getElementById('movie_player').classList.contains('sentence-native-hidden'), true);
      assert.match(root().getElementById('status').textContent, /3 sentences/);
    });
    await t.test('player control opens panel without toggling playback and remounts once', async () => {
      let playerClicks = 0;
      window.document.getElementById('movie_player').addEventListener('click', () => playerClicks++);
      let button = window.document.getElementById('sentence-player-button');
      assert.equal(button.parentElement.className, 'ytp-right-controls');
      assert.equal(root().getElementById('toggle').hidden, true);
      button.click(); assert.equal(root().getElementById('panel').hidden, false);
      root().getElementById('close').click(); assert.equal(root().getElementById('panel').hidden, true);
      assert.equal(playerClicks, 0);
      button.remove(); await tick(); await tick();
      assert.equal(window.document.querySelectorAll('#sentence-player-button').length, 1);
    });
    await t.test('empty direct captions trigger native CC acquisition and restore its off state', async () => {
      captionEmpty = true; video.currentTime = 1.5; paused = true;
      root().getElementById('refresh').click(); await settle(); await settle(); await tick();
      assert.equal(nativeLoads, 1); assert.equal(cc.getAttribute('aria-pressed'), 'false');
      assert.equal(root().getElementById('original').textContent, 'Hello world.');
      assert.equal(video.currentTime, 1.5); assert.equal(video.paused, true);
    });
    await t.test('translation-only with no engine displays original instead of a blank screen', async () => {
      await notify({ mode: 'translation', engine: 'none' });
      assert.equal(root().getElementById('original').hidden, false);
      assert.equal(root().getElementById('original').textContent, 'Hello world.');
      assert.equal(calls.some(m => m.type === 'translate'), false);
      await notify({ mode: 'original' });
    });
    await t.test('arrow navigation preserves paused and playing state and consumes native seek', async () => {
      video.currentTime = 1.5; paused = true;
      assert.equal(key('ArrowRight').defaultPrevented, true); assert.ok(Math.abs(video.currentTime - 4) < .01); assert.equal(video.paused, true);
      paused = false; key('ArrowLeft'); assert.ok(Math.abs(video.currentTime - 1) < .01); assert.equal(video.paused, false);
    });
    await t.test('typing, disabled shortcuts and ads leave YouTube keyboard behavior alone', async () => {
      video.currentTime = 1.5; const input = window.document.getElementById('typing');
      assert.equal(key('ArrowRight', input).defaultPrevented, false); assert.equal(video.currentTime, 1.5);
      await notify({ shortcuts: false }); assert.equal(key('ArrowRight').defaultPrevented, false);
      await notify({ shortcuts: true }); window.document.getElementById('movie_player').classList.add('ad-showing');
      assert.equal(key('ArrowRight').defaultPrevented, false); await tick(); assert.equal(root().getElementById('original').hidden, true);
      window.document.getElementById('movie_player').classList.remove('ad-showing');
    });
    await t.test('speed reflects native changes and popup commands', async () => {
      video.playbackRate = 1.75; await tick(); assert.equal(root().getElementById('rate').textContent, '1.75×');
      handler({ type: 'set-rate', rate: 1.25 }, sender, () => {}); assert.equal(video.playbackRate, 1.25);
    });
    await t.test('disabled overlay restores native captions and key behavior', async () => {
      await notify({ enabled: false });
      assert.equal(window.document.getElementById('movie_player').classList.contains('sentence-native-hidden'), false);
      assert.equal(root().getElementById('original').hidden, true); assert.equal(key('ArrowRight').defaultPrevented, false);
      await notify({ enabled: true }); await settle();
    });
    await t.test('translation uses reconstructed context and supports translation-only display', async () => {
      video.currentTime = 1.5; await notify({ engine: 'ai', mode: 'translation' }); await tick();
      assert.equal(root().getElementById('original').hidden, false);
      const request = calls.findLast(m => m.type === 'translate-batch'); assert.equal(request.sentences[0].text, 'Hello world.'); assert.equal(request.after, 'Third sentence.');
      assert.equal(request.sentences.length, 2);
      translatedResolve({ ok: true, translations: [{ id: 0, translation: 'Hola mundo.' }, { id: 1, translation: 'Segunda oración.' }] }); await settle(); await tick();
      assert.equal(root().getElementById('translated').textContent, 'Hola mundo.'); assert.equal(root().getElementById('original').hidden, true);
    });
    await t.test('stop discards late batch results, preserves translations, and whole-video resumes to completion', async () => {
      const late = translatedResolve;
      root().getElementById('stop-translation').click(); await settle(); await tick();
      const count = calls.filter(m => m.type === 'translate-batch').length;
      late({ ok: true, translations: [{ id: 2, translation: 'Late result' }] }); await settle(); await tick();
      assert.match(root().getElementById('translation-progress').textContent, /Stopped.*2 \/ 3/);
      assert.equal(calls.filter(m => m.type === 'translate-batch').length, count);
      root().getElementById('translate-all').click(); await settle(); await tick();
      assert.deepEqual(calls.findLast(m => m.type === 'translate-batch').sentences.map(s => s.id), [2]);
      translatedResolve({ ok: true, translations: [{ id: 2, translation: 'Tercera oración.' }] }); await settle(); await tick();
      assert.match(root().getElementById('translation-progress').textContent, /Complete.*3 \/ 3/);
      video.currentTime = 8.5; await tick(); assert.equal(root().getElementById('translated').textContent, 'Tercera oración.');
    });
    await t.test('failed batches pause without automatic retries and retry keeps successful entries', async () => {
      await notify({ targetLanguage: 'fr' });
      translatedResolve({ ok: false, error: 'Provider timed out.' }); await settle(); await tick();
      const count = calls.filter(m => m.type === 'translate-batch').length;
      await tick(); assert.equal(calls.filter(m => m.type === 'translate-batch').length, count);
      assert.equal(root().getElementById('retry').hidden, false);
      root().getElementById('retry').click(); await settle(); await tick();
      assert.equal(calls.filter(m => m.type === 'translate-batch').length, count + 1);
    });
    await t.test('seeking cancels an unrelated batch and prioritizes the new playback position', async () => {
      const late = translatedResolve;
      video.currentTime = 1.5; video.dispatchEvent(new window.Event('seeking')); await settle(); await tick();
      const request = calls.findLast(m => m.type === 'translate-batch');
      assert.deepEqual(request.sentences.map(s => s.id), [0, 1]);
      late({ ok: true, translations: [{ id: 2, translation: 'Late unrelated translation' }] }); await settle(); await tick();
      assert.match(root().getElementById('translation-progress').textContent, /0 \/ 3/);
      assert.equal(root().getElementById('translated').textContent, '');
    });
    await t.test('click navigation and autoplay start new translations without carrying over old failures', async () => {
      for (const [id, event] of [['zyxwvutsrqp', 'yt-navigate-finish'], ['abcdefghijk', 'yt-player-updated']]) {
        const stale = translatedResolve;
        window.history.pushState({}, '', `/watch?v=${id}`);
        video.currentTime = 1.5;
        window.document.dispatchEvent(new window.Event(event)); await settle(); await tick();
        stale({ ok: false, error: 'Request cancelled.' }); await settle(); await tick();
        const request = calls.findLast(m => m.type === 'translate-batch');
        assert.equal(request.videoId, id);
        assert.equal(root().getElementById('retry').hidden, true);
        assert.doesNotMatch(root().getElementById('translation-progress').textContent, /Failed/);
        translatedResolve({ ok: true, translations: request.sentences.map(s => ({ id: s.id, translation: `New ${id} ${s.id}` })) });
        await settle(); await tick();
        assert.equal(root().getElementById('translated').textContent, `New ${id} 0`);
      }
    });
    await t.test('SPA navigation discards stale translations and unavailable tracks restore native captions', async () => {
      const oldResolve = translatedResolve; captions = false;
      window.history.pushState({}, '', '/watch?v=lmnopqrstuv'); window.document.dispatchEvent(new window.Event('yt-navigate-finish')); await settle();
      oldResolve?.({ ok: true, text: 'Stale translation' }); await settle(); await tick();
      assert.equal(root().getElementById('translated').textContent, '');
      assert.equal(window.document.getElementById('movie_player').classList.contains('sentence-native-hidden'), false);
      assert.match(root().getElementById('status').textContent, /No subtitles/);
    });
    await t.test('generated subtitles require explicit source selection and playback changes cancel capture', async () => {
      await notify({ mode: 'original' });
      handler({ type: 'generated-cues', videoId: 'lmnopqrstuv', cues: [{ start: 20, end: 23, text: 'Generated speech.' }], language: 'english' }, sender, () => {});
      video.currentTime = 21; await tick(); assert.equal(root().getElementById('original').textContent, '');
      await notify({ sourceKind: 'generated' }); assert.equal(root().getElementById('original').textContent, 'Generated speech.');
      handler({ type: 'capture-status', videoId: 'lmnopqrstuv', recording: true, status: 'Recording…' }, sender, () => {});
      video.dispatchEvent(new window.Event('seeking')); await settle(); assert.ok(calls.some(m => m.type === 'capture-cancel'));
    });
    await t.test('view generated explicitly selects the source and seeks without changing paused state', async () => {
      await notify({ sourceKind: 'auto', enabled: false });
      paused = true; video.currentTime = 50;
      const response = await new Promise(resolve => handler({ type: 'view-generated' }, sender, resolve));
      assert.equal(response.ok, true, response.error);
      assert.equal(prefs.sourceKind, 'generated'); assert.equal(prefs.enabled, true);
      assert.equal(video.currentTime, 20); assert.equal(video.paused, true);
      assert.equal(root().getElementById('original').textContent, 'Generated speech.');
      let snapshot; handler({ type: 'snapshot' }, sender, r => { snapshot = r; });
      assert.equal(snapshot.generatedCount, 1);
    });
    await t.test('changing dubbed audio removes old subtitles and rejects late results from the prior track', async () => {
      await notify({ engine: 'none', sourceKind: 'generated' });
      const observe = trackId => window.dispatchEvent(new window.MessageEvent('message', { source: window, origin: window.location.origin,
        data: { channel: 'sentence-youtube-v1', direction: 'audio-track-observed', videoId: 'lmnopqrstuv', trackId } }));
      const deliver = trackId => handler({ type: 'generated-cues', videoId: 'lmnopqrstuv', trackId, language: 'en', autoSelect: true,
        cues: [{ start: 20, end: 23, text: 'Original English track.' }] }, sender, () => {});
      observe('en-US.4'); deliver('en-US.4'); await tick();
      assert.equal(root().getElementById('original').textContent, 'Original English track.');
      const before = calls.length;
      observe('uk.10'); await tick();
      assert.equal(root().getElementById('original').textContent, '');
      assert.ok(calls.slice(before).some(m => m.type === 'capture-cancel'));
      deliver('en-US.4'); await tick();
      assert.equal(root().getElementById('original').textContent, '', 'late English results must not appear on a Ukrainian track');
      observe('en-US.4'); deliver('en-US.4'); await tick();
      await notify({ sourceLanguage: 'ru' });
      assert.equal(root().getElementById('original').textContent, '', 'changing source language must not relabel existing English text');
    });
    await t.test('unpunctuated Japanese renders and navigates bounded chunks instead of a paragraph', async () => {
      await notify({ sourceKind: 'generated', sourceLanguage: 'auto', engine: 'none', mode: 'original' });
      const text = 'おはようございますかずきです今回はミセスグリーンアップルのかっこいいギターフレーズベスト５やっていきたいと思いますいやこの企画で特定のアーティストさんするの久しぶりですね皆さんミセス聞いてますでしょうか最近のバンドとかアーティストさんでギターがかっこいいのは誰って聞かれたらもう';
      handler({ type: 'generated-cues', videoId: 'lmnopqrstuv', language: 'ja', autoSelect: true,
        cues: [{ start: 20, end: 38, text }] }, sender, () => {});
      video.currentTime = 22; await tick();
      const first = root().getElementById('original').textContent;
      assert.ok(first.length > 0 && first.length <= 48);
      assert.ok(!first.includes('最近のバンド'));
      key('ArrowRight'); await tick();
      assert.ok(video.currentTime > 22 && video.currentTime <= 27.01);
      assert.notEqual(root().getElementById('original').textContent, first);
      assert.ok(root().getElementById('original').textContent.length <= 48);
    });
    await t.test('leaving watch pages removes extension UI and suppression style', async () => {
      window.history.pushState({}, '', '/'); window.document.dispatchEvent(new window.Event('yt-navigate-finish')); await settle();
      assert.equal(window.document.getElementById('sentence-extension'), null);
      assert.equal(window.document.getElementById('sentence-player-button'), null);
      assert.equal(window.document.getElementById('movie_player').classList.contains('sentence-native-hidden'), false);
    });
  } finally {
    for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
    await window.happyDOM.abort();
  }
});
