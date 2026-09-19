// Whole-file audio preparation. No real-time recording or playback mutation.
export const DIRECT_MAX_BYTES = 20 * 1024 * 1024;
export const DIRECT_MAX_SECONDS = 900;
export function audioURL(value) {
  const u = new URL(value);
  if (u.protocol !== 'https:' || !u.hostname.endsWith('.googlevideo.com') || u.pathname !== '/videoplayback' || u.port || u.username || u.password) throw new Error('Unsupported audio download URL.');
  return u.href;
}
export async function downloadAudio(source, signal, fetchImpl = fetch) {
  if (!['audio/webm', 'audio/mp4'].includes(source.mimeType?.split(';')[0]) || !(source.duration > 0 && source.duration <= DIRECT_MAX_SECONDS)) throw new Error('Standalone audio decoding is limited to 15 minutes; trying SABR segments.');
  if (Number(source.bytes) > DIRECT_MAX_BYTES) throw new Error('Standalone audio download is limited to 20 MB; trying SABR segments.');
  const response = await fetchImpl(audioURL(source.url), { credentials: 'omit', redirect: 'error', signal });
  if (!response.ok) throw new Error(`Audio download returned HTTP ${response.status}.`);
  if (Number(response.headers.get('content-length')) > DIRECT_MAX_BYTES) { await response.body?.cancel(); throw new Error('Audio exceeds the browser download limit.'); }
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > DIRECT_MAX_BYTES) throw new Error('Audio exceeds the browser download limit.');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  if (!size) throw new Error('Audio download was empty.');
  return new Blob(chunks, { type: source.mimeType.split(';')[0] });
}
export function chunkPlan(duration, from, scope) {
  if (!Number.isFinite(duration) || duration <= 0 || duration > 14400) throw new Error('Only recorded videos up to four hours are supported.');
  const anchor = Math.min(Math.floor(Math.max(0, from || 0) / 30) * 30, Math.max(0, Math.ceil(duration / 30) * 30 - 30));
  const end = scope === 'full' ? duration : Math.min(duration, anchor + 300);
  const chunks = [];
  for (let start = scope === 'full' ? 0 : anchor; start < end; start += 30) chunks.push({ start, end: Math.min(start + 30, end) });
  return chunks.sort((a, b) => ((a.start - anchor + duration) % duration) - ((b.start - anchor + duration) % duration));
}
// PCM WAV is accepted by the speech contract; encode a bounded mono chunk.
export function wavChunk(buffer, start, end) {
  const rate = buffer.sampleRate, first = Math.round(start * rate), count = Math.min(buffer.length, Math.round(end * rate)) - first;
  if (count <= 0) throw new Error('Empty audio interval.');
  const bytes = new ArrayBuffer(44 + count * 2), v = new DataView(bytes);
  const text = (offset, s) => { for (let i = 0; i < s.length; i++) v.setUint8(offset + i, s.charCodeAt(i)); };
  text(0, 'RIFF'); v.setUint32(4, 36 + count * 2, true); text(8, 'WAVE'); text(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); text(36, 'data'); v.setUint32(40, count * 2, true);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  for (let i = 0; i < count; i++) {
    const sample = Math.max(-1, Math.min(1, channels.reduce((sum, c) => sum + c[first + i], 0) / channels.length));
    v.setInt16(44 + i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  }
  return new Blob([bytes], { type: 'audio/wav' });
}
export async function speechCacheKey(videoId, language, config, chunk, trackId = '') {
  const data = JSON.stringify(['speech-audio-v2', videoId, language, trackId, config.endpoint, config.model, chunk.start, chunk.end]);
  return 'speech:' + [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data)))].map(b => b.toString(16).padStart(2, '0')).join('');
}
