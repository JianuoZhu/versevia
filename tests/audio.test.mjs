import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { audioURL, downloadAudio, chunkPlan, wavChunk, speechCacheKey, DIRECT_MAX_BYTES } from '../extension/audio-media.js';
import { runAudioJob } from '../extension/audio-job.js';
import { cacheClear } from '../extension/cache.js';
import { nativeAudioClient } from '../native/extension-client.js';

test('audio downloads restrict destinations, omit credentials and reject oversized streams', async () => {
  for (const url of ['http://rr.googlevideo.com/videoplayback', 'https://googlevideo.com.evil.test/videoplayback', 'https://rr.googlevideo.com/private', 'https://a:b@rr.googlevideo.com/videoplayback', 'https://rr.googlevideo.com:444/videoplayback']) assert.throws(() => audioURL(url));
  const source = { url: 'https://rr.googlevideo.com/videoplayback?id=test', duration: 60, mimeType: 'audio/webm' };
  const signal = new AbortController().signal;
  const blob = await downloadAudio(source, signal, async (url, init) => {
    assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error'); return new Response(new Uint8Array([1, 2]));
  });
  assert.equal(blob.size, 2);
  await assert.rejects(downloadAudio(source, signal, async () => new Response('x', { headers: { 'content-length': String(DIRECT_MAX_BYTES + 1) } })), /limit/);
  let cancelled = false;
  const body = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(DIRECT_MAX_BYTES + 1)); }, cancel() { cancelled = true; } });
  await assert.rejects(downloadAudio(source, signal, async () => new Response(body)), /limit/);
  assert.equal(cancelled, true);
});

test('chunk plans preserve absolute positions and processing budget; WAV header matches actual samples', async () => {
  assert.deepEqual(chunkPlan(95, 65, 'full'), [{ start: 60, end: 90 }, { start: 90, end: 95 }, { start: 0, end: 30 }, { start: 30, end: 60 }]);
  assert.equal(chunkPlan(1200, 75, 'nearby').length, 10);
  assert.equal(chunkPlan(1200, 75, 'nearby').at(-1).end, 360);
  assert.throws(() => chunkPlan(Infinity, 0, 'full'));
  const buffer = { sampleRate: 4, length: 8, numberOfChannels: 1, getChannelData: () => Float32Array.from([-1, 0, 1, 0, -1, 0, 1, 0]) };
  const blob = wavChunk(buffer, 1, 2), view = new DataView(await blob.arrayBuffer());
  assert.equal(blob.type, 'audio/wav'); assert.equal(blob.size, 52); assert.equal(view.getUint32(40, true), 8); assert.equal(view.getInt16(44, true), -32768);
});

test('audio pipeline uses SABR, survives pause/speed/seek, persists results and avoids repeat ASR', async () => {
  await cacheClear();
  const oldFetch = globalThis.fetch, oldAudio = globalThis.AudioContext;
  globalThis.AudioContext = class {
    async decodeAudioData(bytes) { const duration = Number(new TextDecoder().decode(bytes)); return { duration, sampleRate: 16000, length: duration * 16000, numberOfChannels: 1, getChannelData: () => new Float32Array(duration * 16000) }; }
    async close() {}
  };
  const config = { endpoint: 'https://speech.example/transcriptions', key: 'fixture-secret', model: 'timestamp-model' };
  const state = { id: 'job1', videoId: 'abcdefghijk', language: 'en', videoDuration: 65, from: 35, scope: 'full' };
  const messages = []; let uploads = 0, position = 35;
  const rpc = async m => {
    messages.push(m);
    if (m.type === 'audio-sabr-probe') return { ok: true, language: 'en-US', trackId: 'en-US.4' };
    if (m.type === 'audio-sabr-chunk') return { ok: true, audio: btoa(String(m.end - m.start)), start: m.start, end: m.end, mimeType: 'audio/webm', language: 'en-US', trackId: 'en-US.4' };
    if (m.type === 'capture-snapshot') return { ok: true, snapshot: { videoId: state.videoId, time: position, paused: true, rate: 2 } };
    return { ok: true };
  };
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('googlevideo.com')) return new Response('Forbidden', { status: 403 });
    uploads++; assert.equal(init.headers.Authorization, 'Bearer fixture-secret');
    assert.equal(init.body.get('file').name, 'youtube-clip.wav');
    position = 0;
    return Response.json({ language: 'en', segments: [{ start: 1, end: 3, text: 'A sentence.' }] });
  };
  try {
    await runAudioJob(state, config, [{ url: 'https://rr.googlevideo.com/videoplayback', duration: 65, mimeType: 'audio/webm' }], new AbortController(), rpc);
    assert.equal(uploads, 3);
    assert.deepEqual(messages.filter(m => m.type === 'audio-sabr-chunk').map(m => m.start), [29, 0, 59]);
    assert.equal(messages.find(m => m.type === 'audio-cues').cues[0].start, 30);
    assert.equal(JSON.stringify(messages).includes('fixture-secret'), false);
    messages.length = 0;
    await runAudioJob(state, { ...config, key: 'rotated' }, [], new AbortController(), rpc);
    assert.equal(uploads, 3); assert.equal(messages.some(m => m.type === 'audio-sabr-chunk'), false);
    assert.equal(messages.filter(m => m.type === 'audio-cues').length, 3);
    assert.notEqual(await speechCacheKey(state.videoId, 'en', config, { start: 0, end: 30 }), await speechCacheKey(state.videoId, 'ja', config, { start: 0, end: 30 }));
  } finally { globalThis.fetch = oldFetch; globalThis.AudioContext = oldAudio; await cacheClear(); }
});

