import { parseJson3, cleanText, reconstructSentences, sentenceIndex, navigationTarget, isTypingEvent } from './core.js';
import { ENGINE_LABELS, AI_ENGINES } from './catalog.js';
import { planTranslation, translationContext } from './translation-batch.js';
import { SemanticTimeline, displayGroups, validateAlignment } from './semantic.js';
import { sentenceIcon, appearanceMarkup, appearanceStyles, applyAppearance, bindAppearance } from './appearance.js';
const CHANNEL = 'sentence-youtube-v1';
let preferences, videoId = '', video, player, host, root, nativeStyle, playerButton, nativeCapture;
let observedWhileLoading = false;
const nativeAttempts = new Set();
let tracks = [], selectedTrack = '', timeline = [], generated = [], generatedLanguage = 'auto', sourceLanguage = 'en';
let generatedTrackId = '', observedAudioTrackId = '', restoringSpeech = false, lastSpeechRestore = 0;
let generation = { translations: new Map(), pending: new Set(), failed: new Set() };
let sourceCues = [], semantic, semanticReady = Promise.resolve(), semanticIdentity = '', displayHold, lastView;
let revision = 0, recording = false, loading = false, baseStatus = 'Looking for subtitle tracks…', lastRender = '', knownURL = '', discoveryRetries = 0;
const pendingBridge = new Map();
const languages = [['auto', 'Match video'], ['en', 'English'], ['es', 'Spanish'], ['zh', 'Chinese'], ['zh-TW', 'Chinese (Traditional)'], ['ja', 'Japanese'], ['ko', 'Korean'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'], ['pt', 'Portuguese'], ['pt-BR', 'Portuguese (Brazil)'], ['ar', 'Arabic'], ['hi', 'Hindi'], ['ru', 'Russian'], ['uk', 'Ukrainian'], ['vi', 'Vietnamese'], ['th', 'Thai'], ['id', 'Indonesian'], ['nl', 'Dutch'], ['pl', 'Polish'], ['tr', 'Turkish'], ['he', 'Hebrew']];
const rpc = async message => {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || 'Extension unavailable. Reload this page after updating the extension.');
  return response;
};
function bridge(type, data = {}) {
  const requestId = crypto.randomUUID(), id = videoId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pendingBridge.delete(requestId); reject(new Error('YouTube player did not respond. Refresh tracks or reload the page.')); }, type === 'audio-sabr-chunk' ? 65000 : 15000);
    pendingBridge.set(requestId, { resolve, reject, timer, videoId: id });
    window.postMessage({ channel: CHANNEL, direction: 'request', requestId, videoId: id, type, ...data }, location.origin);
  });
}
window.addEventListener('message', event => {
  const m = event.data;
  if (event.source !== window || event.origin !== location.origin || m?.channel !== CHANNEL) return;
  if (m.direction === 'audio-track-observed' && m.videoId === videoId && typeof m.trackId === 'string') {
    observedAudioTrackId = m.trackId;
    if (generatedTrackId && generatedTrackId !== m.trackId && !generatedTrackId.startsWith('[')) {
      generated = []; generatedTrackId = '';
      if (preferences?.sourceKind === 'generated') { useGenerated(); status('YouTube audio track changed. Generate speech subtitles for this track.'); }
      void rpc({ type: 'capture-cancel' }).catch(() => {});
    }
    if (!generated.length) void restoreSpeech();
    return;
  }
  if (m.direction === 'observed' && m.videoId === videoId && !timeline.length && selectedTrack) {
    if (loading) observedWhileLoading = true; else void loadTrack();
    return;
  }
  const request = pendingBridge.get(m.requestId);
  if (m.direction !== 'response' || !request || m.videoId !== request.videoId) return;
  clearTimeout(request.timer); pendingBridge.delete(m.requestId);
  if (m.error) request.reject(new Error(String(m.error).slice(0, 400))); else request.resolve(m);
});
function resetTranslations({ preserve = false, paused = false, full = false } = {}) {
  generation = { translations: preserve ? generation.translations : new Map(), alignments: preserve ? generation.alignments || new Map() : new Map(),
    pending: new Set(), alignmentPending: new Set(), alignmentFailed: new Set(), failed: new Set(), paused, full };
  lastRender = '';
  generation.ready = rpc({ type: 'cancel-translation' }).catch(() => {});
}
const semanticEnabled = () => preferences?.semanticSegmentation !== false && AI_ENGINES.includes(preferences?.engine);
function cancelSemantic() {
  if (semantic) { semantic.serial = (semantic.serial || 0) + 1; semantic.pending = false; }
  semanticReady = rpc({ type: 'cancel-semantic' }).catch(() => {});
}
const sentenceKey = s => JSON.stringify([s.start, s.end, s.text, !!s.semantic, s.parts?.map(p => [p.offsetStart, p.offsetEnd])]);
function replaceTimeline(next, preservePending = false) {
  const previous = generation;
  const ids = new Map(next.map(s => [sentenceKey(s), s.id]));
  const remap = new Map(timeline.map(s => [s.id, ids.get(sentenceKey(s))]));
  const mapValues = values => new Map([...(values || [])].filter(([id]) => remap.has(id) && remap.get(id) !== undefined).map(([id, value]) => [remap.get(id), value]));
  const mapIds = values => new Set([...(values || [])].map(id => remap.get(id)).filter(id => id !== undefined));
  const keep = preservePending && [...previous.pending, ...(previous.alignmentPending || [])].every(id => remap.get(id) !== undefined);
  // IDs are positional and can shift when a gap before a pending request is
  // resolved. Keep the request if its exact sentences survive; remap its result.
  const translations = mapValues(previous.translations), alignments = mapValues(previous.alignments);
  const pending = mapIds(previous.pending), alignmentPending = mapIds(previous.alignmentPending);
  const failed = mapIds(previous.failed), alignmentFailed = mapIds(previous.alignmentFailed);
  if (!displayHold && lastView && video && !video.paused && video.currentTime >= lastView.start && video.currentTime < lastView.end) displayHold = lastView;
  timeline = next;
  if (!keep) resetTranslations({ paused: previous.paused, full: previous.full });
  else { generation.pending = pending; generation.alignmentPending = alignmentPending; lastRender = ''; }
  generation.warm = previous.warm; generation.blocked = previous.blocked;
  generation.translations = translations; generation.alignments = alignments;
  generation.failed = failed; generation.alignmentFailed = alignmentFailed;
}
function installSource(cues, preserve = false) {
  sourceCues = cues;
  const prior = semantic, identity = `${videoId}|${preferences.sourceKind}|${selectedTrack}|${sourceLanguage}|${preferences.engine}`;
  const sameSource = semanticIdentity === identity;
  if (!preserve || semanticIdentity !== identity) displayHold = lastView = undefined;
  cancelSemantic();
  semantic = semanticEnabled() ? new SemanticTimeline(cues, sourceLanguage) : undefined;
  if (semantic && preserve && prior && semanticIdentity === identity) {
    let same = 0;
    const a = prior.source.tokens, b = semantic.source.tokens;
    while (same < Math.min(a.length, b.length) && a[same].text === b[same].text && a[same].start === b[same].start && a[same].end === b[same].end) same++;
    // Appended ASR can complete the formerly final utterance. Revisit its boundary.
    const reusable = same === a.length && same === b.length ? prior.sentences : prior.sentences.filter(s => s.end <= (a.at(-1)?.end || 0) - 15);
    semantic.sentences = reusable.filter(s => s.to < same);
    semantic.full = prior.full; semantic.paused = prior.paused;
  }
  semanticIdentity = identity;
  replaceTimeline(semantic ? semantic.timeline() : reconstructSentences(cues, { language: sourceLanguage }), preserve && sameSource);
}
async function prepareSemantic(session, request) {
  session.pending = true;
  const serial = session.serial || 0, id = videoId;
  session.request = request;
  const active = () => semantic === session && serial === (session.serial || 0) && videoId === id;
  try {
    await semanticReady;
    if (!active()) return;
    const response = await rpc({ type: 'segment-subtitles', videoId: id, input: request });
    if (!active()) return;
    if (session.accept(request, response.result)) replaceTimeline(session.timeline(), true);
  } catch (error) {
    if (active()) { session.blocked = true; session.error = error.message; if (root) root.getElementById('retry').hidden = false; }
  } finally { if (active()) { session.pending = false; session.request = undefined; } }
}
async function prepareAlignment(sentence, group) {
  if (group.alignmentPending.size) return;
  group.alignmentPending.add(sentence.id);
  const id = videoId, key = sentenceKey(sentence);
  const input = { source: sourceLanguage, text: sentence.text,
    translation: group.translations.get(sentence.id), parts: sentence.parts.map(p => p.text) };
  try {
    await group.ready;
    if (group !== generation) return;
    const response = await rpc({ type: 'align-subtitle', videoId: id, input });
    if (group !== generation || id !== videoId) return;
    const current = timeline.find(s => sentenceKey(s) === key);
    if (current) group.alignments.set(current.id, validateAlignment(sentence.parts, response.result?.groups));
  } catch (error) {
    if (group === generation) {
      const current = timeline.find(s => sentenceKey(s) === key);
      if (current) group.alignmentFailed.add(current.id);
      status(`Bilingual alignment: ${error.message}`);
      if (root) root.getElementById('retry').hidden = false;
    }
  } finally { group.alignmentPending.clear(); }
}
function fitsSubtitles(original, translated = '') {
  const width = root?.getElementById('subtitles').getBoundingClientRect().width || (player?.getBoundingClientRect().width || 1000) * 0.88;
  const size = preferences.fontSize;
  // Width is a reading target, never a new sentence boundary. Full-width scripts
  // and Latin text get different estimates; resizing recomputes clause grouping.
  const units = text => [...text].reduce((n, c) => n + (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(c) ? 1 : 0.58), 0);
  return units(original) * size <= (width - 24) * 2 && units(translated) * size * preferences.translationScale <= (width - 24) * 2;
}
function status(text) {
  baseStatus = text;
  if (root) root.querySelector('#status').textContent = text;
}
function option(value, label) { const o = document.createElement('option'); o.value = value; o.textContent = label; return o; }
function applyControls() {
  if (!root || !preferences) return;
  for (const id of ['mode', 'sourceKind', 'targetLanguage', 'engine']) root.getElementById(id).value = preferences[id];
  root.getElementById('enabled').checked = preferences.enabled;
  root.getElementById('shortcuts').checked = preferences.shortcuts;
  root.getElementById('semanticSegmentation').checked = preferences.semanticSegmentation !== false;
  root.getElementById('speech-help').hidden = preferences.sourceKind !== 'generated';
  const source = root.getElementById('sourceLanguage');
  const choices = new Map(languages);
  for (const track of tracks) if (!choices.has(track.language)) choices.set(track.language, track.label);
  if (!choices.has(preferences.sourceLanguage)) choices.set(preferences.sourceLanguage, preferences.sourceLanguage);
  source.replaceChildren(...[...choices].map(([value, label]) => option(value, label)));
  source.value = preferences.sourceLanguage;
  const target = root.getElementById('targetLanguage');
  if (![...target.options].some(o => o.value === preferences.targetLanguage)) target.add(option(preferences.targetLanguage, preferences.targetLanguage));
  target.value = preferences.targetLanguage;
  host.style.setProperty('--sentence-font-size', `${preferences.fontSize}px`);
  root.getElementById('toggle').style.opacity = preferences.enabled ? '1' : '.55';
  if (playerButton) playerButton.style.opacity = preferences.enabled ? '1' : '.55';
  applyAppearance(host, root, preferences);
  root.getElementById('status').textContent = baseStatus;
}
function mount() {
  const nextPlayer = document.getElementById('movie_player'), nextVideo = nextPlayer?.querySelector('video');
  if (!nextPlayer || !nextVideo) return;
  if (player === nextPlayer && host?.isConnected) { video = nextVideo; mountPlayerButton(); return; }
  cleanupUI(); player = nextPlayer; video = nextVideo;
  host = document.createElement('div'); host.id = 'sentence-extension';
  host.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:60;';
  root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
    :host{font-family:system-ui,-apple-system,Segoe UI,sans-serif;color-scheme:dark;color:#f4f5f7;font-size:13px;text-align:left;line-height:1.4;--sentence-font-size:24px}
    *{box-sizing:border-box} [hidden]{display:none!important} button,select,input{font:inherit} button,select{color:inherit;background:#252933;border:1px solid #464c5b;border-radius:7px;padding:6px 9px} button{cursor:pointer} button:hover{background:#363e4e} button:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid #80d6c2;outline-offset:2px} button:disabled{opacity:.45;cursor:default}
    #toggle{position:absolute;top:12px;left:12px;pointer-events:auto;background:#131922df;font-weight:700;letter-spacing:.06em;opacity:.85;z-index:3}
    #panel{position:absolute;right:12px;bottom:60px;width:300px;max-width:calc(100% - 24px);max-height:calc(100% - 80px);overflow:auto;pointer-events:auto;background:#151a24fa;border:1px solid #434c5d;border-radius:12px;padding:15px;box-shadow:0 8px 30px #0008;z-index:2}
    header{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px} strong{font-size:15px} .eyebrow{font-size:10px;letter-spacing:.14em;color:#80d6c2;text-transform:uppercase} .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px} label{display:flex;flex-direction:column;gap:4px;color:#c4cbd8;font-size:11px} select{width:100%;min-width:0;font-size:12px} .check{display:flex;flex-direction:row;align-items:center;font-size:12px;margin:8px 0} input[type=checkbox]{accent-color:#80d6c2} .wide{grid-column:1/-1} .row{display:flex;gap:6px;align-items:center;margin-top:12px} .row button{flex:1} #status{font-size:11px;color:#b8c7d6;margin:12px 0 0;overflow-wrap:anywhere} #capture{color:#ffcd83;font-size:11px}
    #subtitles{position:absolute;left:6%;right:6%;bottom:65px;display:flex;flex-direction:column;align-items:center;gap:4px;pointer-events:none;text-align:center;font-size:var(--sentence-font-size);line-height:1.4;font-weight:550;text-shadow:0 1px 3px #000}
    #subtitles div{white-space:pre-wrap;overflow-wrap:anywhere;max-width:100%;padding:3px 12px;border-radius:5px;background:#080b10de;box-decoration-break:clone} #translated{color:#9bead8} #original{color:#fff}
    #subtitles:empty{display:none} #credit{font-size:10px;color:#8491a5;margin-top:9px} #close{padding:2px 7px}
    @media(max-height:420px){#panel{top:45px;max-height:calc(100% - 65px)}#subtitles{bottom:45px;font-size:18px}}
    ${appearanceStyles}
  </style>
  <button id="toggle" aria-label="Versevia subtitle settings" aria-expanded="false">${sentenceIcon}</button>
  <section id="panel" aria-label="Versevia settings" hidden>
    <header><div class="brand">${sentenceIcon}<div><div class="eyebrow">Two languages. One thought.</div><strong>Versevia</strong></div></div><button id="close" aria-label="Close settings">×</button></header>
    <nav class="tabs" aria-label="Settings tabs"><button id="reading-tab" role="tab" aria-selected="true">Subtitles</button><button id="appearance-tab" role="tab" aria-selected="false">Appearance</button></nav>
    <div id="reading-settings"><label class="check"><input id="enabled" type="checkbox"> Enable subtitle overlay</label>
    <div class="grid">
      <label>Subtitle source<select id="sourceKind"><option value="auto">Best available track</option><option value="creator">Creator subtitles</option><option value="automatic">YouTube automatic</option><option value="generated">Generated speech</option></select></label>
      <label>Source language<select id="sourceLanguage"></select></label>
      <label class="wide">Available track<select id="track"></select></label>
      <label>Translation engine<select id="engine"><option value="none">Not connected</option><option value="mymemory">MyMemory · MT</option><option value="google">Google Translate · API</option><option value="deepl">DeepL · API</option><option value="libre">LibreTranslate · MT</option><option value="ai">Custom AI</option></select></label>
      <label>Target language<select id="targetLanguage"></select></label>
      <label class="wide">Display<select id="mode"><option value="bilingual">Original + translation</option><option value="original">Original only</option><option value="translation">Translation only</option></select></label>
    </div>
    <label class="check"><input id="semanticSegmentation" type="checkbox"> AI semantic sentences · uses selected AI provider</label>
    <p id="semantic-progress" role="status" aria-live="polite"></p>
    <label class="check"><input id="shortcuts" type="checkbox"> ← / → previous / next sentence</label>
    <div class="row"><button id="previous" title="Previous sentence">← Sentence</button><button id="next" title="Next sentence">Sentence →</button></div>
    <div class="row"><button id="slower" aria-label="Decrease playback speed">−</button><button id="rate" title="Reset speed to 1×">1×</button><button id="faster" aria-label="Increase playback speed">+</button></div>
    <div class="row"><button id="refresh">Refresh tracks</button><button id="providers">Providers</button></div>
    <div class="row"><button id="translate-all" title="Translate all loaded subtitles; provider charges may apply">Translate whole video</button><button id="stop-translation">Stop translation</button></div>
    <p id="translation-progress" role="status" aria-live="polite"></p>
    <button id="retry" class="wide" hidden>Retry subtitle processing</button></div>
    <div class="speech-help" id="speech-help" hidden>No CC needed. Open the Versevia toolbar button, connect a speech service, then choose Generate from video audio. You can keep using the player while subtitles are prepared.</div>
    ${appearanceMarkup}
    <p id="status" role="status"></p><p id="capture" role="status"></p>
    <div id="credit">Generate speech subtitles from the extension toolbar button.</div>
  </section><div id="subtitle-frame"><button id="move-handle" class="layout-handle" aria-label="Drag to move subtitles">✥ Move</button><button id="done-layout" class="layout-handle">Done</button><button id="resize-handle" class="layout-handle" aria-label="Drag to resize subtitles">↘ Size</button><button id="ratio-handle" class="layout-handle" aria-label="Drag to adjust translation size ratio">↕ Ratio</button><div id="subtitles" aria-label="Bilingual subtitles"><div id="original" dir="auto" hidden></div><div id="translated" dir="auto" hidden></div></div></div>`;
  root.getElementById('engine').replaceChildren(option('none', 'Not connected'), ...Object.entries(ENGINE_LABELS).map(([id, label]) => option(id, label)));
  bindAppearance({ host, root, player, getPreferences: () => preferences,
    preview: patch => { preferences = { ...preferences, ...patch }; applyAppearance(host, root, preferences); },
    save: patch => { void rpc({ type: 'set-preferences', preferences: patch }).catch(error => status(error.message)); } });
  root.getElementById('targetLanguage').replaceChildren(...languages.filter(([code]) => code !== 'auto').map(([value, label]) => option(value, label)));
  const panel = root.getElementById('panel'), toggle = root.getElementById('toggle');
  toggle.onclick = () => setPanelOpen(panel.hidden);
  root.getElementById('close').onclick = () => { setPanelOpen(false); (playerButton || toggle).focus(); };
  for (const type of ['click', 'dblclick', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'keydown', 'keyup']) root.addEventListener(type, event => {
    event.stopPropagation();
    if (type === 'keydown' && event.key === 'Escape') { setPanelOpen(false); (playerButton || toggle).focus(); }
  });
  for (const id of ['enabled', 'mode', 'sourceKind', 'sourceLanguage', 'targetLanguage', 'engine', 'shortcuts', 'semanticSegmentation']) root.getElementById(id).onchange = async event => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    try { await rpc({ type: 'set-preferences', preferences: { [id]: value } }); }
    catch (error) { status(error.message); }
  };
  root.getElementById('track').onchange = event => { selectedTrack = event.target.value; void loadTrack(); };
  root.getElementById('refresh').onclick = () => { nativeAttempts.clear(); void discover(); };
  root.getElementById('providers').onclick = () => { void rpc({ type: 'open-options' }); };
  root.getElementById('previous').onclick = () => jump(-1);
  root.getElementById('next').onclick = () => jump(1);
  root.getElementById('slower').onclick = () => changeRate(-0.25);
  root.getElementById('faster').onclick = () => changeRate(0.25);
  root.getElementById('rate').onclick = () => { if (video) video.playbackRate = 1; };
  root.getElementById('retry').onclick = () => {
    if (semantic) { cancelSemantic(); semantic.blocked = false; semantic.paused = false; semantic.error = ''; semantic.expansions.clear(); }
    resetTranslations({ preserve: true, full: generation.full }); root.getElementById('retry').hidden = true; status(`${timeline.length} subtitle segments ready.`); render();
  };
  root.getElementById('translate-all').onclick = () => {
    if (semantic) { semantic.full = true; semantic.paused = false; semantic.blocked = false; semantic.error = ''; semantic.expansions.clear(); }
    resetTranslations({ preserve: true, full: true }); root.getElementById('retry').hidden = true; render();
  };
  root.getElementById('stop-translation').onclick = () => {
    const paused = !generation.paused;
    if (semantic) { semantic.paused = paused; if (paused) cancelSemantic(); }
    resetTranslations({ preserve: true, full: generation.full, paused }); root.getElementById('retry').hidden = true; render();
  };
  player.append(host);
  mountPlayerButton();
  nativeStyle = document.createElement('style');
  nativeStyle.textContent = '#movie_player.sentence-native-hidden .ytp-caption-window-container { visibility: hidden !important; }';
  document.documentElement.append(nativeStyle);
  applyControls(); updateTrackOptions();
}
function cleanupUI() {
  finishNativeCapture();
  player?.classList.remove('sentence-native-hidden');
  playerButton?.remove(); playerButton = undefined;
  host?.remove(); nativeStyle?.remove(); host = root = nativeStyle = undefined; lastRender = ''; displayHold = lastView = undefined;
}
function setPanelOpen(open) {
  root.getElementById('panel').hidden = !open;
  root.getElementById('toggle').setAttribute('aria-expanded', String(open));
  playerButton?.setAttribute('aria-expanded', String(open));
}
function mountPlayerButton() {
  const controls = player?.querySelector('.ytp-right-controls');
  if (!controls || !root) { if (root) root.getElementById('toggle').hidden = false; return; }
  if (!playerButton?.isConnected) {
    playerButton = document.createElement('button');
    playerButton.id = 'sentence-player-button'; playerButton.className = 'ytp-button'; playerButton.type = 'button';
    playerButton.title = 'Versevia · bilingual subtitles';
    playerButton.setAttribute('aria-label', 'Versevia subtitle settings');
    playerButton.setAttribute('aria-expanded', String(!root.getElementById('panel').hidden));
    playerButton.style.cssText = 'width:48px;height:100%;padding:0;margin:0;display:inline-flex;align-items:center;justify-content:center;vertical-align:top;pointer-events:auto;position:relative;top:0;transform:none;float:left;';
    playerButton.innerHTML = sentenceIcon;
    playerButton.firstElementChild.style.pointerEvents = 'none';
    for (const type of ['click', 'dblclick', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'keydown', 'keyup']) playerButton.addEventListener(type, event => {
      event.stopPropagation();
      if (type === 'click') setPanelOpen(root.getElementById('panel').hidden);
      if (type === 'keydown' && event.key === 'Escape') setPanelOpen(false);
    });
    controls.prepend(playerButton);
  }
  root.getElementById('toggle').hidden = true;
}
function finishNativeCapture() {
  const capture = nativeCapture; nativeCapture = undefined;
  if (!capture) return;
  clearTimeout(capture.timer);
  capture.button.removeEventListener('click', capture.onUserClick, true);
  if (capture.button.isConnected && capture.button.getAttribute('aria-pressed') === 'true' && !capture.wasOn) capture.button.click();
}
function requestNativeCaptions(track) {
  if (nativeAttempts.has(track.id) || !preferences.enabled || player?.classList.contains('ad-showing')) return;
  const button = player?.querySelector('.ytp-subtitles-button');
  if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return;
  finishNativeCapture(); nativeAttempts.add(track.id);
  const wasOn = button.getAttribute('aria-pressed') === 'true';
  const capture = { button, wasOn, onUserClick: event => {
    if (event.isTrusted) { clearTimeout(capture.timer); button.removeEventListener('click', capture.onUserClick, true); nativeCapture = undefined; }
  } };
  nativeCapture = capture;
  button.addEventListener('click', capture.onUserClick, true);
  status('Loading captions through YouTube CC…');
  // Let the real player supply its authorized caption request, including session tokens.
  // If CC was already on, a brief toggle asks it to load again; playback is untouched.
  if (wasOn) button.click();
  button.click();
  void bridge('select-track', { trackId: track.id }).catch(() => {});
  capture.timer = setTimeout(() => {
    if (nativeCapture !== capture) return;
    finishNativeCapture();
    if (!timeline.length) status('YouTube did not supply this track. Turn on CC, choose the matching language in YouTube settings, then Refresh tracks. Native subtitles remain available.');
  }, 15000);
}
function eligibleTracks() {
  return tracks.filter(t => (preferences.sourceLanguage === 'auto' || t.language === preferences.sourceLanguage) &&
    (preferences.sourceKind === 'auto' || t.kind === preferences.sourceKind));
}
function updateTrackOptions() {
  if (!root) return;
  const select = root.getElementById('track');
  if (preferences.sourceKind === 'generated') {
    select.replaceChildren(option('generated', generated.length ? `Generated speech · ${generated.length} cues` : 'Not generated — use toolbar button'));
    select.disabled = true; return;
  }
  const available = eligibleTracks();
  select.replaceChildren(...(available.length ? available.map(t => option(t.id, `${t.label} · ${t.kind === 'creator' ? 'Creator' : 'YouTube automatic'}`)) : [option('', 'No matching subtitles available')]));
  select.value = selectedTrack; select.disabled = !available.length;
}
function parseCaptions(body) {
  if (typeof body !== 'string' || body.length > 5000000) throw new Error('Invalid caption response.');
  if (body.trim().startsWith('{')) return parseJson3(JSON.parse(body));
  const doc = new DOMParser().parseFromString(body, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error('YouTube returned an unsupported caption format.');
  const legacy = [...doc.querySelectorAll('text[start]')].map(node => ({ start: Number(node.getAttribute('start')), end: Number(node.getAttribute('start')) + Number(node.getAttribute('dur')), text: node.textContent }));
  if (legacy.length) return legacy;
  return [...doc.querySelectorAll('p[t]')].map(node => ({ start: Number(node.getAttribute('t')) / 1000,
    end: (Number(node.getAttribute('t')) + Number(node.getAttribute('d'))) / 1000, text: node.textContent }));
}
async function discover() {
  if (!videoId || !preferences.enabled) return;
  const id = videoId, rev = ++revision;
  status('Discovering YouTube subtitle tracks…');
  try {
    const result = await bridge('discover');
    if (id !== videoId || rev !== revision) return;
    tracks = Array.isArray(result.tracks) ? result.tracks.filter(t => typeof t.id === 'string' && typeof t.language === 'string' && ['creator', 'automatic'].includes(t.kind)).slice(0, 200) : [];
    applyControls();
    const defaultLanguage = tracks.find(t => t.isDefault)?.language || navigator.language.split('-')[0];
    const rank = t => (t.language === defaultLanguage ? 0 : 10) + (t.kind === 'creator' ? 0 : 1);
    const available = eligibleTracks().sort((a, b) => rank(a) - rank(b));
    if (!available.some(t => t.id === selectedTrack)) selectedTrack = available[0]?.id || '';
    updateTrackOptions();
    if (preferences.sourceKind === 'generated') { useGenerated(); return; }
    if (!selectedTrack) {
      installSource([]); resetTranslations();
      status(!result.ready ? 'Waiting for YouTube player. Use Refresh tracks once the video starts.' : tracks.length ? 'No track matches this source and language. Choose another source or Match video.' : 'No subtitles were exposed by YouTube. Try native CC and Refresh tracks, or explicitly generate speech subtitles.');
      if ((!result.ready || !tracks.length) && discoveryRetries++ < 6) setTimeout(() => { if (id === videoId && preferences.enabled && !selectedTrack) void discover(); }, 1500);
      return;
    }
    await loadTrack();
  } catch (error) { if (id === videoId && rev === revision) status(error.message); }
}
async function loadTrack() {
  const id = videoId, track = tracks.find(t => t.id === selectedTrack), rev = ++revision;
  if (!track || !preferences.enabled || preferences.sourceKind === 'generated') return;
  installSource([]); resetTranslations(); loading = true; observedWhileLoading = false;
  status(`Loading ${track.label} · ${track.kind === 'creator' ? 'creator subtitles' : 'YouTube automatic captions'}…`);
  try {
    const result = await bridge('captions', { trackId: track.id });
    if (id !== videoId || rev !== revision) return;
    const cues = parseCaptions(result.body);
    sourceLanguage = track.language; installSource(cues);
    if (!timeline.length) throw new Error('This track returned no timed captions. Enable native CC and refresh tracks.');
    finishNativeCapture();
    status(`${timeline.length} sentences · ${track.label} · ${track.kind === 'creator' ? 'Creator' : 'YouTube automatic'}${preferences.engine === 'none' ? '. Connect a provider for translation.' : ''}`);
  } catch (error) { if (id === videoId && rev === revision) { status(error.message); if (!observedWhileLoading) requestNativeCaptions(track); } }
  finally { if (rev === revision) { loading = false; if (observedWhileLoading && !timeline.length) void loadTrack(); } }
}
function useGenerated() {
  finishNativeCapture();
  sourceLanguage = preferences.sourceLanguage === 'auto' ? generatedLanguage : preferences.sourceLanguage;
  ++revision; loading = false; installSource(generated, true);
  status(timeline.length ? `${timeline.length} generated sentences available.` : 'No speech subtitles generated for this video. Open the toolbar button and choose Generate from video audio.');
  updateTrackOptions();
}
function jump(direction) {
  if (!preferences?.enabled || !video || player?.classList.contains('ad-showing')) return;
  const navigation = semantic ? semantic.sentences : timeline;
  const target = navigationTarget(navigation, video.currentTime, direction);
  if (target !== null) video.currentTime = target + 0.005;
}
function changeRate(delta) { if (video) video.playbackRate = Math.max(0.25, Math.min(3, Math.round((video.playbackRate + delta) * 100) / 100)); }
// Capture at window/document_start so YouTube's bubble handlers cannot seek a second time.
window.addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key) || !preferences?.enabled || !preferences.shortcuts || !timeline.length ||
    event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing || isTypingEvent(event) || player?.classList.contains('ad-showing')) return;
  event.preventDefault(); event.stopImmediatePropagation();
  if (!event.repeat) jump(event.key === 'ArrowRight' ? 1 : -1);
}, true);
async function translateSentences(items, group) {
  if (!items.length || group.pending.size) return;
  const keys = new Map(items.map(item => [item.id, sentenceKey(timeline[item.id])]));
  for (const item of items) group.pending.add(item.id);
  const batch = AI_ENGINES.includes(preferences.engine);
  const request = { type: batch ? 'translate-batch' : 'translate', videoId, source: sourceLanguage,
    ...translationContext(timeline, items, generation.translations),
    ...(batch ? { sentences: items } : { text: items[0].text }) };
  try {
    await group.ready;
    if (generation !== group) return;
    const result = await rpc(request);
    if (generation === group) {
      const translations = batch ? result.translations : [{ id: items[0].id, translation: result.text }];
      if (!Array.isArray(translations) || translations.length !== items.length || new Set(translations.map(s => s.id)).size !== items.length ||
          translations.some(s => !keys.has(s.id) || typeof s.translation !== 'string' || !s.translation.trim())) throw new Error('Invalid translation results.');
      const ids = new Map(timeline.map(s => [sentenceKey(s), s.id]));
      for (const item of translations) {
        const id = ids.get(keys.get(item.id));
        if (id !== undefined) group.translations.set(id, item.translation);
      }
      group.warm = true;
    }
  } catch (error) {
    if (generation === group) {
      for (const id of group.pending) group.failed.add(id);
      // Stop automatic retries after an error, avoiding repeated charges/quota failures.
      group.blocked = true;
      status(`${error.message} Original subtitles remain available.`);
      if (root) root.getElementById('retry').hidden = false;
    }
  } finally { group.pending.clear(); }
}
function render() {
  if (!root || !video || !preferences) return;
  const ad = player.classList.contains('ad-showing');
  const enabled = preferences.enabled && !ad;
  const index = enabled ? sentenceIndex(timeline, video.currentTime) : -1;
  const current = timeline[index];
  const fullTranslation = current && preferences.mode !== 'original' ? generation.translations.get(index) || '' : '';
  const alignment = generation.alignments?.get(index);
  const needsAlignment = current?.parts?.length > 1 && fullTranslation && !fitsSubtitles(current.text, fullTranslation);
  const displayTranslation = needsAlignment && !alignment ? '' : fullTranslation;
  const pieces = current ? displayGroups(current, displayTranslation, alignment, fitsSubtitles) : [];
  const piece = pieces.find(p => video.currentTime >= p.start && video.currentTime < p.end);
  let translated = piece?.translation || '';
  let original = piece && (preferences.mode !== 'translation' || !translated) ? piece.text : '';
  if (displayHold && enabled && video.currentTime >= displayHold.start && video.currentTime < displayHold.end) {
    ({ original, translated } = displayHold);
  } else { displayHold = undefined; }
  lastView = piece ? { original, translated, start: piece.start, end: piece.end } : undefined;
  const renderKey = JSON.stringify([original, translated, enabled]);
  if (lastRender !== renderKey) {
    for (const [id, text] of [['original', original], ['translated', translated]]) { const element = root.getElementById(id); element.textContent = text; element.hidden = !text; }
    lastRender = renderKey;
  }
  player.classList.toggle('sentence-native-hidden', enabled && timeline.length > 0);
  root.getElementById('rate').textContent = `${video.playbackRate}×`;
  const navigation = semantic ? semantic.sentences : timeline;
  root.getElementById('previous').disabled = !enabled || navigationTarget(navigation, video.currentTime, -1) === null;
  root.getElementById('next').disabled = !enabled || navigationTarget(navigation, video.currentTime, 1) === null;
  const canTranslate = enabled && preferences.mode !== 'original' && preferences.engine !== 'none' && timeline.length > 0;
  const canProcess = enabled && timeline.length > 0 && (canTranslate || !!semantic);
  const complete = generation.translations.size === timeline.length && (!semantic || semantic.complete) && !generation.alignmentPending.size && (!needsAlignment || !!alignment);
  root.getElementById('translate-all').disabled = !canProcess || (generation.full && !generation.blocked && !semantic?.blocked) || complete;
  root.getElementById('stop-translation').disabled = !canProcess || complete;
  const stopLabel = generation.paused ? 'Resume nearby' : 'Stop translation';
  if (root.getElementById('stop-translation').textContent !== stopLabel) root.getElementById('stop-translation').textContent = stopLabel;
  const state = generation.blocked ? 'Failed — retry to continue' : generation.paused ? 'Stopped' : complete ? 'Complete' : generation.full ? 'Whole video' : 'Nearby';
  const progress = timeline.length ? `${state} · ${generation.translations.size} / ${timeline.length} loaded sentences translated` : '';
  if (root.getElementById('translation-progress').textContent !== progress) root.getElementById('translation-progress').textContent = progress;
  const semanticStatus = semantic ? semantic.blocked ? `Semantic segmentation failed: ${semantic.error}` :
    `${semantic.paused ? 'Stopped' : semantic.complete ? 'Semantic sentences ready' : semantic.pending ? 'Finding semantic sentence boundaries…' : 'Semantic sentences · nearby'} · ${semantic.sentences.length} confirmed${current && !current.semantic ? ' · showing temporary source captions' : ''}${needsAlignment && !alignment ? ' · aligning bilingual clauses' : ''}` :
    preferences.semanticSegmentation === false ? 'Rule-based display segments · semantic sentences off' : 'Select an AI provider for semantic sentences. Showing rule-based segments.';
  if (root.getElementById('semantic-progress').textContent !== semanticStatus) root.getElementById('semantic-progress').textContent = semanticStatus;
  if (enabled && semantic) {
    try { const request = semantic.plan(video.currentTime); if (request) void prepareSemantic(semantic, request); }
    catch (error) { semantic.blocked = true; semantic.error = error.message; root.getElementById('retry').hidden = false; }
  }
  if (canTranslate && !generation.paused && needsAlignment && !alignment && !generation.alignmentFailed.has(index)) void prepareAlignment(current, generation);
  if (canTranslate && !generation.blocked && !generation.paused && !generation.pending.size) {
    const next = index >= 0 ? index : timeline.findIndex(s => s.start > video.currentTime);
    const items = planTranslation(timeline, next, generation.translations, { full: generation.full, warm: generation.warm, batch: AI_ENGINES.includes(preferences.engine), semanticOnly: !!semantic });
    void translateSentences(items, generation);
  }
}
async function updatePreferences(next, providerChanged = false) {
  const old = preferences; preferences = next;
  displayHold = lastView = undefined;
  if (old && old.sourceLanguage !== next.sourceLanguage) { generated = []; generatedTrackId = ''; }
  applyControls();
  const sourceChanged = !old || ['sourceKind', 'sourceLanguage'].some(k => old[k] !== next[k]);
  if (!next.enabled) { finishNativeCapture(); ++revision; loading = false; installSource([]); resetTranslations(); player?.classList.remove('sentence-native-hidden'); status('Disabled. Native YouTube captions and shortcuts restored.'); }
  else if (sourceChanged || !old.enabled) { if (next.sourceKind === 'generated') useGenerated(); else await discover(); }
  else if (providerChanged || old.engine !== next.engine || old.semanticSegmentation !== next.semanticSegmentation) {
    resetTranslations(); installSource(sourceCues); if (root) root.getElementById('retry').hidden = true;
  }
  else if (['targetLanguage', 'mode'].some(k => old[k] !== next[k])) {
    resetTranslations(); if (root) root.getElementById('retry').hidden = true;
    if (timeline.length) status(next.engine === 'none' && next.mode !== 'original' ? `${timeline.length} sentences ready. Showing original; connect a provider for translation.` : `${timeline.length} sentences ready.`);
  }
  render();
}
chrome.runtime.onMessage.addListener((m, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  if (m.type === 'set-rate') {
    if (video && Number.isFinite(m.rate) && m.rate >= 0.25 && m.rate <= 3) video.playbackRate = m.rate;
    respond({ ok: !!video }); return;
  }
  if (m.type === 'audio-discover') {
    bridge('audio-discover', { language: m.language }).then(respond, error => respond({ sources: [], error: error.message })); return true;
  }
  if (['audio-sabr-probe', 'audio-sabr-chunk', 'audio-sabr-cancel'].includes(m.type)) {
    if (m.videoId && m.videoId !== videoId) { respond({ ok: false, error: 'Video changed.' }); return; }
    bridge(m.type, { language: m.language, start: m.start, end: m.end, jobId: m.jobId }).then(respond, error => respond({ ok: false, error: error.message })); return true;
  }
  if (m.type === 'snapshot') { respond({ videoId, enabled: preferences.enabled, time: video?.currentTime, duration: video?.duration, paused: video?.paused ?? true, rate: video?.playbackRate,
    semantic: semantic ? { confirmed: semantic.sentences.length, complete: semantic.complete, pending: semantic.pending, blocked: semantic.blocked } : null,
    ad: player?.classList.contains('ad-showing'), protected: !!video?.mediaKeys, sentences: timeline.length, generatedCount: generated.length, status: baseStatus }); return; }
  if (m.type === 'view-generated') {
    if (!generated.length || !video || recording) { respond({ ok: false, error: 'No generated clip is ready, or recording is still active.' }); return; }
    const clipVideoId = videoId, clipStart = generated[0].start;
    (async () => {
      const result = await rpc({ type: 'set-preferences', preferences: { sourceKind: 'generated', enabled: true } });
      if (clipVideoId !== videoId || !video || !generated.length) throw new Error('Video changed. Generate a new clip.');
      await updatePreferences(result.preferences);
      video.currentTime = clipStart;
      render(); respond({ ok: true });
    })().catch(error => respond({ ok: false, error: error.message }));
    return true;
  }
  if (m.type === 'preferences-changed') { void updatePreferences(m.preferences, m.providerChanged); respond({ ok: true }); return; }
  if (m.type === 'capture-status' && m.videoId === videoId) {
    recording = m.recording; if (root) root.getElementById('capture').textContent = m.status; respond({ ok: true }); return;
  }
  if (m.type === 'generated-cues' && m.videoId === videoId) {
    if (m.trackId && !m.trackId.startsWith('[') && observedAudioTrackId && m.trackId !== observedAudioTrackId) { respond({ ok: false, error: 'Audio track changed.' }); return; }
    recording = false;
    if (m.error) { status(m.error); if (root) root.getElementById('capture').textContent = ''; }
    else {
      const incoming = Array.isArray(m.cues) ? m.cues : [];
      const nextLanguage = languages.find(([code, label]) => code.toLowerCase() === m.language?.toLowerCase() || label.toLowerCase() === m.language?.toLowerCase())?.[0] || 'auto';
      if (nextLanguage !== generatedLanguage || (m.trackId && generatedTrackId !== m.trackId)) generated = [];
      generatedTrackId = m.trackId || '';
      const start = m.interval?.start ?? incoming[0]?.start ?? 0, end = m.interval?.end ?? incoming.at(-1)?.end ?? 0;
      generated = [...generated.filter(c => c.end <= start || c.start >= end), ...incoming].sort((a, b) => a.start - b.start);
      generatedLanguage = nextLanguage;
      if (m.autoSelect && incoming.length) { preferences.sourceKind = 'generated'; if (root) root.getElementById('sourceKind').value = 'generated'; }
      if (root) root.getElementById('capture').textContent = m.autoSelect ? 'New speech subtitles available.' : 'Speech subtitles ready. Select Generated speech and replay the recorded portion.';
      if (preferences.sourceKind === 'generated') useGenerated();
    }
    respond({ ok: true });
  }
});
async function restoreSpeech() {
  if (!videoId || !preferences?.enabled || generated.length || restoringSpeech || Date.now() - lastSpeechRestore < 3000) return;
  const id = videoId, language = preferences.sourceLanguage;
  restoringSpeech = true; lastSpeechRestore = Date.now();
  try {
    const result = await rpc({ type: 'speech-cached', videoId: id });
    if (videoId !== id || preferences.sourceLanguage !== language || !result.cues?.length || generated.length) return;
    if (result.trackId && !result.trackId.startsWith('[') && observedAudioTrackId && result.trackId !== observedAudioTrackId) return;
    generated = result.cues; generatedTrackId = result.trackId || '';
    generatedLanguage = languages.find(([code, label]) => code.toLowerCase() === result.language?.toLowerCase() || label.toLowerCase() === result.language?.toLowerCase())?.[0] || 'auto';
    if (preferences.sourceKind === 'generated') useGenerated();
  } catch { /* The player may not have exposed its audio track yet. Retry on observation. */ }
  finally { restoringSpeech = false; }
}
function navigate() {
  const url = new URL(location.href), nextId = url.pathname === '/watch' && /^[\w-]{11}$/.test(url.searchParams.get('v') || '') ? url.searchParams.get('v') : '';
  if (nextId === videoId) { if (nextId) mount(); return; }
  ++revision; loading = false;
  if (videoId) void rpc({ type: 'capture-cancel' }).catch(() => {});
  if (recording) { recording = false; void rpc({ type: 'capture-cancel' }).catch(() => {}); }
  cancelSemantic(); semantic = undefined; sourceCues = []; semanticIdentity = '';
  videoId = nextId; selectedTrack = ''; tracks = []; timeline = []; generated = []; generatedTrackId = ''; observedAudioTrackId = ''; lastSpeechRestore = 0; discoveryRetries = 0; nativeAttempts.clear(); resetTranslations();
  for (const p of pendingBridge.values()) { clearTimeout(p.timer); p.reject(new Error('Video changed.')); } pendingBridge.clear();
  cleanupUI(); player = video = undefined;
  if (videoId && preferences) {
    mount(); void discover();
    void restoreSpeech();
  }
}
document.addEventListener('yt-navigate-finish', navigate);
document.addEventListener('yt-player-updated', () => { navigate(); if (preferences?.enabled && !tracks.length && !loading) void discover(); });
for (const name of ['seeking', 'pause', 'ratechange', 'ended']) document.addEventListener(name, event => {
  if (name === 'pause' && event.target === video) displayHold = lastView = undefined;
  if (name === 'seeking' && event.target === video) {
    displayHold = lastView = undefined;
    if (semantic?.pending) {
      const request = semantic.request, tokens = semantic.source.tokens;
      if (request && (video.currentTime < tokens[request.tokens[0].id].start || video.currentTime >= tokens[request.commitEnd].end)) cancelSemantic();
    }
  }
  if (name === 'seeking' && event.target === video && (generation.pending.size || generation.alignmentPending?.size)) {
    const index = sentenceIndex(timeline, video.currentTime);
    if ((generation.pending.size && !generation.pending.has(index)) || (generation.alignmentPending?.size && !generation.alignmentPending.has(index))) {
      resetTranslations({ preserve: true, full: generation.full, paused: generation.paused });
    }
  }
  if (name === 'seeking' && event.target === video) { generation.warm = false; render(); }
  if (recording && event.target === video) { recording = false; void rpc({ type: 'capture-cancel' }).catch(() => {}); }
}, true);
window.addEventListener('pagehide', () => { cancelSemantic(); if (semantic) semantic.paused = true; resetTranslations({ preserve: true, paused: true }); cleanupUI(); void rpc({ type: 'capture-cancel' }).catch(() => {}); });
try { preferences = (await rpc({ type: 'get-preferences' })).preferences; navigate(); }
catch { /* Reload after an extension update to reconnect. */ }
setInterval(() => {
  if (location.href !== knownURL || !host?.isConnected) { knownURL = location.href; navigate(); }
  if (host?.isConnected) mountPlayerButton();
  render();
}, 100);
