// Built into the extension. No remote scripts, player deciphering or native code.
import { CompositeBuffer, UmpReader } from 'googlevideo/ump';
import { VideoPlaybackAbrRequest, MediaHeader, UMPPartId, SabrRedirect, SabrError,
  StreamProtectionStatus, NextRequestPolicy, PlaybackCookie, SabrContextUpdate,
  SabrContextSendingPolicy } from 'googlevideo/protos';

export const MAX_RESPONSE = 8 * 1024 * 1024;
export function mediaURL(raw) {
  const u = new URL(raw);
  if (u.protocol !== 'https:' || !u.hostname.endsWith('.googlevideo.com') || u.pathname !== '/videoplayback' || u.port || u.username || u.password) throw new Error('Unsupported SABR media address.');
  return u;
}
export function concat(chunks) {
  const result = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const c of chunks) { result.set(c, offset); offset += c.length; }
  return result;
}
export function decodeTemplate(bytes) {
  if (!bytes?.byteLength || bytes.byteLength > 256 * 1024) throw new Error('Invalid SABR request size.');
  const body = VideoPlaybackAbrRequest.decode(bytes);
  if (!body.videoPlaybackUstreamerConfig?.length || !body.clientAbrState || !body.preferredAudioFormatIds.length) throw new Error('Not a SABR audio request.');
  return body;
}
export function sameFormat(a, b) {
  return a?.itag === b?.itag && String(a?.lastModified || '') === String(b?.lastModified || '') && (a?.xtags || '') === (b?.xtags || '');
}
export function selectAudio(body, formats, language) {
  // Reuse the exact track selected by the native player, including dubbed/original identity.
  const candidates = body.preferredAudioFormatIds.map(id => ({ id, format: formats.find(f => f.itag === id.itag && String(f.lastModified) === String(id.lastModified) && (f.xtags || '') === (id.xtags || '')) }))
    .filter(c => c.format && /^audio\/webm/.test(c.format.mimeType || '') && !c.format.drmFamilies?.length && !c.format.drmTrackType);
  const activeTrack = body.clientAbrState?.audioTrackId;
  const active = activeTrack ? candidates.filter(c => c.format.audioTrack?.id === activeTrack) : candidates;
  if (new Set(active.map(c => c.format.audioTrack?.id || c.id.xtags || '')).size > 1) throw new Error('Player audio track is ambiguous. Select an audio track in YouTube settings, play briefly, then retry.');
  const candidate = active.find(c => !language || language === 'auto' || c.format.audioTrack?.id?.split('.')[0]?.split('-')[0] === language.split('-')[0]);
  if (!candidate) throw new Error('No matching WebM audio track in the player request. Select the desired audio track in YouTube settings, play briefly, then retry.');
  return candidate;
}
export function audioRequest(template, id, start, initialized = false) {
  const body = VideoPlaybackAbrRequest.decode(VideoPlaybackAbrRequest.encode(template).finish());
  body.clientAbrState = { ...body.clientAbrState, playerTimeMs: String(Math.round(start * 1000)), playbackRate: 1, enabledTrackTypesBitfield: 1 };
  body.playerTimeMs = undefined; body.field6 = undefined; body.field1000 = [];
  body.preferredAudioFormatIds = [id]; body.preferredSubtitleFormatIds = [];
  body.selectedFormatIds = initialized ? [id] : [];
  body.bufferedRanges = [];
  for (const video of body.preferredVideoFormatIds) {
    body.selectedFormatIds.push(video);
    body.bufferedRanges.push({ formatId: video, startTimeMs: '0', durationMs: '2147483647', startSegmentIndex: 2147483647, endSegmentIndex: 2147483647,
      timeRange: { startTicks: '0', durationTicks: '2147483647', timescale: 1000 } });
  }
  return VideoPlaybackAbrRequest.encode(body).finish();
}
export function segmentTime(h) {
  const t = h.timeRange;
  const start = t?.timescale > 0 && t.startTicks !== undefined ? Number(t.startTicks) / t.timescale : Number(h.startMs) / 1000;
  const duration = t?.timescale > 0 && t.durationTicks !== undefined ? Number(t.durationTicks) / t.timescale : Number(h.durationMs) / 1000;
  if (!Number.isFinite(start) || !Number.isFinite(duration) || start < 0 || duration <= 0 || duration > 120) throw new Error('Invalid SABR segment timestamps.');
  return { start, end: start + duration };
}
export function parseUMP(bytes, id, videoId, template, contexts = new Map((template.streamerContext?.sabrContexts || []).map(c => [c.type, c]))) {
  if (bytes.length > MAX_RESPONSE) throw new Error('SABR response exceeds the 8 MB limit.');
  const reader = new UmpReader(new CompositeBuffer([bytes]));
  const pending = new Map(), segments = [], activeContexts = new Set((template.streamerContext?.sabrContexts || []).map(c => c.type));
  let init, redirect, delay = 0, consumed = 0;
  reader.read(part => {
    // The complete response is buffered, so any trailing incomplete UMP part is an error.
    const data = concat(part.data.chunks);
    const typeSize = n => n < 128 ? 1 : n < 16384 ? 2 : n < 2097152 ? 3 : n < 268435456 ? 4 : 5;
    consumed += typeSize(part.type) + typeSize(part.size) + part.size;
    const decode = decoder => decoder.decode(data);
    if (part.type === UMPPartId.MEDIA_HEADER) {
      const h = decode(MediaHeader), key = h.formatId || { itag: h.itag, lastModified: h.lmt, xtags: h.xtags };
      if (h.videoId && h.videoId !== videoId) throw new Error('SABR returned audio for another video.');
      if (sameFormat(key, id)) {
        if (h.compressionAlgorithm) throw new Error('Compressed SABR media is unsupported.');
        pending.set(h.headerId, { h, chunks: [] });
      }
    } else if (part.type === UMPPartId.MEDIA) {
      if (!data.length) throw new Error('Empty SABR media part.');
      pending.get(data[0])?.chunks.push(data.subarray(1));
    } else if (part.type === UMPPartId.MEDIA_END) {
      const item = pending.get(data[0]);
      if (item) {
        pending.delete(data[0]);
        const media = concat(item.chunks);
        if (item.h.contentLength && Number(item.h.contentLength) !== media.length) throw new Error('Incomplete SABR media segment.');
        if (item.h.isInitSeg) init = media;
        else segments.push({ ...segmentTime(item.h), sequence: item.h.sequenceNumber, data: media });
      }
    } else if (part.type === UMPPartId.SABR_ERROR) {
      decode(SabrError); throw new Error('YouTube rejected the SABR audio request. Refresh the video and retry.');
    } else if (part.type === UMPPartId.STREAM_PROTECTION_STATUS) {
      if (decode(StreamProtectionStatus).status === 3) throw new Error('YouTube requires renewed player authorization. Play briefly and retry.');
    } else if (part.type === UMPPartId.SABR_REDIRECT) redirect = mediaURL(decode(SabrRedirect).url).href;
    else if (part.type === UMPPartId.NEXT_REQUEST_POLICY) {
      const policy = decode(NextRequestPolicy);
      if (policy.playbackCookie && template.streamerContext) template.streamerContext.playbackCookie = PlaybackCookie.encode(policy.playbackCookie).finish();
      delay = Math.max(delay, policy.backoffTimeMs || 0);
    } else if (part.type === UMPPartId.SABR_CONTEXT_UPDATE) {
      const ctx = decode(SabrContextUpdate);
      if (!contexts.has(ctx.type) || ctx.writePolicy === 1) contexts.set(ctx.type, ctx);
      if (ctx.sendByDefault) activeContexts.add(ctx.type);
    } else if (part.type === UMPPartId.SABR_CONTEXT_SENDING_POLICY && template.streamerContext) {
      const policy = decode(SabrContextSendingPolicy);
      for (const type of policy.discardPolicy) contexts.delete(type);
      policy.startPolicy.forEach(t => activeContexts.add(t)); policy.stopPolicy.forEach(t => activeContexts.delete(t));
    } else if (part.type === UMPPartId.RELOAD_PLAYER_RESPONSE) throw new Error('YouTube requested a player refresh. Reload the video and retry.');
  });
  if (consumed !== bytes.length || pending.size) throw new Error('Truncated SABR response.');
  if (delay > 10000) throw new Error('YouTube asked to slow audio requests. Retry later.');
  if (template.streamerContext) {
    template.streamerContext.sabrContexts = [...contexts.values()].filter(c => activeContexts.has(c.type));
    template.streamerContext.unsentSabrContexts = [...new Set([...template.streamerContext.unsentSabrContexts, ...contexts.keys()])].filter(t => !activeContexts.has(t));
  }
  return { init, segments, redirect, delay };
}
export function coveringSegments(segments, start, end) {
  const sorted = [...new Map(segments.map(s => [s.start, s])).values()].sort((a, b) => a.start - b.start);
  const selected = sorted.filter(s => s.end > start + 0.001 && s.start < end - 0.001);
  if (!selected.length || selected[0].start > start + 0.08) return null;
  let cursor = selected[0].start;
  for (const s of selected) { if (Math.abs(s.start - cursor) > 0.08) return null; cursor = s.end; }
  return cursor >= end - 0.08 ? selected : null;
}
