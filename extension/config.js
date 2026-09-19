import { validateEndpoint } from './core.js';
import { AI_ENGINES, ENGINE_IDS } from './catalog.js';
import { FONTS, STYLE_DEFAULTS } from './style-prefs.js';
export const DEFAULTS = Object.freeze({ enabled: true, mode: 'bilingual', sourceLanguage: 'auto', targetLanguage: 'es', sourceKind: 'auto',
  engine: 'none', semanticSegmentation: true, shortcuts: true, fontSize: 24, theme: 'midnight', panelOpacity: 96, subtitleOpacity: 85, subtitleTextOpacity: 100,
  subtitleX: 50, subtitleY: 88, translationScale: 0.9, ...STYLE_DEFAULTS });
export const PROVIDERS = Object.freeze({
  mymemory: { endpoint: 'https://api.mymemory.translated.net/get', model: '', key: '' },
  google: { endpoint: 'https://translation.googleapis.com/language/translate/v2', model: '', key: '' },
  deepl: { endpoint: 'https://api-free.deepl.com/v2/translate', model: '', key: '' },
  microsoft: { endpoint: 'https://api.cognitive.microsofttranslator.com/translate', region: '', model: '', key: '' },
  deepseek: { endpoint: 'https://api.deepseek.com/chat/completions', model: '', key: '' },
  gemini: { endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', model: '', key: '' },
  openrouter: { endpoint: 'https://openrouter.ai/api/v1/chat/completions', model: '', key: '' },
  libre: { endpoint: 'https://libretranslate.com/translate', model: '', key: '' },
  ai: { endpoint: 'https://api.openai.com/v1/chat/completions', model: '', key: '' },
  asr: { endpoint: 'https://api.openai.com/v1/audio/transcriptions', model: 'whisper-1', key: '' }
});
export function sanitizePreferences(input = {}) {
  const prefs = { ...DEFAULTS };
  for (const key of ['enabled', 'shortcuts', 'semanticSegmentation']) if (typeof input[key] === 'boolean') prefs[key] = input[key];
  for (const [key, choices] of Object.entries({ mode: ['original', 'translation', 'bilingual'], sourceKind: ['auto', 'creator', 'automatic', 'generated'], engine: ['none', ...ENGINE_IDS], theme: ['midnight', 'mint'] })) {
    if (choices.includes(input[key])) prefs[key] = input[key];
  }
  for (const key of ['sourceLanguage', 'targetLanguage']) if (typeof input[key] === 'string' && /^(?:auto|[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*)$/.test(input[key])) prefs[key] = input[key];
  if (prefs.targetLanguage === 'auto') prefs.targetLanguage = 'es';
  if (Object.hasOwn(FONTS, input.fontFamily)) prefs.fontFamily = input.fontFamily;
  if (['400', '500', '600', '700'].includes(input.fontWeight)) prefs.fontWeight = input.fontWeight;
  for (const key of ['originalColor', 'translationColor', 'subtitleBackground', 'accentColor']) {
    if (typeof input[key] === 'string' && /^#[0-9a-f]{6}$/i.test(input[key])) prefs[key] = input[key].toLowerCase();
  }
  if (Number.isFinite(input.lineHeight)) prefs.lineHeight = Math.max(1.1, Math.min(2, input.lineHeight));
  for (const [key, min, max] of [['fontSize', 16, 64], ['panelOpacity', 35, 100], ['subtitleOpacity', 0, 100], ['subtitleTextOpacity', 30, 100], ['subtitleX', 10, 90], ['subtitleY', 20, 95], ['translationScale', 0.5, 1.8]]) {
    if (Number.isFinite(input[key])) prefs[key] = Math.max(min, Math.min(max, input[key]));
  }
  return prefs;
}
export async function getPreferences() {
  return sanitizePreferences((await chrome.storage.local.get('preferences')).preferences);
}
export async function getProvider(id) {
  if (!PROVIDERS[id]) throw new Error('Unknown provider.');
  const { providers = {} } = await chrome.storage.local.get('providers');
  return { ...PROVIDERS[id], ...providers[id] };
}
export async function requireProvider(id) {
  const config = await getProvider(id);
  const url = validateEndpoint(config.endpoint);
  if (!await chrome.permissions.contains({ origins: [`${url.origin}/*`] })) throw new Error('Connect this provider in Provider settings to grant access to its endpoint.');
  if ([...AI_ENGINES, 'asr'].includes(id) && !config.model.trim()) throw new Error('Enter a model in Provider settings.');
  if (['google', 'deepl', 'microsoft', 'deepseek', 'gemini', 'openrouter'].includes(id) && !config.key.trim()) throw new Error('Enter an API key in Provider settings for this translation service.');
  return config;
}
