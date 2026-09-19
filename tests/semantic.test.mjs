import test from 'node:test';
import assert from 'node:assert/strict';
import { indexSource, sourceRange, SemanticTimeline, validateBoundaries, validateSemanticRequest, displayGroups, validateAlignment } from '../extension/semantic.js';
import { segmentSemantically, alignTranslation } from '../extension/semantic-provider.js';
import { taskCacheKey, cacheKey } from '../extension/cache.js';
const cue = (start, end, text) => ({ start, end, text });
const cfg = { endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-5.6-luna', key: '' };
const reply = data => Response.json({ choices: [{ message: { content: JSON.stringify(data) }, finish_reason: 'stop' }] });
const sentenceEnd = (source, text) => source.tokens.find(t => t.hi === source.text.indexOf(text) + text.length)?.id;

test('source indexing retains cue edges, Unicode and mixed-language names', () => {
  const source = indexSource([cue(1, 2, '今日は'), cue(2.4, 5, 'Mrs. GREEN APPLE'), cue(5, 7, 'を紹介します👩🏽‍💻')], 'ja');
  assert.equal(source.tokens[0].start, 1); assert.equal(source.tokens.at(-1).end, 7);
  const name = source.tokens.find(t => t.text === 'Mrs');
  assert.equal(name.start, 2.4);
  for (const token of source.tokens) {
    assert.equal(token.text.isWellFormed(), true);
    assert.equal(sourceRange(source, token.id, token.id).text, token.text);
    assert.ok(token.end > token.start);
  }
  assert.ok(source.tokens.some(t => t.text === '👩🏽‍💻'));
});

test('human-authored Japanese boundary fixture reconstructs exact sentences and timings', () => {
  // Boundary annotations are human-authored fixtures, not measurements of model accuracy.
  const phrases = ['おはようございます', 'かずきです', '今回はミセスグリーンアップルの曲を紹介します', '皆さん聞いたことありますか'];
  const session = new SemanticTimeline(phrases.map((text, i) => cue(i * 4, i * 4 + 4, text)), 'ja');
  const request = session.plan(0);
  const ends = phrases.map(p => sentenceEnd(session.source, p));
  assert.ok(ends.every(Number.isInteger));
  session.accept(request, { leadingEnd: -1, sentences: ends.map(end => ({ end, parts: [end] })) });
  assert.equal(session.complete, true);
  assert.deepEqual(session.timeline().map(s => s.text), phrases);
  assert.deepEqual(session.timeline().map(s => [s.start, s.end]), [[0, 4], [4, 8], [8, 12], [12, 16]]);
  assert.equal(session.timeline().map(s => s.text).join(''), session.source.text);
});

test('long semantic sentences remain whole, with display clauses rather than artificial sentences', () => {
  const text = 'Because the first experiment did not establish whether the change was useful, we repeated it with a larger sample and reported all of the results.';
  const session = new SemanticTimeline([cue(0, 20, text)], 'en');
  const comma = session.source.tokens.find(t => t.text === ',').id, last = session.source.tokens.at(-1).id;
  session.accept(session.plan(0), { leadingEnd: -1, sentences: [{ end: last, parts: [comma, last] }] });
  const [sentence] = session.timeline();
  assert.equal(sentence.text, text); assert.equal(sentence.end, 20); assert.equal(sentence.parts.length, 2);
  const pieces = displayGroups(sentence, '完整句译文', [{ from: 0, to: 0, translation: '第一个实验未能证明改动是否有用，' },
    { from: 1, to: 1, translation: '因此我们扩大样本重复实验，并报告了全部结果。' }], () => false);
  assert.equal(pieces.length, 2);
  assert.ok(pieces[1].start >= pieces[0].end);
  assert.equal(displayGroups(sentence, '', undefined, () => true).length, 1);
  assert.equal(displayGroups(sentence, '完整句译文', [{ from: 0, to: 1, translation: '合并后的自然译文' }]).length, 1);
  assert.equal(displayGroups(sentence, '完整句译文').length, 1, 'never proportionally split a translation before alignment');
});

test('overlapping windows defer the trailing sentence and restart at the last committed boundary', () => {
  const session = new SemanticTimeline(Array.from({ length: 100 }, (_, i) => cue(i * 2, i * 2 + 2, `word${i}`)), 'en');
  const first = session.plan(0);
  assert.equal(first.final, false);
  const cut = first.commitEnd - 3, lookaheadEnd = first.tokens.at(-1).id;
  session.accept(first, { leadingEnd: -1, sentences: [{ end: cut, parts: [cut] }, { end: lookaheadEnd, parts: [lookaheadEnd] }] });
  assert.equal(session.sentences.length, 1);
  const second = session.plan(55);
  assert.equal(second.tokens[0].id, cut + 1);
  assert.ok(second.tokens.some(t => t.id === lookaheadEnd));
  assert.equal(second.openLeft, false);
  assert.ok(second.before.includes(`word${cut}`));
});

test('seeking leaves partial left context unresolved; full processing later fills the gap without overlap', () => {
  const session = new SemanticTimeline(Array.from({ length: 120 }, (_, i) => cue(i * 2, i * 2 + 2, `word${i}`)), 'en');
  const request = session.plan(150);
  assert.equal(request.openLeft, true);
  const start = request.tokens[0].id;
  session.accept(request, { leadingEnd: start + 2, sentences: [{ end: request.commitEnd, parts: [request.commitEnd] }] });
  assert.ok(session.gaps().some(g => g.to === start + 2));
  const beginning = session.plan(0, true);
  assert.equal(beginning.openLeft, false);
  assert.equal(beginning.tokens[0].id, 0);
  assert.ok(beginning.tokens.at(-1).id < session.sentences[0].from);
  const fallbackText = session.timeline().map(s => s.text).join(' ').replace(/\s+/g, ' ').trim();
  assert.equal(fallbackText, session.source.text);
});

test('missing sentence boundary expands context once then stops without inventing a cutoff', () => {
  const session = new SemanticTimeline(Array.from({ length: 200 }, (_, i) => cue(i, i + 1, `word${i}`)), 'en');
  const a = session.plan(0);
  assert.equal(session.accept(a, { leadingEnd: -1, sentences: [] }), false);
  const b = session.plan(0);
  assert.ok(b.tokens.length > a.tokens.length);
  assert.throws(() => session.accept(b, { leadingEnd: -1, sentences: [] }), /No complete sentence/);
  assert.equal(session.sentences.length, 0);
});

test('invalid ranges, missing endings, omitted prefixes and mismatching indexed text are rejected', () => {
  const session = new SemanticTimeline([cue(0, 3, 'Hello world. Next sentence.')], 'en');
  const request = session.plan(0), last = request.tokens.at(-1).id;
  for (const result of [null, {}, { leadingEnd: 0, sentences: [{ end: last, parts: [last] }] },
    { leadingEnd: -1, sentences: [] }, { leadingEnd: -1, sentences: [{ end: last + 1, parts: [last + 1] }] },
    { leadingEnd: -1, sentences: [{ end: last, parts: [last, last] }] },
    { leadingEnd: -1, sentences: [{ end: last, parts: [0] }] }, { leadingEnd: -1, sentences: [{ end: String(last), parts: [last] }] }])
    assert.throws(() => validateBoundaries(request, result), /Semantic|semantic/);
  assert.throws(() => validateSemanticRequest({ ...request, text: 'Different content' }), /does not match/);
  assert.throws(() => validateAlignment(['a', 'b'], [{ from: 1, to: 1, translation: 'wrong' }]), /Invalid/);
  assert.throws(() => validateAlignment(['a', 'b'], [{ from: 0, to: 0, translation: 'incomplete' }]), /Incomplete/);
});

test('official provider uses strict boundary schema, repairs once, and never accepts model times or text', async () => {
  const input = new SemanticTimeline([cue(0, 3, 'Hello there.')], 'en').plan(0);
  const end = input.tokens.at(-1).id; let calls = 0;
  const result = await segmentSemantically(input, cfg, undefined, async (_, options) => {
    const body = JSON.parse(options.body); calls++;
    assert.equal(body.response_format.json_schema.strict, true);
    assert.equal(body.model, 'gpt-5.6-luna');
    assert.match(body.messages[0].content, /untrusted/);
    assert.deepEqual(JSON.parse(body.messages[1].content), input);
    return reply(calls === 1 ? { leadingEnd: -1, sentences: [] } : { leadingEnd: -1, sentences: [{ end, parts: [end] }] });
  });
  assert.equal(calls, 2); assert.equal(result.sentences[0].end, end);
  let failures = 0;
  await assert.rejects(segmentSemantically(input, cfg, undefined, async () => { failures++; return reply({}); }), /one repair/);
  assert.equal(failures, 2);
  let httpFailures = 0;
  await assert.rejects(segmentSemantically(input, cfg, undefined, async () => { httpFailures++; return new Response('', { status: 429 }); }), /quota/);
  assert.equal(httpFailures, 1);
});

test('alignment validates complete ordered coverage and permits merging clauses', async () => {
  const result = await alignTranslation({ source: 'en', target: 'zh', text: 'Hello there.', translation: '你好。', parts: ['Hello', 'there.'] }, cfg, undefined,
    async () => reply({ groups: [{ from: 0, to: 1, translation: '你好。' }] }));
  assert.equal(result.groups.length, 1);
});

test('cache identity includes semantic context, model, alignment and accepted translation references', async () => {
  const input = new SemanticTimeline([cue(0, 3, 'Hello there.')], 'en').plan(0);
  const first = await taskCacheKey('semantic-v1', input, 'ai', cfg);
  assert.notEqual(first, await taskCacheKey('semantic-v1', { ...input, after: 'New context' }, 'ai', cfg));
  assert.notEqual(first, await taskCacheKey('semantic-v1', input, 'ai', { ...cfg, model: 'different' }));
  const a = { batch: true, text: 'It is a bass.', source: 'en', target: 'zh', context: ['Music.'], references: [] };
  assert.notEqual(await cacheKey(a, 'ai', cfg), await cacheKey({ ...a, context: ['Fishing.'] }, 'ai', cfg));
  assert.notEqual(await cacheKey(a, 'ai', cfg), await cacheKey({ ...a, references: [{ source: 'bass', translation: '贝斯' }] }, 'ai', cfg));
});
