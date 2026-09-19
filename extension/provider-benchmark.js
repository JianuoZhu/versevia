import { translateBatch } from './providers.js';
import { validateEndpoint } from './core.js';

// Fixed synthetic text only; never reads the current video's captions.
export const BENCHMARK_SENTENCES = [
  'おはようございます。かずきです。',
  '今回はギターの練習方法を紹介します。',
  '最初から速く弾く必要はありません。',
  'まずはゆっくり、音を一つずつ確認してください。',
  'この部分は右手よりも左手の動きが大切です。',
  '難しければ、テンポを半分に落としてもかまいません。',
  '慣れてきたら、少しずつ元の速さに戻していきましょう。',
  '毎日五分でも続けることが上達につながります。'
].map((text, id) => ({ id, text }));

export async function benchmarkProvider(config, effort, signal, fetchImpl = fetch, now = () => performance.now()) {
  if (!['default', 'low', 'none'].includes(effort)) throw new Error('Invalid reasoning comparison.');
  const endpoint = validateEndpoint(config.endpoint);
  if (endpoint.hostname !== 'api.openai.com' || !/^gpt-5\.6-luna(?:-\d{4}-\d{2}-\d{2})?$/.test(config.model))
    throw new Error('This comparison supports the saved GPT-5.6 Luna model on api.openai.com.');
  let metrics;
  const timedFetch = async (url, options) => {
    const body = JSON.parse(options.body);
    if (effort !== 'default') body.reasoning_effort = effort;
    const start = now();
    const response = await fetchImpl(url, { ...options, body: JSON.stringify(body) });
    const headersMs = now() - start;
    const raw = await response.text(), totalMs = now() - start;
    let data; try { data = JSON.parse(raw); } catch { /* adapter reports normalized error */ }
    const usage = data?.usage;
    metrics = { headersMs: Math.round(headersMs), totalMs: Math.round(totalMs), inputTokens: usage?.prompt_tokens ?? null,
      outputTokens: usage?.completion_tokens ?? null, reasoningTokens: usage?.completion_tokens_details?.reasoning_tokens ?? null,
      cachedInputTokens: usage?.prompt_tokens_details?.cached_tokens ?? null };
    return new Response(raw, { status: response.status, statusText: response.statusText });
  };
  const translations = await translateBatch({ source: 'ja', target: 'zh', sentences: BENCHMARK_SENTENCES,
    before: 'ギター初心者に向けた練習方法の説明です。', after: '次は実際に音を出しながら練習します。', references: [] },
    'ai', config, signal, timedFetch);
  return { model: config.model, effort, ...metrics, translations };
}
