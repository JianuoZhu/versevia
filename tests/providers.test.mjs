import test from 'node:test';
import assert from 'node:assert/strict';
import { translate, transcribe, fetchProvider } from '../extension/providers.js';
import { cacheKey } from '../extension/cache.js';
import { sanitizePreferences, PROVIDERS } from '../extension/config.js';
import { AI_ENGINES } from '../extension/catalog.js';
const input = { text: 'Hello.', source: 'en', target: 'es', before: 'A greeting.', after: 'How are you?' };
const config = { endpoint: 'https://provider.example/v1/chat/completions', model: 'custom-model', key: 'test-only-key' };

test('Microsoft Translator supplies version, locale and regional subscription headers', async () => {
  const result = await translate({ ...input, target: 'zh-TW' }, 'microsoft', { ...config, region: 'eastus' }, undefined, async (url, options) => {
    assert.equal(url.searchParams.get('api-version'), '3.0'); assert.equal(url.searchParams.get('to'), 'zh-Hant');
    assert.equal(options.headers['Ocp-Apim-Subscription-Region'], 'eastus');
    assert.equal(options.headers['Ocp-Apim-Subscription-Key'], config.key);
    assert.deepEqual(JSON.parse(options.body), [{ Text: input.text }]);
    return Response.json([{ translations: [{ text: '你好。', to: 'zh-Hant' }] }]);
  });
  assert.equal(result, '你好。');
});

test('all AI presets use their own endpoint and include context in cache identity', async () => {
  for (const engine of AI_ENGINES) {
    const preset = { ...PROVIDERS[engine], key: 'test-key', model: 'test-model' };
    const result = await translate(input, engine, preset, undefined, async (url, options) => {
      assert.equal(url.href, preset.endpoint); assert.equal(JSON.parse(options.body).model, 'test-model');
      return Response.json({ choices: [{ message: { content: 'Hola.' } }] });
    });
    assert.equal(result, 'Hola.');
    assert.notEqual(await cacheKey(input, engine, preset), await cacheKey({ ...input, before: 'Different context' }, engine, preset));
    assert.equal(sanitizePreferences({ engine }).engine, engine);
  }
});

test('Google Cloud uses POST text format and keeps its API key out of the URL', async () => {
  const result = await translate(input, 'google', config, undefined, async (url, options) => {
    assert.equal(url.searchParams.has('key'), false);
    assert.equal(options.headers['X-Goog-Api-Key'], config.key);
    assert.deepEqual(JSON.parse(options.body), { q: 'Hello.', source: 'en', target: 'es', format: 'text' });
    return Response.json({ data: { translations: [{ translatedText: 'Hola.' }] } });
  });
  assert.equal(result, 'Hola.');
  await assert.rejects(translate(input, 'google', { ...config, key: '' }), /requires an API key/);
});

