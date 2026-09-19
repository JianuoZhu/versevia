import { transcribe } from './providers.js';
import { transcriptionCues } from './core.js';
import { runAudioJob } from './audio-job.js';
let session;
const send = message => chrome.runtime.sendMessage(message);
async function release(s) {
  clearInterval(s.poll); clearTimeout(s.timer);
  s.media?.getTracks().forEach(track => track.stop());
  if (s.audio && s.audio.state !== 'closed') await s.audio.close().catch(() => {});
}
async function cancel(reason) {
  const s = session; if (!s) return;
  session = undefined; s.cancelled = true; s.controller.abort();
  if (s.recorder?.state !== 'inactive') s.recorder?.stop();
  await release(s); s.chunks = [];
  await send({ type: 'capture-result', videoId: s.state.videoId, jobId: s.state.id, error: reason });
}
function startAudio(message) {
  if (session) throw new Error('Audio processing is already active.');
  const s = session = { state: message.state, controller: new AbortController(), chunks: [] };
  void runAudioJob(message.state, message.config, message.sources, s.controller, send)
    .then(status => { if (session === s) return send({ type: 'capture-result', videoId: s.state.videoId, jobId: s.state.id, complete: true, status }); })
    .catch(error => { if (session === s) return send({ type: 'capture-result', videoId: s.state.videoId, jobId: s.state.id, error: error.message }); })
    .finally(() => { if (session === s) session = undefined; });
}
async function finish() {
  const s = session;
  if (!s || s.uploading || s.recorder?.state !== 'recording') throw new Error('No recording is active.');
  const { snapshot } = await send({ type: 'capture-snapshot' });
  if (session !== s) return;
  if (!valid(s, snapshot)) { await cancel('Playback changed. This recording was discarded.'); return; }
  s.end = snapshot.time; s.uploading = true;
  s.recorder.stop();
  await release(s);
}
function valid(s, snapshot) {
  return snapshot?.videoId === s.state.videoId && !snapshot.paused && !snapshot.ad && snapshot.rate === 1 &&
    Math.abs((snapshot.time - s.offset) - (performance.now() - s.started) / 1000) < 1.2;
}
async function start(message) {
  if (session) throw new Error('A recording is already active.');
  const s = session = { state: message.state, config: message.config, controller: new AbortController(), chunks: [] };
  try {
    s.media = await navigator.mediaDevices.getUserMedia({ audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: message.streamId } }, video: false });
    if (session !== s) { await release(s); throw new Error('Recording cancelled.'); }
    s.audio = new AudioContext();
    s.audio.createMediaStreamSource(s.media).connect(s.audio.destination);
    await s.audio.resume();
    const { snapshot } = await send({ type: 'capture-snapshot' });
    if (session !== s) throw new Error('Recording cancelled.');
    if (!snapshot || snapshot.videoId !== s.state.videoId || snapshot.paused || snapshot.ad || snapshot.rate !== 1) throw new Error('Playback changed before capture started.');
    s.offset = snapshot.time; s.started = performance.now();
    if (!MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) throw new Error('This browser does not support WebM/Opus recording.');
    s.recorder = new MediaRecorder(s.media, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 64000 });
    s.recorder.ondataavailable = event => { if (event.data.size && !s.cancelled) s.chunks.push(event.data); };
    s.recorder.onerror = () => { void cancel('Audio recorder failed.'); };
    s.recorder.onstop = async () => {
      if (s.cancelled || session !== s) return;
      try {
        if (!s.uploading || !s.end || s.end - s.offset < 1) throw new Error('Record at least one second of uninterrupted audio.');
        await send({ type: 'capture-progress', videoId: s.state.videoId, jobId: s.state.id, status: 'Transcribing recorded audio…' });
        if (session !== s || s.controller.signal.aborted) return;
        const blob = new Blob(s.chunks, { type: 'audio/webm' }); s.chunks = [];
        if (!blob.size || blob.size > 10000000) throw new Error('Audio recording was empty or too large.');
        const data = await transcribe(blob, s.state.language, s.config, AbortSignal.any([s.controller.signal, AbortSignal.timeout(90000)]));
        const cues = transcriptionCues(data, s.offset, s.end - s.offset);
        if (!cues.length) throw new Error('No timestamped speech was detected in this recording.');
        if (session === s) await send({ type: 'capture-result', videoId: s.state.videoId, jobId: s.state.id, cues, language: s.state.language === 'auto' ? (data.language || 'auto') : s.state.language });
      } catch (error) {
        if (session === s) await send({ type: 'capture-result', videoId: s.state.videoId, jobId: s.state.id, error: error.name === 'AbortError' ? 'Transcription cancelled.' : error.message });
      } finally {
        await release(s); s.config = undefined; s.chunks = [];
        if (session === s) session = undefined;
      }
    };
    s.media.getAudioTracks()[0].onended = () => { if (!s.uploading && !s.cancelled) void cancel('Tab audio capture ended.'); };
    s.recorder.start();
    s.timer = setTimeout(() => { void finish().catch(e => cancel(e.message)); }, s.state.duration * 1000);
    let polling = false;
    s.poll = setInterval(async () => {
      if (polling || session !== s || s.uploading) return;
      polling = true;
      try {
        const { snapshot } = await send({ type: 'capture-snapshot' });
        if (session === s && !s.uploading && !valid(s, snapshot)) await cancel('Playback paused, sought, buffered, changed speed, or entered an ad. Recording discarded.');
      } catch { if (session === s) await cancel('The YouTube tab is unavailable.'); }
      finally { polling = false; }
    }, 500);
    await send({ type: 'capture-progress', videoId: s.state.videoId, jobId: s.state.id, status: `Recording up to ${s.state.duration} seconds…` });
  } catch (error) { if (session === s) await cancel(error.message); else await release(s); throw error; }
}
chrome.runtime.onMessage.addListener((m, sender, respond) => {
  if (m?.target !== 'offscreen' || sender.id !== chrome.runtime.id || sender.tab || (sender.url && sender.url !== chrome.runtime.getURL('background.js'))) return false;
  (async () => {
    if (m.type === 'start') await start(m);
    else if (m.type === 'start-audio') startAudio(m);
    else if (m.type === 'finish') await finish();
    else if (m.type === 'cancel') { if (!m.jobId || session?.state.id === m.jobId) await cancel(m.reason); }
    else throw new Error('Unknown recording command.');
  })().then(() => respond({ ok: true }), e => respond({ ok: false, error: e.message }));
  return true;
});
