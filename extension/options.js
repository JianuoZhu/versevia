import { validateEndpoint } from './core.js';
import { AI_ENGINES, ENGINE_LABELS } from './catalog.js';
import { applyPageBrand, createStyleEditor, createSettingsNavigation, readStyleEditor, loadStyleEditor, previewStyle } from './page-brand.js';
const $ = id => document.getElementById(id);
let providers = {}, preferences, loaded = false;
let benchmarking = false, stopBenchmark = false;
const styleEditor = createStyleEditor();
createSettingsNavigation();
styleEditor.oninput = () => { if (loaded) previewStyle(readStyleEditor()); };
$('save-style').onclick = async () => {
  if (!loaded) return;
  try {
    const result = await rpc({ type: 'set-preferences', preferences: readStyleEditor() });
    preferences = result.preferences; applyPageBrand(preferences);
    $('style-status').textContent = 'Appearance saved. The player updates automatically.';
  } catch (e) { $('style-status').textContent = e.message; }
};
const rpc = async m => { const r = await chrome.runtime.sendMessage(m); if (!r?.ok) throw new Error(r?.error || 'Extension unavailable.'); return r; };
const hints = {
  microsoft: 'Azure Translator Text v3. Supply your subscription key and Azure region (required for regional/multi-service resources). The API version is added automatically.',
  deepseek: 'Official DeepSeek Chat Completions endpoint. Supply your API key and an exact model ID from your account. Neighbouring sentences are sent as context.',
  gemini: 'Official Gemini OpenAI-compatible endpoint. Use a Google AI Studio API key and a Gemini model ID supported by your account. Quotas depend on the model and account.',
  openrouter: 'OpenRouter Chat Completions endpoint. Enter your API key and the exact provider/model slug from OpenRouter. Selected models can have different pricing and data policies.',
  google: 'Official Google Cloud Translation Basic v2 API. Enable Cloud Translation in your Google Cloud project and supply its API key; billing/quota applies. This is separate from the free Google Translate website.',
  deepl: 'Official DeepL API. API Free uses https://api-free.deepl.com/v2/translate; API Pro uses https://api.deepl.com/v2/translate. Supply a DeepL API key (a regular DeepL Pro subscription is not an API plan). Neighbouring sentences are sent as context.',
  mymemory: 'Public conventional translation with a limited free quota. Caption text is sent in the request URL to MyMemory. Connect explicitly before use. Maximum 500 UTF-8 bytes per sentence.',
  libre: 'Use your own LibreTranslate server or a hosted instance. Many hosted instances require an API key. Example local endpoint: http://localhost:5000/translate.',
  ai: 'Use an OpenAI-compatible Chat Completions endpoint and the exact model ID supported by your service. AI semantic sentences use this provider before translation. Translation batches contain up to 48 sentences with surrounding source context and accepted translations for terminology consistency.',
  asr: 'Use an audio/transcriptions endpoint accepting WebM and returning verbose_json with timestamped segments. whisper-1 is a compatible model on OpenAI. Recording starts only from the toolbar popup.'
};
function showProvider() {
  if (!loaded) return;
  const id = $('provider').value, config = providers[id];
  $('endpoint').value = config.endpoint; $('key').value = config.key; $('model').value = config.model;
  $('region').value = config.region || ''; $('region-label').hidden = id !== 'microsoft';
  $('endpoint').readOnly = ['mymemory', 'google'].includes(id);
  $('key').required = ['google', 'deepl', 'microsoft', 'deepseek', 'gemini', 'openrouter'].includes(id);
  $('model-label').hidden = ![...AI_ENGINES, 'asr'].includes(id); $('model').required = [...AI_ENGINES, 'asr'].includes(id);
  $('test').hidden = id === 'asr'; $('hint').textContent = hints[id]; $('provider-status').textContent = '';
  $('benchmark-area').hidden = !AI_ENGINES.includes(id);
  $('provider-form').querySelector('button[type=submit]').textContent = id === 'asr' ? 'Save speech service' : 'Save, connect & use';
  $('provider-form').querySelector('p.muted').textContent = id === 'asr'
    ? 'Speech recognition uses its own endpoint, key and model. Saving does not record audio. Start a clip explicitly from the browser toolbar.'
    : 'Save, connect & use selects this translator and enables bilingual translation on open YouTube pages. Requests may incur provider charges.';
}
$('provider').onchange = showProvider;
$('provider-form').onsubmit = async event => {
  event.preventDefault();
  if (!loaded) return;
  const id = $('provider').value;
  try {
    const url = validateEndpoint($('endpoint').value.trim());
    // Keep endpoint and credentials from the same submit gesture, even if the
    // user edits or switches providers while the permission prompt is open.
    const config = { endpoint: url.href, key: $('key').value, model: $('model').value, region: $('region').value };
    // Request synchronously from the submit gesture; browser owns the permission dialog.
    const granted = await chrome.permissions.request({ origins: [`${url.origin}/*`] });
    if (!granted) throw new Error('Endpoint permission was not granted. Settings were not saved.');
    await rpc({ type: 'save-provider', id, config }); providers[id] = config;
    if (id !== 'asr') {
      const result = await rpc({ type: 'set-preferences', preferences: { engine: id, mode: 'bilingual' } });
      preferences = result.preferences; $('engine').value = id;
    }
    $('provider-status').textContent = id === 'asr' ? 'Speech provider saved. Start a recording explicitly from the toolbar.' : 'Connected and selected. Bilingual translation is now enabled on YouTube.';
  } catch (e) { $('provider-status').textContent = e.message; }
};
$('test').onclick = async () => {
  if (!loaded) return;
  $('test').disabled = true; $('provider-status').textContent = 'Translating “Hello, world.” into Spanish using the saved configuration…';
  try { const r = await rpc({ type: 'test-provider', engine: $('provider').value }); $('provider-status').textContent = `Connection works: ${r.text}`; }
  catch (e) { $('provider-status').textContent = e.message; }
  finally { $('test').disabled = false; }
};
$('benchmark').onclick = async () => {
  if (!loaded || benchmarking) return;
  benchmarking = true; stopBenchmark = false;
  const engine = $('provider').value, rows = [], efforts = ['default', 'low', 'none', 'none', 'low', 'default'];
  $('benchmark').disabled = true; $('stop-benchmark').hidden = false;
  try {
    for (let i = 0; i < efforts.length && !stopBenchmark; i++) {
      $('benchmark-status').textContent = `Request ${i + 1}/6 · ${efforts[i]} · saved model · up to 90 seconds per request…`;
      const { result } = await rpc({ type: 'benchmark-provider', engine, effort: efforts[i] });
      rows.push(result);
      $('benchmark-results').textContent = JSON.stringify({ note: 'Live API. Six fixed 8-sentence batches; no extension cache. Two samples per effort are preliminary. Provider prompt caching and load may differ. totalMs includes full response, not only first token. Compare the translations too.', results: rows }, null, 2);
    }
    $('benchmark-status').textContent = stopBenchmark ? 'Stopped after the current request. Results above are retained.' : 'Comparison complete. Share the results; no key or personal captions are included.';
  } catch (e) { $('benchmark-status').textContent = `Comparison stopped: ${e.message}`; }
  finally { benchmarking = false; $('benchmark').disabled = false; $('stop-benchmark').hidden = true; }
};
$('stop-benchmark').onclick = () => { stopBenchmark = true; $('benchmark-status').textContent = 'Stopping after the current request completes…'; };
$('forget').onclick = async () => {
  if (!loaded) return;
  const id = $('provider').value;
  try { const config = { ...providers[id], key: '' }; await rpc({ type: 'save-provider', id, config }); providers[id] = config; $('key').value = ''; $('provider-status').textContent = 'Saved API key removed.'; }
  catch (e) { $('provider-status').textContent = e.message; }
};
$('save-preferences').onclick = async () => {
  if (!loaded) return;
  try {
    const fontSize = Number($('fontSize').value);
    if (!Number.isFinite(fontSize) || fontSize < 16 || fontSize > 64) throw new Error('Subtitle font size must be between 16 and 64 px.');
    for (const id of ['sourceLanguage', 'targetLanguage']) {
      const value = $(id).value.trim();
      if (!(id === 'sourceLanguage' && value === 'auto') && !/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(value)) throw new Error('Use a language code such as en, es, zh or pt-BR. Only source may be auto.');
    }
    const result = await rpc({ type: 'set-preferences', preferences: { engine: $('engine').value, targetLanguage: $('targetLanguage').value.trim(), sourceLanguage: $('sourceLanguage').value.trim(), fontSize: Number($('fontSize').value), semanticSegmentation: $('semanticSegmentation').checked } });
    preferences = result.preferences; $('preferences-status').textContent = 'Preferences saved. Open YouTube pages update automatically.';
  } catch (e) { $('preferences-status').textContent = e.message; }
};
$('clear-cache').onclick = async () => {
  if (!loaded) return;
  try { await rpc({ type: 'clear-cache' }); $('cache-status').textContent = 'Translation cache cleared.'; }
  catch (e) { $('cache-status').textContent = e.message; }
};
const choice = (id, label) => { const o = document.createElement('option'); o.value = id; o.textContent = label; return o; };
$('provider').replaceChildren(...Object.entries(ENGINE_LABELS).map(([id, label]) => choice(id, label)), choice('asr', 'Speech recognition'));
const requestedProvider = new URL(document.URL).searchParams.get('provider');
if ([...Object.keys(ENGINE_LABELS), 'asr'].includes(requestedProvider)) $('provider').value = requestedProvider;
$('engine').replaceChildren(choice('none', 'Not connected / off'), ...Object.entries(ENGINE_LABELS).map(([id, label]) => choice(id, label)));
async function loadSettings() {
  loaded = false;
  const controls = [...document.querySelectorAll('input, select, button')].filter(el => el.id !== 'reload-settings');
  controls.forEach(el => { el.disabled = true; });
  $('reload-settings').hidden = true;
  $('reload-settings').disabled = true;
  $('provider-status').textContent = 'Loading settings…';
  try {
    const nextProviders = (await rpc({ type: 'get-providers' })).providers;
    // Do not substitute empty defaults after a failed/incomplete read: saving
    // those would risk replacing the user's previously configured credentials.
    for (const id of [...Object.keys(ENGINE_LABELS), 'asr']) {
      const config = nextProviders?.[id];
      if (!config || ['endpoint', 'key', 'model'].some(field => typeof config[field] !== 'string')) {
        throw new Error('Provider settings are incomplete. Reload the extension and reopen this page.');
      }
    }
    const nextPreferences = (await rpc({ type: 'get-preferences' })).preferences;
    if (!nextPreferences) throw new Error('Reading preferences failed.');
    providers = nextProviders; preferences = nextPreferences;
    applyPageBrand(preferences); loadStyleEditor(preferences);
    for (const id of ['engine', 'targetLanguage', 'sourceLanguage', 'fontSize']) $(id).value = preferences[id];
    $('semanticSegmentation').checked = preferences.semanticSegmentation !== false;
    loaded = true;
    controls.forEach(el => { el.disabled = false; });
    showProvider();
  } catch (e) {
    $('provider-status').textContent = `Settings could not be loaded: ${e.message} Retry loading, or reload the extension and reopen this page.`;
    $('reload-settings').hidden = false;
  } finally { $('reload-settings').disabled = false; }
}
$('reload-settings').onclick = loadSettings;
await loadSettings();