test('direct browser audio decodes and sends WAV chunks without opening helper', async () => {
  await cacheClear();
  const oldFetch = globalThis.fetch, oldAudio = globalThis.AudioContext;
  let uploads = 0, closed = 0;
  globalThis.AudioContext = class {
    async decodeAudioData() { return { duration: 4, sampleRate: 16000, length: 64000, numberOfChannels: 1, getChannelData: () => new Float32Array(64000) }; }
    async close() { closed++; }
  };
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('googlevideo.com')) return new Response('fixture-decoded-by-test');
    uploads++; assert.equal(init.body.get('file').type, 'audio/wav'); assert.equal(init.body.get('file').name, 'youtube-clip.wav');
    return Response.json({ segments: [{ start: 0, end: 3, text: 'Speech.' }] });
  };
  const state = { id: 'direct', videoId: 'abcdefghijk', language: 'en', from: 0, scope: 'full', videoDuration: 4 };
  const messages = [];
  try {
    await runAudioJob(state, { endpoint: 'https://speech.example/asr', model: 'test', key: '' }, [{ url: 'https://rr.googlevideo.com/videoplayback', duration: 4, mimeType: 'audio/webm', language: 'en', trackId: 'en.4' }], new AbortController(), async m => {
      messages.push(m); return { ok: true, snapshot: { videoId: state.videoId, time: 0 } };
    });
    assert.equal(uploads, 1); assert.equal(closed, 1); assert.equal(messages.some(m => m.type.startsWith('audio-native')), false);
  } finally { globalThis.fetch = oldFetch; globalThis.AudioContext = oldAudio; await cacheClear(); }
});

test('cancellation after SABR preparation never produces subtitles', async () => {
  await cacheClear();
  const state = { id: 'cancel', videoId: 'abcdefghijk', language: 'en', from: 0, scope: 'full', videoDuration: 4 };
  const config = { endpoint: 'https://speech.example/asr', model: 'test', key: '' };
  const controller = new AbortController(), messages = [];
  await assert.rejects(runAudioJob(state, config, [], controller, async m => {
    messages.push(m); if (m.type === 'audio-sabr-probe') controller.abort(); return { ok: true, duration: 4 };
  }), /abort/i);
  assert.equal(messages.some(m => m.type === 'audio-sabr-chunk'), false);

});

test('browser audio diagnostic decodes without provider configuration, uploads or cache results', async () => {
  const oldFetch = globalThis.fetch, oldAudio = globalThis.AudioContext;
  globalThis.fetch = async () => { throw new Error('Diagnostic must not call a speech provider'); };
  globalThis.AudioContext = class {
    async decodeAudioData() { return { duration: 10, sampleRate: 16000, length: 160000, numberOfChannels: 1, getChannelData: () => new Float32Array(160000).fill(0.1) }; }
    async close() {}
  };
  const messages = [];
  try {
    const result = await runAudioJob({ id: 'probe', videoId: 'abcdefghijk', from: 121, videoDuration: 713, probe: true }, undefined, [], new AbortController(), async m => {
      messages.push(m);
      return { ok: true, audio: btoa('test'), mimeType: 'audio/webm', start: 120, end: 130 };
    });
    assert.match(result, /SABR audio verified: 5.0 s decoded at 121.0 s/);
    assert.match(result, /audio signal detected/);
    assert.deepEqual(messages.map(m => m.type), ['capture-progress', 'audio-sabr-chunk']);
  } finally { globalThis.fetch = oldFetch; globalThis.AudioContext = oldAudio; }
});

test('native audio port rejects pending work on disconnect and does not leak native diagnostics', async () => {
  let message, disconnect, sent;
  const runtime = { lastError: undefined, connectNative: () => ({ onMessage: { addListener: fn => { message = fn; } }, onDisconnect: { addListener: fn => { disconnect = fn; } }, postMessage: m => { sent = m; }, disconnect() {} }) };
  const client = nativeAudioClient(runtime), ping = client.request('ping');
  message({ id: 'wrong', version: 'bad' }); message({ id: sent.id, version: 'test' }); assert.equal((await ping).version, 'test');
  const pending = client.request('prepare'); runtime.lastError = { message: 'sensitive native detail' }; disconnect();
  await assert.rejects(pending, error => /install.ps1/.test(error.message) && !error.message.includes('sensitive'));
  client.close();
});
