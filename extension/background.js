import { DEFAULTS, PROVIDERS, getPreferences, getProvider, requireProvider, sanitizePreferences } from './config.js';
import { translate, translateBatch } from './providers.js';
import { validateBatch, validateReferences, CONTEXT_CHARS } from './translation-batch.js';
import { cacheKey, cacheGet, cachePut, cacheClear, taskCacheKey } from './cache.js';
import { segmentSemantically, alignTranslation } from './semantic-provider.js';
import { benchmarkProvider } from './provider-benchmark.js';
import { SEMANTIC_VERSION, validateSemanticRequest, validateBoundaries, validateAlignment } from './semantic.js';
import { validateEndpoint } from './core.js';
import { ENGINE_IDS, AI_ENGINES } from './catalog.js';
import { audioURL, speechCacheKey } from './audio-media.js';
import { audioIdentity } from './speech-language.js';

// Content scripts cannot read chrome.storage.local; settings responses contain no secrets.
const ready = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
const jobs = new Map();
const translationEpochs = new Map();
const semanticEpochs = new Map();
let creatingOffscreen, startingCapture = false;
let benchmarking = false;
function ownPage(sender) {
  // Options opened in a tab legitimately has sender.tab. Authenticate its actual
  // extension URL instead; tab presence does not distinguish pages from scripts.
  if (sender.id !== chrome.runtime.id || (sender.frameId !== undefined && sender.frameId !== 0)) return false;
  try {
    const url = new URL(sender.url);
    return ['popup.html', 'options.html'].some(path => {
      const allowed = new URL(chrome.runtime.getURL(path));
      return url.protocol === allowed.protocol && url.host === allowed.host &&
        url.pathname === allowed.pathname && !url.username && !url.password;
    });
  } catch { return false; }
}
const offscreenSender = sender => sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL('offscreen.html');
const youtubeSender = sender => sender.id === chrome.runtime.id && sender.frameId === 0 && sender.tab && /^https:\/\/www\.youtube\.com\//.test(sender.url || '');
function watchVideoId(value) {
  try {
    const url = new URL(value);
    return url.origin === 'https://www.youtube.com' && url.pathname === '/watch' ? url.searchParams.get('v') : null;
  } catch { return null; }
}
async function requireCurrentVideo(sender, videoId) {
  // sender.url describes the sending document and can retain its original URL
  // across YouTube's pushState navigation (including Home -> watch).
  const tab = await chrome.tabs.get(sender.tab.id);
  if (typeof videoId !== 'string' || !videoId || watchVideoId(tab.url) !== videoId) throw new Error('Video changed.');
}
async function tellTab(tabId, message) {
  try { return await chrome.tabs.sendMessage(tabId, message); } catch { return undefined; }
}
async function captureState() { return (await chrome.storage.session.get('capture')).capture; }
async function stopCapture(reason = 'Recording cancelled.') {
  const state = await captureState();
  if (!state) return;
  if (state.kind === 'audio') await tellTab(state.tabId, { type: 'audio-sabr-cancel', videoId: state.videoId, jobId: state.id });
  await chrome.runtime.sendMessage({ target: 'offscreen', type: 'cancel', reason, jobId: state.id }).catch(() => {});
  if ((await captureState())?.id === state.id) await chrome.storage.session.remove('capture');
  await tellTab(state.tabId, { type: 'capture-status', videoId: state.videoId, status: reason, recording: false });
}
function cancelJobs(tabId, kind) {
  if (kind !== 'semantic') translationEpochs.set(tabId, (translationEpochs.get(tabId) || 0) + 1);
  if (kind !== 'translation') semanticEpochs.set(tabId, (semanticEpochs.get(tabId) || 0) + 1);
  for (const [id, job] of jobs) if (job.tabId === tabId && (!kind || (kind === 'semantic' ? job.kind === 'semantic' : job.kind !== 'semantic'))) {
    job.controller.abort(); jobs.delete(id);
  }
}
async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  if (!creatingOffscreen) creatingOffscreen = chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['USER_MEDIA', 'BLOBS'],
    justification: 'Prepare and transcribe explicitly requested video audio, or record a fallback clip.' }).finally(() => { creatingOffscreen = undefined; });
  await creatingOffscreen;
}
async function handle(m, sender) {
  await ready;
  const page = ownPage(sender), yt = youtubeSender(sender), offscreen = offscreenSender(sender);
  if (!page && !yt && !offscreen) throw new Error('Unsupported sender.');
  if (m.type === 'get-preferences' && (page || yt)) return { preferences: await getPreferences() };
  if (m.type === 'set-preferences' && (page || yt)) {
    const preferences = sanitizePreferences({ ...await getPreferences(), ...m.preferences });
    await chrome.storage.local.set({ preferences });
    return { preferences };
  }
  if (m.type === 'open-options' && (yt || page)) { await chrome.runtime.openOptionsPage(); return {}; }
  if (m.type === 'speech-readiness' && page) {
    try {
      const config = await requireProvider('asr');
      if (new URL(config.endpoint).hostname === 'api.openai.com' && !config.key.trim()) throw new Error('Add an API key for speech recognition. Translation credentials are configured separately.');
      return { ready: true, message: 'Speech provider configured. Audio is sent only when you explicitly start a task.' };
    } catch (error) { return { ready: false, message: error.message }; }
  }
  if (m.type === 'get-providers' && page) {
    const providers = {};
    for (const id of Object.keys(PROVIDERS)) providers[id] = await getProvider(id);
    return { providers };
  }
  if (m.type === 'save-provider' && page) {
    if (!PROVIDERS[m.id]) throw new Error('Unknown provider.');
    const endpoint = validateEndpoint(m.config.endpoint).href;
    if (m.id === 'mymemory' && endpoint !== PROVIDERS.mymemory.endpoint) throw new Error('MyMemory uses its official endpoint.');
    if (typeof m.config.key !== 'string' || m.config.key.length > 4096 || typeof m.config.model !== 'string' || m.config.model.length > 200) throw new Error('Invalid provider settings.');
    const { providers = {} } = await chrome.storage.local.get('providers');
    const region = typeof m.config.region === 'string' ? m.config.region.trim().slice(0, 80) : '';
    if (region && !/^[a-z0-9-]+$/.test(region)) throw new Error('Invalid Azure region.');
    providers[m.id] = { endpoint, key: m.config.key.trim(), model: m.config.model.trim(), region };
    await chrome.storage.local.set({ providers }); return {};
  }
  if (m.type === 'clear-cache' && page) { await cacheClear(); return {}; }
  if (m.type === 'test-provider' && page) {
    if (!ENGINE_IDS.includes(m.engine)) throw new Error('Unknown translation engine.');
    const config = await requireProvider(m.engine);
    return { text: await translate({ text: 'Hello, world.', source: 'en', target: 'es' }, m.engine, config, AbortSignal.timeout(25000)) };
  }
  if (m.type === 'benchmark-provider' && page) {
    if (benchmarking) throw new Error('A latency comparison request is already running.');
    if (!AI_ENGINES.includes(m.engine)) throw new Error('Choose the saved OpenAI provider.');
    benchmarking = true;
    try {
      const config = await requireProvider(m.engine);
      return { result: await benchmarkProvider(config, m.effort, AbortSignal.timeout(90000)) };
    } finally { benchmarking = false; }
  }
  if (['segment-subtitles', 'align-subtitle'].includes(m.type) && yt) {
    const semantic = m.type === 'segment-subtitles', epochs = semantic ? semanticEpochs : translationEpochs;
    const epoch = epochs.get(sender.tab.id) || 0;
    const prefs = await getPreferences();
    if (!prefs.enabled || !prefs.semanticSegmentation || !AI_ENGINES.includes(prefs.engine) || (!semantic && prefs.mode === 'original'))
      throw new Error('AI semantic subtitles are disabled. Select an AI provider and enable semantic sentences.');
    await requireCurrentVideo(sender, m.videoId);
    let input;
    if (semantic) {
      const { source, tokens, text, before, after, openLeft, final, commitEnd } = m.input || {};
      input = { source, tokens, text, before, after, openLeft, final, commitEnd }; validateSemanticRequest(input);
    } else {
      const { source, text, translation, parts } = m.input || {};
      if (typeof source !== 'string' || !/^(?:auto|[a-zA-Z]{2,3}(?:-[\w]{2,8})*)$/.test(source) ||
          typeof text !== 'string' || !text.trim() || text.length > 16000 || typeof translation !== 'string' || !translation.trim() || translation.length > 16000 ||
          !Array.isArray(parts) || parts.length < 2 || parts.length > 64 || parts.some(p => typeof p !== 'string' || !p.trim()) ||
          parts.join('').replace(/\s/gu, '') !== text.replace(/\s/gu, '')) throw new Error('Invalid subtitle alignment request.');
      input = { source, target: prefs.targetLanguage, text, translation, parts };
    }
    const config = await requireProvider(prefs.engine);
    await requireCurrentVideo(sender, m.videoId);
    if (epoch !== (epochs.get(sender.tab.id) || 0)) throw new Error('Request cancelled.');
    const kind = semantic ? 'semantic' : 'alignment';
    if ([...jobs.values()].some(j => j.tabId === sender.tab.id && j.kind === kind)) throw new Error('Subtitle processing queue is busy. Retry shortly.');
    const id = crypto.randomUUID(), controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(90000)]);
    jobs.set(id, { tabId: sender.tab.id, videoId: m.videoId, kind, controller });
    try {
      const key = await taskCacheKey(`${kind}-v${SEMANTIC_VERSION}`, input, prefs.engine, config);
      let result, cached = false;
      try {
        result = JSON.parse(await cacheGet(key));
        if (semantic) validateBoundaries(input, result); else validateAlignment(input.parts, result.groups);
        cached = true;
      } catch { result = undefined; }
      signal.throwIfAborted();
      if (!result) {
        result = semantic ? await segmentSemantically(input, config, signal) : await alignTranslation(input, config, signal);
        signal.throwIfAborted(); await requireCurrentVideo(sender, m.videoId);
        await cachePut(key, JSON.stringify(result)).catch(() => {});
      }
      signal.throwIfAborted(); await requireCurrentVideo(sender, m.videoId);
      return { result, cached };
    } finally { jobs.delete(id); }
  }
  if (m.type === 'cancel-semantic' && yt) { cancelJobs(sender.tab.id, 'semantic'); return {}; }
  if (m.type === 'translate-batch' && yt) {
    const epoch = translationEpochs.get(sender.tab.id) || 0;
    validateBatch(m.sentences);
    const prefs = await getPreferences();
    if (!prefs.enabled || prefs.mode === 'original' || !AI_ENGINES.includes(prefs.engine)) throw new Error('Batch translation is disabled.');
    await requireCurrentVideo(sender, m.videoId);
    if (typeof m.source !== 'string' || !/^[a-zA-Z]{2,3}(?:-[\w]{2,8})*$/.test(m.source)) throw new Error('Choose a source language for translation.');
    const config = await requireProvider(prefs.engine);
    await requireCurrentVideo(sender, m.videoId);
    if (epoch !== (translationEpochs.get(sender.tab.id) || 0)) throw new Error('Request cancelled.');
    if ([...jobs.values()].some(job => job.tabId === sender.tab.id && !job.kind)) throw new Error('Translation queue is busy. Retry shortly.');
    const id = crypto.randomUUID(), controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(90000)]);
    jobs.set(id, { tabId: sender.tab.id, videoId: m.videoId, controller });
    try {
      const before = String(m.before || '').slice(-CONTEXT_CHARS), after = String(m.after || '').slice(0, CONTEXT_CHARS);
      const references = validateReferences(m.references);
      const context = m.sentences.map(({ id, text }) => ({ id, text }));
      const entries = await Promise.all(m.sentences.map(async (sentence, i) => {
        const key = await cacheKey({ text: sentence.text, source: m.source, target: prefs.targetLanguage, batch: true,
          before, after, context: context.map(s => s.text), references }, prefs.engine, config);
        return { ...sentence, key, translation: await cacheGet(key).catch(() => undefined) };
      }));
      signal.throwIfAborted();
      const missing = entries.filter(s => !s.translation);
      if (missing.length) {
        const translated = await translateBatch({ source: m.source, target: prefs.targetLanguage, before, after, references,
          sentences: missing.map(({ id, text }) => ({ id, text })), context }, prefs.engine, config, signal);
        signal.throwIfAborted();
        for (const item of translated) {
          const entry = entries.find(s => s.id === item.id); entry.translation = item.translation;
          await cachePut(entry.key, item.translation).catch(() => {});
        }
      }
      signal.throwIfAborted();
      return { translations: entries.map(({ id, translation }) => ({ id, translation })), cached: missing.length === 0 };
    } finally { jobs.delete(id); }
  }
  if (m.type === 'translate' && yt) {
    const epoch = translationEpochs.get(sender.tab.id) || 0;
    const prefs = await getPreferences();
    if (!prefs.enabled || prefs.mode === 'original' || prefs.engine === 'none') throw new Error('Translation is disabled.');
    await requireCurrentVideo(sender, m.videoId);
    const input = { text: m.text, source: m.source, target: prefs.targetLanguage, before: String(m.before || '').slice(0, 1000), after: String(m.after || '').slice(0, 1000) };
    if (typeof input.source !== 'string' || !/^[a-zA-Z]{2,3}(?:-[\w]{2,8})*$/.test(input.source)) throw new Error('Choose a source language for translation.');
    const config = await requireProvider(prefs.engine), key = await cacheKey(input, prefs.engine, config);
    const cached = await cacheGet(key).catch(() => undefined);
    await requireCurrentVideo(sender, m.videoId);
    if (epoch !== (translationEpochs.get(sender.tab.id) || 0)) throw new Error('Request cancelled.');
    if (cached) return { text: cached, cached: true };
    if ([...jobs.values()].filter(j => j.tabId === sender.tab.id).length >= 2) throw new Error('Translation queue is busy. Retry shortly.');
    const id = crypto.randomUUID(), controller = new AbortController();
    jobs.set(id, { controller, tabId: sender.tab.id, videoId: m.videoId });
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(25000)]);
    try {
      const text = await translate(input, prefs.engine, config, signal);
      signal.throwIfAborted();
      await cachePut(key, text).catch(() => {});
      signal.throwIfAborted();
      return { text, cached: false };
    } finally { jobs.delete(id); }
  }
  if (m.type === 'cancel-translation' && yt) { cancelJobs(sender.tab.id, 'translation'); return {}; }
  if (m.type === 'speech-cached' && yt) {
    await requireCurrentVideo(sender, m.videoId);
    const prefs = await getPreferences(), config = await getProvider('asr');
    const probe = await tellTab(sender.tab.id, { type: 'audio-sabr-probe', videoId: m.videoId, language: prefs.sourceLanguage });
    const selected = probe?.ok && audioIdentity(probe) ? probe : (await tellTab(sender.tab.id, { type: 'audio-discover', language: prefs.sourceLanguage }))?.sources?.[0];
    const trackId = audioIdentity(selected);
    if (!trackId) return {};
    const key = await speechCacheKey(m.videoId, prefs.sourceLanguage, config, { start: 0, end: 'index' }, trackId);
    let saved; try { saved = JSON.parse(await cacheGet(key)); } catch { return {}; }
    if (saved?.trackId !== trackId) return {};
    return { cues: Object.values(saved?.chunks || {}).flatMap(c => c.cues).sort((a, b) => a.start - b.start), language: saved?.language, trackId };
  }
  if (['audio-start', 'audio-test'].includes(m.type) && page && sender.url === chrome.runtime.getURL('popup.html')) {
    if (startingCapture) throw new Error('Audio processing is already starting.');
    startingCapture = true;
    try {
      if (m.confirmed !== true) throw new Error('Explicit audio-processing consent is required.');
      if (await captureState()) throw new Error('An audio task is already running.');
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id !== m.tabId || !/^https:\/\/www\.youtube\.com\/watch\?/.test(tab?.url || '')) throw new Error('Open a YouTube watch page.');
      const prefs = await getPreferences(), snapshot = await tellTab(tab.id, { type: 'snapshot' });
      if (!prefs.enabled || !snapshot?.videoId || snapshot.ad || snapshot.protected || !(snapshot.duration > 0 && snapshot.duration <= 14400)) throw new Error('Enable subtitles and open an unprotected recorded video up to four hours, outside advertisements.');
      const probe = m.type === 'audio-test';
      const config = probe ? undefined : await requireProvider('asr');
      if (!probe && new URL(config.endpoint).hostname === 'api.openai.com' && !config.key.trim()) throw new Error('Configure a speech API key first.');
      const state = { id: crypto.randomUUID(), kind: 'audio', tabId: tab.id, videoId: snapshot.videoId, status: 'Finding video audio…',
        language: prefs.sourceLanguage, from: snapshot.time, scope: m.scope === 'full' ? 'full' : 'nearby', videoDuration: snapshot.duration, probe };
      await chrome.storage.session.set({ capture: state });
      await chrome.storage.session.remove('audioOutcome');
      try {
        const discovery = await tellTab(tab.id, { type: 'audio-discover', language: prefs.sourceLanguage });
        const sources = (Array.isArray(discovery?.sources) ? discovery.sources : []).slice(0, 2).filter(s => { try { audioURL(s.url); return true; } catch { return false; } });
        await ensureOffscreen();
        if ((await captureState())?.id !== state.id) throw new Error('Audio task cancelled.');
        const current = await tellTab(tab.id, { type: 'snapshot' });
        if (current?.videoId !== state.videoId) throw new Error('Video changed.');
        const result = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'start-audio', state, config, sources });
        if (!result?.ok) throw new Error(result?.error || 'Could not start audio processing.');
        return {};
      } catch (error) { await stopCapture(error.message); throw error; }
    } finally { startingCapture = false; }
  }
  if (['audio-sabr-probe', 'audio-sabr-chunk', 'audio-cues'].includes(m.type) && offscreen) {
    const state = await captureState();
    if (!state || state.kind !== 'audio' || state.id !== m.jobId || state.videoId !== m.videoId) throw new Error('Audio task is no longer active.');
    if (m.type === 'audio-cues') {
      const prefs = await getPreferences();
      if (prefs.sourceKind !== 'generated' && m.cues?.length) await chrome.storage.local.set({ preferences: { ...prefs, sourceKind: 'generated' } });
      await tellTab(state.tabId, { ...m, type: 'generated-cues', autoSelect: true }); return {};
    }
    if (m.type === 'audio-sabr-chunk' && (!Number.isFinite(m.start) || !Number.isFinite(m.end) || m.start < 0 || m.end <= m.start || m.end - m.start > 32.1 || m.end > state.videoDuration + 0.1)) throw new Error('Invalid audio interval.');
    const snapshot = await tellTab(state.tabId, { type: 'snapshot' });
    if (snapshot?.videoId !== state.videoId || snapshot.ad || snapshot.protected) throw new Error('Video changed or is unavailable.');
    const result = await tellTab(state.tabId, { type: m.type, videoId: state.videoId, jobId: state.id, language: state.language, start: m.start, end: m.end });
    if ((await captureState())?.id !== state.id) throw new Error('Audio task cancelled.');
    if (!result?.ok) throw new Error(result?.error || 'SABR bridge unavailable. Reload the YouTube page.');
    return result;
  }
  if (m.type === 'capture-state' && page) {
    const state = await captureState();
    if (state && !startingCapture && !(await chrome.offscreen.hasDocument())) {
      await chrome.storage.session.remove('capture');
      await tellTab(state.tabId, { type: 'capture-status', videoId: state.videoId, status: 'Audio capture ended unexpectedly. Start a new recording when ready.', recording: false });
      return {};
    }
    return { capture: state, outcome: (await chrome.storage.session.get('audioOutcome')).audioOutcome };
  }
  if (m.type === 'capture-start' && page && sender.url === chrome.runtime.getURL('popup.html')) {
    if (startingCapture) throw new Error('Audio capture is already starting.');
    startingCapture = true;
    try {
    if (m.confirmed !== true) throw new Error('Explicit audio-processing consent is required.');
    if (await captureState()) throw new Error('A recording or transcription is already in progress.');
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || tab.id !== m.tabId || !/^https:\/\/www\.youtube\.com\/watch\?/.test(tab.url || '')) throw new Error('Open a YouTube watch page in the active tab.');
    const prefs = await getPreferences();
    if (!prefs.enabled) throw new Error('Enable subtitles before recording.');
    const snapshot = await tellTab(tab.id, { type: 'snapshot' });
    if (!snapshot?.videoId || snapshot.paused || snapshot.ad || snapshot.rate !== 1 || !Number.isFinite(snapshot.duration)) throw new Error('Play a regular video at 1×, outside advertisements, before recording. Live streams are unsupported.');
    const config = await requireProvider('asr');
    if (new URL(config.endpoint).hostname === 'api.openai.com' && !config.key.trim()) throw new Error('Configure a speech API key in Providers → Speech recognition first.');
    const state = { id: crypto.randomUUID(), tabId: tab.id, videoId: snapshot.videoId, status: 'starting', duration: [15, 30, 60].includes(m.duration) ? m.duration : 30,
      language: prefs.sourceLanguage, started: Date.now() };
    // Persist the reservation before capture awaits, preventing double-click races.
    await chrome.storage.session.set({ capture: state });
    try {
      await ensureOffscreen();
      const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
      if ((await captureState())?.id !== state.id) throw new Error('Capture was cancelled before recording started.');
      const result = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'start', streamId, state, config });
      if (!result?.ok) throw new Error(result?.error || 'Could not start tab audio capture.');
      return {};
    } catch (e) { await stopCapture(e.message); throw e; }
    } finally { startingCapture = false; }
  }
  if (m.type === 'capture-finish' && page) {
    const result = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'finish' });
    if (!result?.ok) throw new Error(result?.error || 'No recording is active.'); return {};
  }
  if (m.type === 'capture-cancel' && (page || yt)) {
    const state = await captureState();
    if (page || state?.tabId === sender.tab.id) await stopCapture(yt ? 'Recording cancelled because playback or the video changed.' : 'Recording cancelled.');
    return {};
  }
  if (m.type === 'capture-snapshot' && offscreen) {
    const state = await captureState();
    return { snapshot: state ? await tellTab(state.tabId, { type: 'snapshot' }) : undefined };
  }
  if (m.type === 'capture-progress' && offscreen) {
    const state = await captureState();
    if (!state || state.videoId !== m.videoId || state.id !== m.jobId) return {};
    await chrome.storage.session.set({ capture: { ...state, status: m.status } });
    await tellTab(state.tabId, { type: 'capture-status', videoId: state.videoId, status: m.status, recording: m.status.startsWith('Recording') });
    return {};
  }
  if (m.type === 'capture-result' && offscreen) {
    const state = await captureState();
    if (!state || state.videoId !== m.videoId || state.id !== m.jobId) return {};
    if ((await captureState())?.id !== state.id) return {};
    await chrome.storage.session.remove('capture');
    if (state.kind === 'audio') {
      const status = m.error || (state.probe ? m.status || 'Browser audio test completed.' : 'Speech subtitles ready and cached.');
      await chrome.storage.session.set({ audioOutcome: { tabId: state.tabId, videoId: state.videoId, status } });
      await tellTab(state.tabId, { type: 'capture-status', videoId: m.videoId, status, recording: false }); return {};
    }
    await tellTab(state.tabId, { type: 'generated-cues', videoId: m.videoId, cues: m.cues, language: m.language, error: m.error }); return {};
  }
  throw new Error('Unsupported message.');
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target === 'offscreen') return false;
  handle(message || {}, sender).then(data => sendResponse({ ok: true, ...data }), error => sendResponse({ ok: false, error: error.name === 'AbortError' ? 'Request cancelled.' : error.message }));
  return true;
});
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local' || (!changes.preferences && !changes.providers)) return;
  const preferences = await getPreferences();
  const semanticChanged = !!changes.providers || (changes.preferences && ['enabled', 'sourceKind', 'sourceLanguage', 'engine', 'semanticSegmentation']
    .some(key => changes.preferences.oldValue?.[key] !== preferences[key]));
  const translationChanged = !!changes.providers || (changes.preferences && ['enabled', 'sourceKind', 'sourceLanguage', 'targetLanguage', 'engine', 'mode', 'semanticSegmentation']
    .some(key => changes.preferences.oldValue?.[key] !== preferences[key]));
  for (const tab of await chrome.tabs.query({ url: 'https://www.youtube.com/*' })) {
    if (semanticChanged) cancelJobs(tab.id);
    else if (translationChanged) cancelJobs(tab.id, 'translation');
    await tellTab(tab.id, { type: 'preferences-changed', preferences, providerChanged: !!changes.providers });
  }
  if (!preferences.enabled || changes.providers || (changes.preferences && changes.preferences.oldValue?.sourceLanguage !== preferences.sourceLanguage)) await stopCapture('Audio task cancelled because settings changed.');
});
chrome.tabs.onRemoved.addListener(async tabId => { cancelJobs(tabId); if ((await captureState())?.tabId === tabId) await stopCapture('Tab closed.'); });
chrome.tabs.onUpdated.addListener(async (tabId, change, tab) => {
  if (!change.url && change.status !== 'loading') return;
  // The content script may already be translating the new video before this
  // event arrives. Cancel only work for a different video, not the new job or
  // same-video URL changes such as playlist/timestamp parameters.
  const videoId = watchVideoId(change.url || tab?.url);
  for (const [id, job] of jobs) if (job.tabId === tabId && job.videoId !== videoId) {
    job.controller.abort(); jobs.delete(id);
  }
  const state = await captureState();
  if (state?.tabId === tabId && (change.status === 'loading' || videoId !== state.videoId)) await stopCapture('Video changed.');
});
