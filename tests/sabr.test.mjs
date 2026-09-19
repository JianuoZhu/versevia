import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { CompositeBuffer, UmpWriter } from 'googlevideo/ump';
import { VideoPlaybackAbrRequest, MediaHeader, UMPPartId, SabrRedirect, StreamProtectionStatus } from 'googlevideo/protos';
import { audioRequest, decodeTemplate, selectAudio, parseUMP, concat, coveringSegments, mediaURL } from '../src/sabr-protocol.js';
import { decodeSabrChunk } from '../extension/sabr-audio.js';

const id = { itag: 251, lastModified: '1234567890123456', xtags: 'original' };
const video = { itag: 137, lastModified: '2345678901234567' };
const template = () => ({ clientAbrState: { playerTimeMs: '10000', playbackRate: 2, audioTrackId: 'ja.4' }, selectedFormatIds: [id, video], bufferedRanges: [],
  preferredAudioFormatIds: [id], preferredVideoFormatIds: [video], preferredSubtitleFormatIds: [], field1000: [],
  videoPlaybackUstreamerConfig: new Uint8Array([1, 2]), streamerContext: { poToken: new Uint8Array([3, 4]), sabrContexts: [], unsentSabrContexts: [] } });
const formats = [{ ...id, mimeType: 'audio/webm; codecs="opus"', audioTrack: { id: 'ja.4' } }];
function response(parts) {
  const b = new CompositeBuffer([]), writer = new UmpWriter(b);
  for (const [type, data] of parts) writer.write(type, data);
  return concat(b.chunks);
}
function media(headerId, start, init = false, formatId = id) {
  const data = new Uint8Array([1, 2, 3]);
  return [[UMPPartId.MEDIA_HEADER, MediaHeader.encode({ headerId, videoId: 'abcdefghijk', formatId, isInitSeg: init, startMs: String(start * 1000), durationMs: '5000', contentLength: '3' }).finish()],
    [UMPPartId.MEDIA, new Uint8Array([headerId, ...data])], [UMPPartId.MEDIA_END, new Uint8Array([headerId])]];
}
test('SABR requests preserve native authorization and request future audio without moving playback', () => {
  const source = template(), bytes = audioRequest(source, id, 300);
  const body = decodeTemplate(bytes);
  assert.equal(body.clientAbrState.playerTimeMs, '300000'); assert.equal(body.clientAbrState.enabledTrackTypesBitfield, 1);
  assert.equal(body.clientAbrState.playbackRate, 1); assert.equal(source.clientAbrState.playerTimeMs, '10000');
  assert.deepEqual(body.streamerContext.poToken, source.streamerContext.poToken);
  assert.deepEqual(body.preferredAudioFormatIds, [id]); assert.equal(body.selectedFormatIds.some(f => f.itag === 251), false);
  assert.equal(body.bufferedRanges[0].durationMs, '2147483647');
  assert.equal(selectAudio(body, formats, 'ja').format.audioTrack.id, 'ja.4');
  assert.throws(() => selectAudio(body, formats, 'en'), /matching/);
  assert.throws(() => selectAudio(body, [{ ...formats[0], xtags: 'dubbed' }], 'auto'), /matching/);
});
test('UMP extracts only complete matching audio and rejects wrong-video, truncated and protected responses', () => {
  const bytes = response([...media(1, 0, true), ...media(2, 120), ...media(3, 125), ...media(4, 120, false, video)]);
  const parsed = parseUMP(bytes, id, 'abcdefghijk', template());
  assert.equal(parsed.init.length, 3); assert.deepEqual(parsed.segments.map(s => [s.start, s.end]), [[120, 125], [125, 130]]);
  assert.equal(coveringSegments(parsed.segments, 121, 129).length, 2);
  assert.equal(coveringSegments(parsed.segments, 119, 129), null);
  assert.equal(coveringSegments([parsed.segments[0], { ...parsed.segments[1], start: 126 }], 121, 129), null);
  assert.throws(() => parseUMP(bytes.slice(0, -1), id, 'abcdefghijk', template()), /Truncated/);
  assert.throws(() => parseUMP(bytes, id, 'different01', template()), /another video/);
  assert.throws(() => parseUMP(response([[UMPPartId.STREAM_PROTECTION_STATUS, StreamProtectionStatus.encode({ status: 3 }).finish()]]), id, 'abcdefghijk', template()), /authorization/);
  assert.throws(() => parseUMP(response([[UMPPartId.SABR_REDIRECT, SabrRedirect.encode({ url: 'https://evil.test/videoplayback' }).finish()]]), id, 'abcdefghijk', template()), /Unsupported/);
  for (const url of ['https://rr.googlevideo.com.evil.test/videoplayback', 'http://rr.googlevideo.com/videoplayback', 'https://a:b@rr.googlevideo.com/videoplayback']) assert.throws(() => mediaURL(url));
});

