import { downloadAudio, chunkPlan, wavChunk, speechCacheKey } from './audio-media.js';
import { cacheGet, cachePut } from './cache.js';
import { transcribe } from './providers.js';
import { transcriptionCues } from './core.js';
import { decodeSabrChunk } from './sabr-audio.js';
import { audioIdentity, recognitionLanguage, transcriptionLanguage } from './speech-language.js';

export async function runAudioJob(state, config, sources, controller, rpc) {
  const signal = controller.signal;
  const emit = (type, data) => { signal.throwIfAborted(); return rpc({ type, videoId: state.videoId, jobId: state.id, ...data }); };
  const progress = status => emit('capture-progress', { status });
  if (state.probe) {
    await progress('Testing SABR audio download and browser decoding…');
    const start = Math.max(0, Math.min(state.from, state.videoDuration - 5)), end = Math.min(state.videoDuration, start + 5);
    const result = await emit('audio-sabr-chunk', { start, end });
    if (!result?.ok) throw new Error(result?.error || 'SABR audio test failed.');
    const blob = await decodeSabrChunk(result, start, end, signal);
    const samples = new DataView(await blob.arrayBuffer()); let energy = 0;
    for (let i = 44; i < samples.byteLength; i += 2) energy += (samples.getInt16(i, true) / 32768) ** 2;
    const rms = Math.sqrt(energy / Math.max(1, (samples.byteLength - 44) / 2));
    return `SABR audio verified: ${(end - start).toFixed(1)} s decoded at ${start.toFixed(1)} s · ${rms > 0.0001 ? 'audio signal detected' : 'silent interval'} · language ${result.language || 'unknown'}, track ${audioIdentity(result) || 'unknown'}. No speech API called.`;
  }
  // Resolve the actual track before cache lookup or any paid request. A metadata
  // probe does not download audio, so complete cache hits still avoid downloads.
  const probe = await emit('audio-sabr-probe', {});
  signal.throwIfAborted();
  const sabr = !!probe?.ok && !!audioIdentity(probe);
  const selected = sabr ? probe : (sources || []).find(s => audioIdentity(s));
  if (!selected) throw new Error(probe?.error || 'Could not identify the active audio track. Play briefly and retry.');
  const trackId = audioIdentity(selected);
  let language = recognitionLanguage(state.language, selected.language);
  const indexKey = await speechCacheKey(state.videoId, state.language, config, { start: 0, end: 'index' }, trackId);
  let saved;
  try { saved = JSON.parse(await cacheGet(indexKey)); } catch { /* Missing/expired cache. */ }
  if (!saved || saved.trackId !== trackId || Math.abs(saved.duration - state.videoDuration) > 2) saved = { duration: state.videoDuration, chunks: {}, language, trackId };
  if (language === 'auto') language = saved.language;
  const plan = chunkPlan(state.videoDuration, state.from, state.scope);
  let decoded, audio;
  const deliver = (chunk, result) => emit('audio-cues', { cues: result.cues, language: result.language, interval: chunk, trackId });
  try {
    // Cached subtitles can be restored without downloading or calling ASR again.
    for (const chunk of plan) if (saved.chunks[chunk.start]?.end === chunk.end) await deliver(chunk, saved.chunks[chunk.start]);
    if (plan.every(c => saved.chunks[c.start]?.end === c.end)) { await progress('Subtitles restored from cache.'); return; }
    let directError = '';
    for (const source of sabr ? [] : (sources || []).filter(s => audioIdentity(s) === trackId)) {
      signal.throwIfAborted();
      try {
        await progress('Downloading video audio in the browser…');
        const blob = await downloadAudio(source, AbortSignal.any([signal, AbortSignal.timeout(60000)]));
        audio = new AudioContext({ sampleRate: 16000 });
        decoded = await audio.decodeAudioData(await blob.arrayBuffer());
        await audio.close(); audio = undefined;
        signal.throwIfAborted();
        if (Math.abs(decoded.duration - state.videoDuration) > 2) { decoded = undefined; throw new Error('Downloaded audio duration does not match the video.'); }
        break;
      } catch (error) { signal.throwIfAborted(); directError = error.message; if (audio) await audio.close().catch(() => {}); audio = undefined; }
    }
    if (!decoded && !sabr) throw new Error(directError || 'Browser audio unavailable. Play briefly to capture a SABR request, then retry.');
    const queue = plan.filter(c => saved.chunks[c.start]?.end !== c.end);
    let completed = plan.length - queue.length;
    while (queue.length) {
      signal.throwIfAborted();
      // Prioritize the viewer's current position within the already approved scope.
      const snapshot = (await emit('capture-snapshot', {}))?.snapshot;
      signal.throwIfAborted();
      if (!snapshot || snapshot.videoId !== state.videoId) throw new Error('Video changed.');
      const position = Math.floor(Math.max(0, snapshot.time ?? state.from ?? 0) / 30) * 30;
      const distance = c => (c.start - position + state.videoDuration) % state.videoDuration;
      queue.sort((a, b) => distance(a) - distance(b));
      const chunk = queue.shift();
      await progress(`Recognizing ${language} audio · ${Math.floor(chunk.start / 60)}:${String(Math.floor(chunk.start % 60)).padStart(2, '0')} · ${completed + 1}/${plan.length}…`);
      const start = Math.max(0, chunk.start - 1), end = Math.min(state.videoDuration, chunk.end + 1);
      let blob;
      if (!decoded) {
        const result = await emit('audio-sabr-chunk', { start, end });
        signal.throwIfAborted();
        if (!result?.ok) throw new Error(result?.error || 'Audio chunk preparation failed.');
        if (audioIdentity(result) !== trackId) throw new Error('YouTube audio track changed. Start generation again for the selected track.');
        language = recognitionLanguage(language, result.language);
        blob = await decodeSabrChunk(result, start, end, signal);
      } else blob = wavChunk(decoded, start, end);
      const data = await transcribe(blob, language, config, AbortSignal.any([signal, AbortSignal.timeout(90000)]));
      signal.throwIfAborted();
      language = transcriptionLanguage(data, language);
      const cues = transcriptionCues(data, start, end - start)
        .filter(c => (c.start + c.end) / 2 >= chunk.start && (c.start + c.end) / 2 < chunk.end)
        .map(c => ({ ...c, start: Math.max(chunk.start, c.start), end: Math.min(chunk.end, c.end) }));
      const result = { end: chunk.end, cues, language };
      saved.chunks[chunk.start] = result; saved.language = result.language;
      await cachePut(indexKey, JSON.stringify(saved));
      await deliver(chunk, result); completed++;
    }
    await progress('Speech subtitles ready and cached.');
  } finally { decoded = undefined; if (audio) await audio.close().catch(() => {}); }
}
