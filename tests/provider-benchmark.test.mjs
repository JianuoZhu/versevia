import test from 'node:test';
import assert from 'node:assert/strict';
import { benchmarkProvider, BENCHMARK_SENTENCES } from '../extension/provider-benchmark.js';

test('latency benchmark retains production prompt, compares reasoning and reports safe full-response metrics', async () => {
  const config = { endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-5.6-luna', key: 'fixture-secret' };
  const bodies = [];
  for (const effort of ['default', 'low', 'none']) {
    const times = [0, 25, 140];
    const result = await benchmarkProvider(config, effort, AbortSignal.timeout(1000), async (_url, options) => {
      const body = JSON.parse(options.body); bodies.push(body);
      assert.equal(options.headers.Authorization, 'Bearer fixture-secret');
      return Response.json({ choices: [{ message: { content: JSON.stringify(BENCHMARK_SENTENCES.map(s => ({ id: s.id, translation: `译文${s.id}` }))) } }],
        usage: { prompt_tokens: 400, completion_tokens: 80, completion_tokens_details: { reasoning_tokens: 20 }, prompt_tokens_details: { cached_tokens: 50 } } });
    }, () => times.shift());
    assert.equal(result.totalMs, 140); assert.equal(result.headersMs, 25);
    assert.equal(result.reasoningTokens, 20); assert.equal(result.cachedInputTokens, 50);
    assert.equal(result.translations.length, 8); assert.ok(!JSON.stringify(result).includes(config.key));
  }
  assert.equal(Object.hasOwn(bodies[0], 'reasoning_effort'), false);
  assert.equal(bodies[1].reasoning_effort, 'low'); assert.equal(bodies[2].reasoning_effort, 'none');
  assert.deepEqual(bodies[0].messages, bodies[1].messages); assert.deepEqual(bodies[1].messages, bodies[2].messages);
  let fetched = false;
  await assert.rejects(benchmarkProvider({ ...config, endpoint: 'https://other.example/chat' }, 'none', undefined, () => { fetched = true; }), /api.openai.com/);
  await assert.rejects(benchmarkProvider(config, 'high'), /Invalid reasoning/);
  assert.equal(fetched, false);
});
