import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { recognitionLanguage, transcriptionLanguage, speechLanguage } from '../extension/speech-language.js';
import { runAudioJob } from '../extension/audio-job.js';
import { cacheClear, cacheGet } from '../extension/cache.js';
import { speechCacheKey } from '../extension/audio-media.js';

test('track language resolves auto and recognizes provider language names', () => {
  assert.equal(recognitionLanguage('auto', 'en-US'), 'en');
  assert.equal(recognitionLanguage('auto', 'uk'), 'uk');
  assert.equal(speechLanguage('Russian'), 'ru');
  assert.equal(transcriptionLanguage({ language: 'English' }, 'en-US'), 'en');
  assert.throws(() => recognitionLanguage('en', 'ru'), /Selected audio is ru/);
  assert.throws(() => transcriptionLanguage({ language: 'russian' }, 'en'), /returned ru for en/);
  assert.throws(() => transcriptionLanguage({ language: 'en', segments: [{ text: 'Это полностью русский текст вместо английской речи.' }] }, 'en'), /Cyrillic/);
  assert.equal(transcriptionLanguage({ segments: [{ text: 'The Russian word is привет, an informal greeting.' }] }, 'en'), 'en');
});

test('English auto audio sends en, rejects Russian output before caching, and separates dubbed tracks', async () => {
  await cacheClear();
  const previous = { fetch: globalThis.fetch, AudioContext: globalThis.AudioContext };
  const config = { endpoint: 'https://speech.example/transcriptions', model: 'whisper-1', key: 'fixture' };
  const state = { id: 'language-test', videoId: 'abcdefghijk', language: 'auto', videoDuration: 4, from: 0, scope: 'full' };
  let responseLanguage = 'Russian', trackId = 'en-US.4', chunkTrack, uploaded = 0;
  const messages = [];
  globalThis.AudioContext = class {
    async decodeAudioData() { return { duration: 4, sampleRate: 16000, length: 64000, numberOfChannels: 1, getChannelData: () => new Float32Array(64000) }; }
    async close() {}
  };
  globalThis.fetch = async (_url, init) => {
    uploaded++; assert.equal(init.body.get('language'), 'en');
    return Response.json({ language: responseLanguage, segments: [{ start: 0, end: 3, text: responseLanguage === 'Russian' ? 'Это русские субтитры.' : 'This is English speech.' }] });
  };
  const rpc = async m => {
    messages.push(m);
    if (m.type === 'audio-sabr-probe') return { ok: true, language: 'en-US', trackId };
    if (m.type === 'audio-sabr-chunk') return { ok: true, trackId: chunkTrack || trackId, language: 'en-US', audio: btoa('fixture'), start: 0, end: 4, mimeType: 'audio/webm' };
    return { ok: true, snapshot: { videoId: state.videoId, time: 0 } };
  };
  try {
    const run = () => runAudioJob(state, config, [], new AbortController(), rpc);
    await assert.rejects(run(), /returned ru for en/);
    assert.equal(messages.some(m => m.type === 'audio-cues'), false);
    const key = await speechCacheKey(state.videoId, state.language, config, { start: 0, end: 'index' }, trackId);
    assert.equal(await cacheGet(key), undefined);
    responseLanguage = 'English'; await run(); assert.equal(uploaded, 2);
    assert.equal(messages.findLast(m => m.type === 'audio-cues').language, 'en');
    messages.length = 0; await run(); assert.equal(uploaded, 2);
    assert.equal(messages.some(m => m.type === 'audio-sabr-chunk'), false);
    trackId = 'en-US.10'; await run(); assert.equal(uploaded, 3, 'different English dub must not reuse original-track cache');
    assert.notEqual(key, await speechCacheKey(state.videoId, state.language, config, { start: 0, end: 'index' }, trackId));
    trackId = 'en-US.11'; chunkTrack = 'uk.10';
    await assert.rejects(run(), /audio track changed/);
    assert.equal(uploaded, 3, 'track changes must stop before paid upload');
  } finally { Object.assign(globalThis, previous); await cacheClear(); }
});
