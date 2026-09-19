import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../extension/bridge.js', import.meta.url), 'utf8');
function setup({ body = '{"events":[]}', status = 200 } = {}) {
  let listener; const replies = [], calls = [];
  const data = { videoDetails: { videoId: 'abcdefghijk' }, captions: { playerCaptionsTracklistRenderer: {
    captionTracks: [{ vssId: '.en', languageCode: 'en', name: { simpleText: 'English' }, baseUrl: 'https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=en' },
      { vssId: 'a.en', languageCode: 'en', kind: 'asr', baseUrl: 'https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=en&kind=asr' }],
    audioTracks: [{ defaultCaptionTrackIndex: 0 }] } } };
  const window = { ytInitialPlayerResponse: data, addEventListener: (_type, fn) => { listener = fn; }, postMessage: reply => replies.push(reply),
    fetch: async (...args) => { calls.push(args); return new Response(body, { status }); } };
  const context = { window, document: { getElementById: () => ({ getPlayerResponse: () => data }) },
    location: { href: 'https://www.youtube.com/watch?v=abcdefghijk', origin: 'https://www.youtube.com' },
    URL, AbortSignal, XMLHttpRequest: class { open() {} addEventListener(type, fn) { this[type] = fn; } }, fetch: window.fetch };
  vm.runInNewContext(source, context);
  return { data, calls, replies, context, async request(type, extra = {}) {
    await listener({ source: window, origin: context.location.origin, data: { channel: 'sentence-youtube-v1', direction: 'request', requestId: 'req', videoId: 'abcdefghijk', type, ...extra } });
    return replies.findLast(r => r.direction === 'response');
  }, async observed(url, text) { const response = window.fetch(url); await response; await new Promise(resolve => setImmediate(resolve)); }, window };
}
test('bridge discovers creator and automatic tracks without exposing signed URLs', async () => {
  const env = setup(); const r = await env.request('discover');
  assert.equal(r.ready, true); assert.equal(r.tracks[0].kind, 'creator'); assert.equal(r.tracks[1].kind, 'automatic');
  assert.equal(r.tracks[0].url, undefined); assert.equal(r.tracks[0].isDefault, true);
});
test('bridge falls back to initial response when the live player omits captions', async () => {
  const env = setup();
  env.context.document.getElementById = () => ({ getPlayerResponse: () => ({ videoDetails: { videoId: 'abcdefghijk' } }) });
  const response = await env.request('discover');
  assert.equal(response.tracks.length, 2);
});
test('bridge still discovers initial tracks while the player getter is not ready', async () => {
  const env = setup();
  env.context.document.getElementById = () => ({ getPlayerResponse: () => { throw new Error('Player not ready'); } });
  const response = await env.request('discover');
  assert.equal(response.tracks?.length, 2);
});
test('bridge requests only discovered YouTube timedtext URLs with session credentials', async () => {
  const env = setup(); const r = await env.request('captions', { trackId: '.en' });
  assert.equal(r.body, '{"events":[]}'); assert.equal(env.calls[0][0].searchParams.get('fmt'), 'json3');
  assert.equal(env.calls[0][1].credentials, 'include');
});
test('empty HTTP 200 caption responses become an actionable error', async () => {
  const env = setup({ body: '' }); const r = await env.request('captions', { trackId: '.en' });
  assert.match(r.error, /empty caption response/);
});
test('bridge rejects arbitrary fetch destinations and stale video responses', async () => {
  const env = setup(); env.data.captions.playerCaptionsTracklistRenderer.captionTracks[0].baseUrl = 'https://evil.example/api/timedtext';
  assert.match((await env.request('captions', { trackId: '.en' })).error, /Unsupported/); assert.equal(env.calls.length, 0);
  env.data.videoDetails.videoId = 'otherid1234'; assert.equal((await env.request('discover')).tracks.length, 0);
});
test('observed player caption responses are reused without another fetch', async () => {
  const env = setup();
  await env.observed('https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=en');
  const r = await env.request('captions', { trackId: '.en' });
  assert.equal(r.body, '{"events":[]}'); assert.equal(env.calls.length, 1);
});

test('JSON-type native XHR caption responses are reused', async () => {
  const env = setup();
  const xhr = new env.context.XMLHttpRequest();
  xhr.open('GET', 'https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=en');
  xhr.responseType = 'json'; xhr.response = { events: [{ tStartMs: 1000, segs: [{ utf8: 'Native caption.' }] }] };
  xhr.load();
  const result = await env.request('captions', { trackId: '.en' });
  assert.equal(JSON.parse(result.body).events[0].segs[0].utf8, 'Native caption.');
  assert.equal(env.calls.length, 0);
});

test('native track selection accepts only a discovered track on the current video', async () => {
  const env = setup(); const selected = [];
  env.context.document.getElementById = () => ({ getPlayerResponse: () => env.data, setOption: (...args) => selected.push(args) });
  assert.equal((await env.request('select-track', { trackId: 'a.en' })).selected, true);
  assert.equal(selected[0][2].kind, 'asr'); assert.equal(selected[0][2].languageCode, 'en');
  await env.request('select-track', { trackId: 'arbitrary' }); assert.equal(selected.length, 1);
});

test('audio discovery detects SABR-only players and never invents media URLs', async () => {
  const env = setup(); env.data.streamingData = { serverAbrStreamingUrl: 'private-sabr-url', adaptiveFormats: [{ itag: 251, mimeType: 'audio/webm; codecs="opus"' }] };
  const result = await env.request('audio-discover');
  assert.equal(result.sources.length, 0); assert.match(result.reason, /SABR/); assert.equal(env.calls.length, 0);
  assert.equal(JSON.stringify(result).includes('private-sabr-url'), false);
});

test('audio discovery filters foreign URLs, stale videos and language mismatches', async () => {
  const env = setup(); env.data.videoDetails.lengthSeconds = '60';
  const format = { mimeType: 'audio/webm; codecs="opus"', audioTrack: { id: 'ja.4' }, contentLength: '12000' };
  env.data.streamingData = { adaptiveFormats: [
    { ...format, url: 'https://rr.googlevideo.com/videoplayback?id=audio' },
    { ...format, url: 'https://evil.example/videoplayback' },
    { ...format, audioTrack: { id: 'en.1' }, url: 'https://rr.googlevideo.com/videoplayback?id=dub' }
  ] };
  assert.equal((await env.request('audio-discover', { language: 'ja' })).sources.length, 0, 'multiple dubbed tracks must not guess the original audio');
  env.data.streamingData.adaptiveFormats.pop();
  const result = await env.request('audio-discover', { language: 'ja' });
  assert.equal(result.sources[0].trackId, 'ja.4');
  assert.equal(result.sources.length, 1); assert.equal(result.sources[0].duration, 60);
  env.data.videoDetails.videoId = 'lmnopqrstuv'; assert.equal((await env.request('audio-discover')).sources.length, 0);
});
