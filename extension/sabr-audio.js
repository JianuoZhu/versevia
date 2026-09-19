import { wavChunk } from './audio-media.js';
export async function decodeSabrChunk(result, start, end, signal) {
  signal.throwIfAborted();
  if (result.mimeType !== 'audio/webm' || typeof result.audio !== 'string' || !result.audio.length || result.audio.length > 12 * 1024 * 1024 ||
      !Number.isFinite(result.start) || !Number.isFinite(result.end) || result.start < 0 || result.start > start + 0.08 || result.end < end - 0.08 || result.end - result.start > 120) throw new Error('Invalid SABR audio interval.');
  const audio = new AudioContext({ sampleRate: 16000 });
  try {
    const bytes = Uint8Array.from(atob(result.audio), c => c.charCodeAt(0));
    const decoded = await audio.decodeAudioData(bytes.buffer);
    signal.throwIfAborted();
    // DecodeAudioData removes container timestamps; use verified media headers for the offset.
    // Reject unsupported/discontinuous fragments instead of silently shifting subtitles.
    if (Math.abs(decoded.duration - (result.end - result.start)) > 0.15) throw new Error('Browser decoded audio duration does not match SABR timestamps. This segment cannot be safely transcribed.');
    return wavChunk(decoded, Math.max(0, start - result.start), Math.min(decoded.duration, end - result.start));
  } finally { await audio.close().catch(() => {}); }
}
