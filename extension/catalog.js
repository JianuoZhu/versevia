// Public presets only. Credentials are loaded separately in the service worker.
export const AI_ENGINES = ['ai', 'deepseek', 'gemini', 'openrouter'];
export const ENGINE_LABELS = { mymemory: 'MyMemory · free quota', google: 'Google Translate', deepl: 'DeepL', microsoft: 'Microsoft Translator', libre: 'LibreTranslate',
  ai: 'Custom AI / OpenAI', deepseek: 'DeepSeek', gemini: 'Google Gemini', openrouter: 'OpenRouter' };
export const ENGINE_IDS = Object.keys(ENGINE_LABELS);
