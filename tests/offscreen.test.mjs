import test from 'node:test';
import assert from 'node:assert/strict';
const settle = () => new Promise(resolve => setImmediate(resolve));
test('offscreen audio lifecycle records, transcribes and cancels safely', async t => {
  let handler, clock = 10000, stops = 0, closed = 0, uploads = 0, recorder;
  let snapshot = { videoId: 'abcdefghijk', time: 100, paused: false, ad: false, rate: 1 };
  const messages = [], intervals = [], timers = [];
  const chrome = { runtime: { id: 'fixture', getURL: file => `chrome-extension://fixture/${file}`,
    onMessage: { addListener: fn => { handler = fn; } },
    sendMessage: async m => { messages.push(m); return m.type === 'capture-snapshot' ? { ok: true, snapshot } : { ok: true }; } } };
  const track = { stop: () => { stops++; } };
  class Recorder {
    static isTypeSupported() { return true; }
    constructor() { recorder = this; this.state = 'inactive'; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; queueMicrotask(() => { this.ondataavailable?.({ data: new Blob(['audio']) }); void this.onstop?.(); }); }
  }
  class Audio {
    state = 'suspended'; destination = {};
    createMediaStreamSource() { return { connect() {} }; }
    async resume() { this.state = 'running'; }
    async close() { this.state = 'closed'; closed++; }
  }
  const originals = new Map();
  for (const [key, value] of Object.entries({ chrome, MediaRecorder: Recorder, AudioContext: Audio,
    navigator: { mediaDevices: { getUserMedia: async constraint => { assert.equal(constraint.video, false); assert.equal(constraint.audio.mandatory.chromeMediaSource, 'tab'); return { getTracks: () => [track], getAudioTracks: () => [track] }; } } },
    performance: { now: () => clock }, setInterval: fn => { intervals.push(fn); return intervals.length; }, clearInterval: () => {},
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout: () => {},
    fetch: async (url, options) => { uploads++; assert.equal(options.body.get('response_format'), 'verbose_json'); return Response.json({ language: 'english', segments: [{ start: 0, end: 2, text: 'Hello.' }] }); }
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const request = (type, extra = {}, sender = { id: 'fixture' }) => new Promise(resolve => {
    const listening = handler({ target: 'offscreen', type, ...extra }, sender, resolve); if (!listening) resolve(undefined);
  });
  const start = () => request('start', { streamId: 'fixture-stream', state: { id: 'recording-fixture', videoId: 'abcdefghijk', language: 'en', duration: 30 }, config: { endpoint: 'https://asr.example/transcriptions', model: 'whisper-1', key: '' } });
  try {
    await import(`../extension/offscreen.js?test=${Date.now()}`);
    await t.test('rejects direct commands from extension content scripts and popup pages', async () => {
      assert.equal(await request('start', {}, { id: 'fixture', tab: { id: 7 } }), undefined);
      assert.equal(await request('start', {}, { id: 'fixture', url: 'chrome-extension://fixture/popup.html' }), undefined);
    });
    await t.test('recording starts without uploading and has a hard time limit', async () => {
      assert.equal((await start()).ok, true); assert.equal(recorder.state, 'recording'); assert.equal(uploads, 0);
      assert.ok(timers.some(timer => timer.ms === 30000));
    });
    await t.test('finish releases audio, submits timestamped ASR and maps offsets', async () => {
      clock += 3000; snapshot.time += 3;
      assert.equal((await request('finish')).ok, true); await settle(); await settle();
      assert.equal(uploads, 1); assert.ok(stops > 0); assert.ok(closed > 0);
      const result = messages.findLast(m => m.type === 'capture-result');
      assert.equal(result.jobId, 'recording-fixture');
      assert.ok(messages.filter(m => m.type === 'capture-progress').every(m => m.jobId === 'recording-fixture'));
      assert.deepEqual(result.cues, [{ start: 100, end: 102, text: 'Hello.' }]);
    });
    await t.test('pause discards recorded audio without submitting it', async () => {
      assert.equal((await start()).ok, true); snapshot.paused = true;
      await intervals.at(-1)(); await settle();
      assert.equal(uploads, 1); assert.equal(recorder.state, 'inactive');
      assert.match(messages.findLast(m => m.type === 'capture-result').error, /Playback paused/);
    });
    await t.test('explicit cancel stops tracks and discards audio', async () => {
      snapshot.paused = false; assert.equal((await start()).ok, true);
      assert.equal((await request('cancel', { reason: 'Cancelled by user.' })).ok, true); await settle();
      assert.equal(uploads, 1); assert.match(messages.findLast(m => m.type === 'capture-result').error, /Cancelled by user/);
    });
    await t.test('cancellation while reporting transcription progress prevents an upload', async () => {
      const originalSend = chrome.runtime.sendMessage;
      chrome.runtime.sendMessage = async message => {
        const result = await originalSend(message);
        if (message.type === 'capture-progress' && message.status.startsWith('Transcribing')) {
          await request('cancel', { reason: 'Cancelled before upload.' });
        }
        return result;
      };
      try {
        assert.equal((await start()).ok, true);
        clock += 3000; snapshot.time += 3;
        await request('finish'); await settle(); await settle();
        assert.equal(uploads, 1);
        assert.equal(messages.findLast(m => m.type === 'capture-result').jobId, 'recording-fixture');
      } finally { chrome.runtime.sendMessage = originalSend; }
    });
  } finally {
    for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  }
});