test('SABR follows active English audio even when another dubbed track appears first', () => {
  const english = { itag: 251, lastModified: '987654321', xtags: 'english' };
  const ukrainian = { itag: 251, lastModified: '12349876', xtags: 'ukrainian' };
  const source = template(); source.clientAbrState.audioTrackId = 'en-US.4';
  source.preferredAudioFormatIds = [ukrainian, english];
  const available = [
    { ...ukrainian, mimeType: 'audio/webm; codecs="opus"', audioTrack: { id: 'uk.10' } },
    { ...english, mimeType: 'audio/webm; codecs="opus"', audioTrack: { id: 'en-US.4' } }
  ];
  assert.equal(selectAudio(source, available, 'auto').format.audioTrack.id, 'en-US.4');
  assert.throws(() => selectAudio(source, available, 'uk'), /matching/);
  source.clientAbrState.audioTrackId = undefined;
  assert.throws(() => selectAudio(source, available, 'auto'), /ambiguous/);
});
test('SABR decoding clips relative to verified media timestamps, closes contexts and rejects timing drift', async () => {
  const oldAudio = globalThis.AudioContext; let duration = 10, closed = 0;
  globalThis.AudioContext = class {
    async decodeAudioData() { return { duration, sampleRate: 16000, length: duration * 16000, numberOfChannels: 1, getChannelData: () => new Float32Array(duration * 16000) }; }
    async close() { closed++; }
  };
  const result = { audio: btoa('media'), mimeType: 'audio/webm', start: 120, end: 130 };
  try {
    const wav = await decodeSabrChunk(result, 121, 126, new AbortController().signal);
    assert.equal(wav.size, 44 + 5 * 16000 * 2); assert.equal(closed, 1);
    duration = 100;
    await assert.rejects(decodeSabrChunk(result, 121, 126, new AbortController().signal), /duration/);
    assert.equal(closed, 2);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(decodeSabrChunk(result, 121, 126, controller.signal), /abort/i);
    assert.equal(closed, 2);
  } finally { globalThis.AudioContext = oldAudio; }
});
test('bundled MAIN bridge observes player POST, fetches bounded intervals and keeps authorization in the page', async () => {
  const listeners = new Map(), replies = [], calls = [];
  const source = await readFile(new URL('../extension/sabr-page.js', import.meta.url), 'utf8');
  const window = { addEventListener: (type, fn) => listeners.set(type, fn), postMessage: m => replies.push(m),
    ytInitialPlayerResponse: { videoDetails: { videoId: 'abcdefghijk' }, streamingData: { adaptiveFormats: formats } },
    fetch: async (url, options) => { calls.push({ url, options }); return new Response(response([...media(1, 0, true), ...media(2, 120), ...media(3, 125)]), { headers: { 'content-type': 'application/vnd.yt-ump' } }); } };
  const location = { href: 'https://www.youtube.com/watch?v=abcdefghijk', origin: 'https://www.youtube.com' };
  vm.runInNewContext(source, { window, location, document: { getElementById: () => ({ classList: { contains: () => false } }), querySelector: () => ({ duration: 713 }) },
    XMLHttpRequest: class { open() {} send() {} }, URL, Request, Response, AbortController, AbortSignal, Uint8Array, ArrayBuffer, TextDecoder, TextEncoder, DataView, atob, btoa, setTimeout, clearTimeout });
  const request = async (type, extra = {}) => { await listeners.get('message')({ source: window, origin: location.origin,
    data: { channel: 'sentence-youtube-v1', direction: 'request', requestId: String(replies.length), videoId: 'abcdefghijk', type, jobId: 'job', ...extra } }); return replies.at(-1); };
  assert.match((await request('audio-sabr-probe')).error, /No recent/);
  assert.equal(calls.length, 0);
  await window.fetch('https://rr.googlevideo.com/videoplayback?signed=fixture', { method: 'POST', body: VideoPlaybackAbrRequest.encode(template()).finish() });
  const probe = await request('audio-sabr-probe', { language: 'ja' });
  assert.equal(probe.ok, true, probe.error); assert.equal(calls.length, 1);
  const chunk = await request('audio-sabr-chunk', { language: 'ja', start: 121, end: 129 });
  assert.equal(chunk.ok, true, chunk.error); assert.equal(chunk.start, 120); assert.equal(chunk.end, 130);
  assert.equal(calls.length, 2); assert.equal(calls[1].options.credentials, 'omit');
  assert.equal(JSON.stringify(replies).includes('signed=fixture'), false);
  assert.equal(decodeTemplate(calls[1].options.body).clientAbrState.playerTimeMs, '121000');
  listeners.get('yt-navigate-start')();
  assert.match((await request('audio-sabr-probe')).error, /No recent/);
});
