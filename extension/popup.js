import { applyPageBrand } from './page-brand.js';
const $ = id => document.getElementById(id);
let tabId, capture, canRecord = false, canPrepare = false, speechReady = false, startingAudio = false;
const rpc = async message => { const r = await chrome.runtime.sendMessage(message); if (!r?.ok) throw new Error(r?.error || 'Extension unavailable.'); return r; };
async function tabMessage(message) {
  if (!tabId) throw new Error('Open a YouTube watch page first.');
  try { return await chrome.tabs.sendMessage(tabId, message); } catch { throw new Error('Reload the YouTube page to connect the extension.'); }
}
function buttons() {
  $('start').hidden = !!capture; $('finish').hidden = !capture || capture.kind === 'audio'; $('cancel').hidden = !capture;
  $('start').disabled = !canRecord || !speechReady || !$('consent').checked;
  $('finish').disabled = !capture?.status?.startsWith('Recording');
  $('audio-start').disabled = startingAudio || !!capture || !canPrepare || !speechReady || !$('audio-consent').checked;
  $('audio-test').disabled = startingAudio || !!capture || !canPrepare;
}
async function refresh() {
  try {
    const task = await rpc({ type: 'capture-state' }); capture = task.capture;
    const readiness = await rpc({ type: 'speech-readiness' });
    speechReady = readiness.ready;
    $('speech-readiness').textContent = readiness.message;
    $('capture-status').textContent = capture ? `${capture.status}${capture.tabId !== tabId ? ' (another tab)' : ''}` : task.outcome?.tabId === tabId ? task.outcome.status : '';
    const snapshot = await tabMessage({ type: 'snapshot' });
    canRecord = !!snapshot?.videoId && snapshot.enabled !== false && !snapshot.paused && !snapshot.ad && snapshot.rate === 1 && Number.isFinite(snapshot.duration);
    canPrepare = !!snapshot?.videoId && snapshot.enabled !== false && !snapshot.ad && !snapshot.protected && snapshot.duration > 0 && snapshot.duration <= 14400;
    if (snapshot) {
      const value = String(snapshot.rate);
      if (![...$('speed').options].some(o => o.value === value)) { const o = new Option(`${value}×`, value); $('speed').add(o); }
      $('speed').value = value;
      $('page-status').textContent = snapshot.status || 'Video connected.';
      $('view-generated').hidden = !snapshot.generatedCount || (!!capture && capture.kind !== 'audio');
      if (!capture && !task.outcome && speechReady && !canRecord) $('capture-status').textContent = 'Manual recording: play a regular video at 1×. Generate from video audio also works while paused.';
    }
  } catch (e) { canRecord = canPrepare = false; $('page-status').textContent = e.message; }
  buttons();
}
$('consent').onchange = buttons;
$('audio-consent').onchange = buttons;
$('audio-test').onclick = async () => {
  startingAudio = true; buttons();
  try {
    await rpc({ type: 'audio-test', tabId, confirmed: true });
    $('status').textContent = 'Testing a five-second audio interval in the browser. No speech provider is called.';
  } catch (error) { $('status').textContent = error.message; }
  finally { startingAudio = false; await refresh(); }
};
$('audio-start').onclick = async () => {
  startingAudio = true; buttons();
  try {
    // Optional permissions are requested only on the explicit toolbar gesture.
    if (!await chrome.permissions.request({ origins: ['https://*.googlevideo.com/*'] })) throw new Error('Audio download permission was not granted.');
    await rpc({ type: 'audio-start', tabId, confirmed: $('audio-consent').checked, scope: $('audio-scope').value });
    $('status').textContent = 'Preparing video audio. You can close this popup and use the player normally.';
  } catch (error) { $('status').textContent = error.message; }
  finally { startingAudio = false; $('audio-consent').checked = false; await refresh(); }
};
$('options').onclick = () => chrome.runtime.openOptionsPage();
$('speech-options').onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('options.html?provider=asr') });
$('view-generated').onclick = async () => {
  try {
    const result = await tabMessage({ type: 'view-generated' });
    if (!result?.ok) throw new Error(result?.error || 'No generated subtitles available.');
    $('status').textContent = 'Generated subtitles selected. Playback position is at the recorded clip; press play when ready.';
  } catch (e) { $('status').textContent = e.message; }
};
for (const id of ['enabled', 'mode']) $(id).onchange = async () => {
  try { await rpc({ type: 'set-preferences', preferences: { [id]: id === 'enabled' ? $(id).checked : $(id).value } }); }
  catch (e) { $('status').textContent = e.message; }
};
$('speed').onchange = async () => {
  try { await tabMessage({ type: 'set-rate', rate: Number($('speed').value) }); }
  catch (e) { $('status').textContent = e.message; }
};
$('start').onclick = async () => {
  $('start').disabled = true;
  try { await rpc({ type: 'capture-start', tabId, confirmed: $('consent').checked, duration: Number($('duration').value) }); $('status').textContent = 'Recording started. You can close this popup; the recording limit still applies.'; }
  catch (e) { $('status').textContent = e.message; }
  $('consent').checked = false; await refresh();
};
$('finish').onclick = async () => {
  try { await rpc({ type: 'capture-finish' }); $('status').textContent = 'Processing recorded audio. Replay the clip when subtitles are ready.'; }
  catch (e) { $('status').textContent = e.message; } await refresh();
};
$('cancel').onclick = async () => {
  try { await rpc({ type: 'capture-cancel' }); $('status').textContent = 'Recording cancelled. An already submitted request may still be billed by the provider.'; }
  catch (e) { $('status').textContent = e.message; } await refresh();
};
try {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.url?.startsWith('https://www.youtube.com/watch?')) tabId = tab.id;
  const prefs = (await rpc({ type: 'get-preferences' })).preferences;
  applyPageBrand(prefs);
  $('enabled').checked = prefs.enabled; $('mode').value = prefs.mode;
  await refresh(); setInterval(refresh, 1000);
} catch (e) { $('status').textContent = e.message; }