test('DeepL uses header authentication, context and script-aware Chinese target codes', async () => {
  const result = await translate({ ...input, target: 'zh-TW' }, 'deepl', config, undefined, async (_url, options) => {
    assert.equal(options.headers.Authorization, `DeepL-Auth-Key ${config.key}`);
    assert.deepEqual(JSON.parse(options.body), { text: ['Hello.'], source_lang: 'EN', target_lang: 'ZH-HANT', context: 'A greeting.\nHow are you?', preserve_formatting: true });
    return Response.json({ translations: [{ text: '你好。' }] });
  });
  assert.equal(result, '你好。');
  assert.notEqual(await cacheKey(input, 'deepl', config), await cacheKey({ ...input, after: 'Other context.' }, 'deepl', config));
  await assert.rejects(translate(input, 'deepl', { ...config, key: '' }), /requires an API key/);
});
test('AI adapter sends bounded sentence context and exact model to configured endpoint', async () => {
  const result = await translate(input, 'ai', config, undefined, async (url, options) => {
    assert.equal(url.href, config.endpoint); assert.equal(options.headers.Authorization, 'Bearer test-only-key');
    assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
    const request = JSON.parse(options.body); assert.equal(request.model, 'custom-model');
    assert.deepEqual(JSON.parse(request.messages[1].content), { previous: input.before, sentence: input.text, next: input.after });
    return Response.json({ choices: [{ message: { content: 'Hola.' } }] });
  }); assert.equal(result, 'Hola.');
});
test('LibreTranslate adapter uses its actual request and response schema', async () => {
  const result = await translate(input, 'libre', config, undefined, async (_url, options) => {
    assert.deepEqual(JSON.parse(options.body), { q: 'Hello.', source: 'en', target: 'es', format: 'text', api_key: 'test-only-key' });
    return Response.json({ translatedText: 'Hola.' });
  }); assert.equal(result, 'Hola.');
});
test('MyMemory adapter validates quota status and UTF-8 length', async () => {
  const result = await translate(input, 'mymemory', { ...config, endpoint: 'https://api.mymemory.translated.net/get' }, undefined, async (url, options) => {
    assert.equal(url.searchParams.get('langpair'), 'en|es'); assert.equal(url.searchParams.get('q'), 'Hello.');
    assert.equal(options.credentials, 'omit');
    return Response.json({ responseStatus: 200, responseData: { translatedText: 'Hola.' } });
  }); assert.equal(result, 'Hola.');
  await assert.rejects(translate({ ...input, text: '你'.repeat(170) }, 'mymemory', config), /500 UTF-8/);
});
test('HTTP errors never disclose provider response bodies or echoed credentials', async () => {
  await assert.rejects(fetchProvider(config.endpoint, {}, async () => new Response('secret test-only-key', { status: 401 })), { message: 'API key rejected (HTTP 401).' });
  await assert.rejects(fetchProvider(config.endpoint, {}, async () => new Response('over quota', { status: 429 })), /Rate limit or quota/);
});
test('malformed, empty and oversized translation responses fail safely', async () => {
  await assert.rejects(translate(input, 'ai', config, undefined, async () => Response.json({ choices: [] })), /no usable translation/);
  await assert.rejects(fetchProvider(config.endpoint, {}, async () => new Response('<html>Error</html>')), /invalid JSON/);
});
test('cancel signal reaches network unchanged', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(translate(input, 'ai', config, controller.signal, async (_url, options) => {
    assert.equal(options.signal, controller.signal); options.signal.throwIfAborted();
  }), { name: 'AbortError' });
});
test('ASR uploads WebM, model and timestamped response format without Content-Type override', async () => {
  await transcribe(new Blob(['audio'], { type: 'audio/webm' }), 'en-US', config, undefined, async (_url, options) => {
    assert.equal(options.body.get('file').name, 'youtube-clip.webm');
    assert.equal(options.body.get('response_format'), 'verbose_json');
    assert.equal(options.body.get('timestamp_granularities[]'), 'segment');
    assert.equal(options.body.get('language'), 'en'); assert.equal(options.headers['Content-Type'], undefined);
    return Response.json({ segments: [] });
  });
});
test('cache invalidates across engine, model, endpoint, language and AI context', async () => {
  const base = await cacheKey(input, 'ai', config);
  for (const [i, e, c] of [[{ ...input, after: 'Different' }, 'ai', config], [{ ...input, target: 'fr' }, 'ai', config], [input, 'libre', config], [input, 'ai', { ...config, model: 'other' }], [input, 'ai', { ...config, endpoint: 'https://other.example' }]]) assert.notEqual(base, await cacheKey(i, e, c));
  assert.equal(base, await cacheKey(input, 'ai', { ...config, key: 'different-secret' }));
});
test('preference validation drops unknown fields, clamps font and preserves independent source/engine', () => {
  const prefs = sanitizePreferences({ engine: 'ai', sourceKind: 'creator', fontSize: 999, secret: 'bad', enabled: 'yes' });
  assert.equal(prefs.engine, 'ai'); assert.equal(prefs.sourceKind, 'creator'); assert.equal(prefs.fontSize, 64);
  assert.equal(prefs.secret, undefined); assert.equal(prefs.enabled, true);
});
