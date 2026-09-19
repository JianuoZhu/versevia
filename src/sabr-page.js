import { MAX_RESPONSE, mediaURL, concat, decodeTemplate, selectAudio, audioRequest, parseUMP, coveringSegments } from './sabr-protocol.js';

const CHANNEL = 'sentence-youtube-v1';
const originalFetch = window.fetch;
const originalOpen = XMLHttpRequest.prototype.open, originalSend = XMLHttpRequest.prototype.send;
const requests = new WeakMap();
let observed, active, requestNumber = 100000;
const currentVideo = () => new URL(location.href).searchParams.get('v');
const isAd = () => document.getElementById('movie_player')?.classList.contains('ad-showing');
function remember(raw, body, videoId) {
  try {
    const url = mediaURL(raw).href;
    const bytes = body instanceof ArrayBuffer ? new Uint8Array(body) : ArrayBuffer.isView(body) ? new Uint8Array(body.buffer, body.byteOffset, body.byteLength) : undefined;
    if (!bytes || videoId !== currentVideo() || isAd()) return;
    const template = decodeTemplate(bytes);
    observed = { url, bytes: bytes.slice(), videoId, at: Date.now() };
    const trackId = template.clientAbrState?.audioTrackId;
    if (trackId) window.postMessage({ channel: CHANNEL, direction: 'audio-track-observed', videoId, trackId }, location.origin);
  } catch { /* Ordinary media, captions and unrelated requests are untouched. */ }
}
window.fetch = function (...args) {
  let clone, observedURL, videoId;
  try {
    const [input, options] = args, url = typeof input === 'string' ? input : input?.url || String(input);
    mediaURL(url);
    videoId = currentVideo(); observedURL = url;
    if (options?.body) remember(url, options.body, videoId);
    else if (input instanceof Request && input.method === 'POST') clone = input.clone();
  } catch { /* Not a media request. */ }
  const promise = originalFetch.apply(this, args);
  // Clone before fetch locks the body; read asynchronously without delaying playback.
  clone?.arrayBuffer().then(body => remember(observedURL, body, videoId)).catch(() => {});
  return promise;
};
XMLHttpRequest.prototype.open = function (method, url, ...rest) {
  requests.delete(this);
  if (String(method).toUpperCase() === 'POST') { try { requests.set(this, { url: mediaURL(String(url)).href, videoId: currentVideo() }); } catch { /* Ignore. */ } }
  return originalOpen.call(this, method, url, ...rest);
};
XMLHttpRequest.prototype.send = function (body) {
  const request = requests.get(this);
  if (request) remember(request.url, body, request.videoId);
  return originalSend.call(this, body);
};
function reset() { observed = undefined; active?.controller.abort(); }
window.addEventListener('yt-navigate-start', reset);
window.addEventListener('pagehide', reset);
function selected(videoId, language) {
  if (!observed || observed.videoId !== videoId || Date.now() - observed.at > 15 * 60 * 1000) throw new Error('No recent SABR request captured. Reload this YouTube page after updating the extension, play briefly, then retry.');
  if (isAd() || document.querySelector('video')?.mediaKeys) throw new Error('Wait for advertisements to finish. Protected media is unsupported.');
  let live; try { live = document.getElementById('movie_player')?.getPlayerResponse?.(); } catch { /* Initial metadata. */ }
  const formats = [live, window.ytInitialPlayerResponse].filter(d => d?.videoDetails?.videoId === videoId).flatMap(d => d.streamingData?.adaptiveFormats || []);
  const body = decodeTemplate(observed.bytes);
  return { body, ...selectAudio(body, formats, language), url: observed.url };
}
async function readBounded(response) {
  if (!response.ok) throw new Error(`YouTube audio returned HTTP ${response.status}.`);
  if (!response.headers.get('content-type')?.includes('application/vnd.yt-ump')) throw new Error('YouTube did not return a SABR media response.');
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE) { await response.body?.cancel(); throw new Error('SABR response exceeds the 8 MB limit.'); }
  const reader = response.body.getReader(), chunks = []; let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE) throw new Error('SABR response exceeds the 8 MB limit.');
      chunks.push(value);
    }
    return concat(chunks);
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
async function chunk(m, signal) {
  const { body, id, format, url: initialURL } = selected(m.videoId, m.language);
  const contexts = new Map((body.streamerContext?.sabrContexts || []).map(c => [c.type, c]));
  let url = initialURL, init, segments = [], cursor = m.start, delay = 0;
  for (let attempt = 0; attempt < 8; attempt++) {
    signal.throwIfAborted();
    if (m.videoId !== currentVideo() || isAd()) throw new Error('Video changed or an advertisement started.');
    if (delay) await new Promise((resolve, reject) => {
      const stop = () => { clearTimeout(timer); reject(signal.reason); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', stop); resolve(); }, delay);
      signal.addEventListener('abort', stop, { once: true });
    });
    const target = mediaURL(url); target.searchParams.set('rn', String(requestNumber++));
    const response = await originalFetch.call(window, target.href, { method: 'POST', body: audioRequest(body, id, cursor, !!init),
      headers: { 'Content-Type': 'application/x-protobuf' }, credentials: 'omit', redirect: 'error', signal });
    const result = parseUMP(await readBounded(response), id, m.videoId, body, contexts);
    init ||= result.init;
    segments.push(...result.segments);
    if (segments.reduce((n, s) => n + s.data.length, init?.length || 0) > MAX_RESPONSE) throw new Error('Audio interval exceeds the 8 MB limit.');
    url = result.redirect || url; delay = result.delay;
    const coverage = coveringSegments(segments, m.start, m.end);
    if (init && coverage) {
      const bytes = concat([init, ...coverage.map(s => s.data)]);
      let binary = ''; for (let i = 0; i < bytes.length; i += 16384) binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
      return { audio: btoa(binary), start: coverage[0].start, end: coverage.at(-1).end, mimeType: 'audio/webm', language: format.audioTrack?.id?.split('.')[0] || 'auto', trackId: format.audioTrack?.id || JSON.stringify(id) };
    }
    // Advance only through contiguous coverage of the requested interval.
    const sorted = [...segments].sort((a, b) => a.start - b.start);
    cursor = m.start;
    for (const s of sorted) if (s.start <= cursor + 0.08 && s.end > cursor) cursor = s.end;
  }
  throw new Error('SABR did not supply a complete audio interval. Play briefly and retry; this player session may be unsupported.');
}
window.addEventListener('message', async event => {
  const m = event.data;
  if (event.source !== window || event.origin !== location.origin || m?.channel !== CHANNEL || m.direction !== 'request' || m.videoId !== currentVideo() || !/^[\w-]{11}$/.test(m.videoId || '') || typeof m.requestId !== 'string') return;
  if (!['audio-sabr-probe', 'audio-sabr-chunk', 'audio-sabr-cancel'].includes(m.type)) return;
  const reply = data => window.postMessage({ channel: CHANNEL, direction: 'response', requestId: m.requestId, videoId: m.videoId, ...data }, location.origin);
  if (m.type === 'audio-sabr-cancel') { if (active?.jobId === m.jobId) active.controller.abort(); reply({ ok: true }); return; }
  try {
    if (m.type === 'audio-sabr-probe') { const { format, id } = selected(m.videoId, m.language); reply({ ok: true, language: format.audioTrack?.id?.split('.')[0] || 'auto', trackId: format.audioTrack?.id || JSON.stringify(id) }); return; }
    if (active) throw new Error('A SABR audio request is already running. Retry shortly.');
    const duration = Number(document.querySelector('video')?.duration);
    if (typeof m.jobId !== 'string' || !Number.isFinite(m.start) || !Number.isFinite(m.end) || m.start < 0 || m.end <= m.start || m.end - m.start > 32.1 || !Number.isFinite(duration) || m.end > duration + 0.1) throw new Error('Invalid SABR audio interval.');
    const task = active = { jobId: m.jobId, controller: new AbortController() };
    try { const result = await chunk(m, AbortSignal.any([task.controller.signal, AbortSignal.timeout(60000)])); reply({ ok: true, ...result }); }
    finally { if (active === task) active = undefined; }
  } catch (error) { reply({ ok: false, error: error.name === 'TimeoutError' ? 'SABR audio request timed out. Play briefly and retry.' : error.message }); }
});
