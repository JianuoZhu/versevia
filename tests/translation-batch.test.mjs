import test from 'node:test';
import assert from 'node:assert/strict';
import { planTranslation, validateBatch, translationContext, validateReferences } from '../extension/translation-batch.js';
import { translateBatch } from '../extension/providers.js';
const timeline = Array.from({ length: 80 }, (_, id) => ({ id, text: `Sentence ${id}.` }));
const config = { endpoint: 'https://example.com/chat/completions', model: 'test', key: '' };
const input = { source: 'en', target: 'zh', sentences: timeline.slice(0, 2), before: 'Before.', after: 'After.' };
const response = result => async () => Response.json({ choices: [{ message: { content: JSON.stringify(result) } }] });

test('small first batch, bounded lookahead, playback priority and whole-video completion', () => {
  assert.deepEqual(planTranslation(timeline, 20, new Map()).map(s => s.id), [20, 21]);
  assert.equal(planTranslation(timeline, 20, new Map(), { warm: true }).length, 48);
  const done = new Map(timeline.slice(20, 68).map(s => [s.id, 'translated']));
  assert.deepEqual(planTranslation(timeline, 20, done, { warm: true }), []);
  assert.equal(planTranslation(timeline, 20, done, { warm: true, full: true })[0].id, 0);
  assert.equal(planTranslation(timeline, 75, done, { warm: true, full: true })[0].id, 75);
  assert.equal(planTranslation(timeline, -1, done, { full: true })[0].id, 0);
  assert.deepEqual(planTranslation(timeline, -1, done), []);
  assert.equal(planTranslation(timeline, 0, new Map(), { batch: false }).length, 1);
  assert.equal(planTranslation(timeline.map(s => ({ ...s, text: 'x'.repeat(2500) })), 0, new Map(), { warm: true }).length, 9);
  const semantic = timeline.map(s => ({ ...s, semantic: s.id < 10 || s.id >= 20 }));
  assert.equal(planTranslation(semantic, 0, new Map(), { semanticOnly: true }).length, 8);
  assert.equal(planTranslation(semantic, 0, new Map(), { warm: true, semanticOnly: true }).length, 10);
  assert.deepEqual(planTranslation(semantic, 10, new Map(), { semanticOnly: true }), []);
  assert.deepEqual(planTranslation(semantic, 10, new Map(), { semanticOnly: true, full: true }), []);
});

test('batch adapter requests exact IDs, supplies context once, and reorders by ID', async () => {
  const output = await translateBatch(input, 'ai', config, undefined, async (_, options) => {
    const body = JSON.parse(options.body), payload = JSON.parse(body.messages[1].content);
    assert.deepEqual(payload.sentences, input.sentences);
    assert.deepEqual(payload.translateIds, [0, 1]);
    assert.equal(payload.previous, input.before); assert.equal(payload.next, input.after);
    assert.match(body.messages[0].content, /untrusted/);
    return response([{ id: 1, translation: '第二句。' }, { id: 0, translation: '第一句。' }])();
  });
  assert.deepEqual(output, [{ id: 0, translation: '第一句。' }, { id: 1, translation: '第二句。' }]);
});

test('malformed, missing, duplicate, unknown and empty batch results never silently misalign subtitles', async () => {
  for (const result of [null, {}, [{ id: 0, translation: 'a' }], [{ id: 0, translation: 'a' }, { id: 0, translation: 'b' }],
    [{ id: 0, translation: 'a' }, { id: 99, translation: 'b' }], [{ id: 0, translation: 'a' }, { id: 1, translation: ' ' }],
    [{ id: '0', translation: 'a' }, { id: 1, translation: 'b' }]]) {
    await assert.rejects(translateBatch(input, 'ai', config, undefined, response(result)), /invalid sentences/);
  }
  await assert.rejects(translateBatch(input, 'ai', config, undefined, async () => Response.json({ choices: [{ message: { content: 'not json' } }] })), /invalid JSON/);
});

test('input limits and same-language bypass', async () => {
  for (const items of [[], timeline.slice(0, 49), [{ id: -1, text: 'x' }], [timeline[0], timeline[0]], [{ id: 0, text: 'x'.repeat(16001) }],
    [{ id: 0, text: 'x'.repeat(13000) }, { id: 1, text: 'x'.repeat(13000) }]]) assert.throws(() => validateBatch(items), /Invalid/);
  assert.equal((await translateBatch({ ...input, target: 'en' }, 'ai', config, undefined, () => { throw new Error('must not fetch'); }))[0].translation, 'Sentence 0.');
});

test('context spans eight neighbouring sentences and carries bounded accepted translations', () => {
  const context = translationContext(timeline, timeline.slice(10, 20), new Map([[9, '第九句'], [8, '第八句']]));
  assert.equal(context.before.split('\n').length, 8); assert.equal(context.after.split('\n').length, 8);
  assert.deepEqual(context.references, [{ source: 'Sentence 8.', translation: '第八句' }, { source: 'Sentence 9.', translation: '第九句' }]);
  const huge = timeline.map(s => ({ ...s, text: '長'.repeat(1000) }));
  const bounded = translationContext(huge, huge.slice(10, 20), new Map([[9, '译'.repeat(5000)]]));
  assert.equal(bounded.before.length, 4000); assert.equal(bounded.after.length, 4000); assert.deepEqual(bounded.references, []);
  assert.throws(() => validateReferences([{ source: 'text', translation: 'x'.repeat(4001) }]), /Invalid/);
});
