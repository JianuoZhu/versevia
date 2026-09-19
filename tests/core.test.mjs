import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCues, parseJson3, reconstructSentences, sentenceIndex, navigationTarget, isTypingEvent, validateEndpoint, transcriptionCues } from '../extension/core.js';
const cue = (start, end, text) => ({ start, end, text });
test('reconstructs fragmented captions and uses original timing', () => {
  const result = reconstructSentences([cue(1, 2, 'This is'), cue(2, 3, 'one sentence.'), cue(4, 5, 'Next sentence!')]);
  assert.deepEqual(result.map(s => [s.start, s.end, s.text]), [[1, 3, 'This is one sentence.'], [4, 5, 'Next sentence!']]);
});
test('multiple sentences in one cue receive separate proportional intervals', () => {
  const result = reconstructSentences([cue(0, 10, 'Hello. Goodbye!')]);
  assert.equal(result.length, 2); assert.equal(result[0].start, 0); assert.equal(result[1].end, 10);
  assert.ok(result[0].end <= result[1].start); assert.ok(result[1].start > 0);
});
test('abbreviations and decimal numbers do not split sentences', () => {
  const result = reconstructSentences([cue(0, 4, 'Dr. Smith paid 3.14 dollars.'), cue(4, 5, 'Really?')]);
  assert.deepEqual(result.map(s => s.text), ['Dr. Smith paid 3.14 dollars.', 'Really?']);
});
test('CJK punctuation works without spaces', () => {
  const result = reconstructSentences([cue(0, 6, '你好世界。今天好吗？')]);
  assert.deepEqual(result.map(s => s.text), ['你好世界。', '今天好吗？']);
});

test('Japanese fragments join without spaces and closing quotes stay with the sentence', () => {
  const result = reconstructSentences([cue(0, 1, '「これ'), cue(1, 2, 'はテストです。」次です！')], { language: 'ja' });
  assert.deepEqual(result.map(s => s.text), ['「これはテストです。」', '次です！']);
});

test('Arabic, Urdu, Hindi and Burmese terminal punctuation splits sentences', () => {
  for (const [language, text, expected] of [
    ['ar', 'كيف حالك؟أنا بخير.', ['كيف حالك؟', 'أنا بخير.']],
    ['ur', 'یہ ٹھیک ہے۔کیا حال ہے؟', ['یہ ٹھیک ہے۔', 'کیا حال ہے؟']],
    ['hi', 'यह पहला वाक्य है।यह दूसरा है॥', ['यह पहला वाक्य है।', 'यह दूसरा है॥']],
    ['my', 'မင်္ဂလာပါ။နေကောင်းလား။', ['မင်္ဂလာပါ။', 'နေကောင်းလား။']]
  ]) assert.deepEqual(reconstructSentences([cue(0, 8, text)], { language }).map(s => s.text), expected);
});

test('Cyrillic abbreviations, initials and decimal numbers are not sentence breaks', () => {
  const text = 'А. П. Чехов жил в г. Москве. Цена 3.14 рубля. Да!';
  assert.deepEqual(reconstructSentences([cue(0, 10, text)], { language: 'ru' }).map(s => s.text),
    ['А. П. Чехов жил в г. Москве.', 'Цена 3.14 рубля.', 'Да!']);
});

test('long unspaced Chinese, Japanese and Thai preserve text and valid timing', () => {
  for (const [language, text] of [['zh', '今天我们一起学习如何使用这个工具'.repeat(12)], ['ja', 'これは字幕の分割を確認するためのテストです'.repeat(8)],
    ['th', 'ภาษาไทยเป็นภาษาที่สวยงาม'.repeat(12)], ['zh', '𠀀你好世界'.repeat(40)]]) {
    const result = reconstructSentences([cue(2, 30, text)], { language, maxChars: 45 });
    assert.ok(result.length > 1); assert.equal(result.map(s => s.text).join(''), text);
    assert.equal(result[0].start, 2); assert.equal(result.at(-1).end, 30);
    for (let i = 0; i < result.length; i++) {
      assert.ok(result[i].text.length <= 45); assert.ok(result[i].end > result[i].start);
      assert.equal(result[i].text.isWellFormed(), true);
      if (i) assert.ok(result[i].start >= result[i - 1].end);
    }
  }
});

test('rolling unspaced captions remove overlapping repeated text only', () => {
  assert.deepEqual(normalizeCues([cue(0, 3, '你好世界'), cue(2, 4, '你好世界今天很好')]), [cue(0, 2, '你好世界'), cue(2, 4, '今天很好')]);
  assert.equal(normalizeCues([cue(0, 1, '你好'), cue(2, 3, '你好')]).length, 2);
  assert.deepEqual(reconstructSentences([cue(0, 1, '한국어'), cue(1, 2, '문장입니다.')], { language: 'ko' }).map(s => s.text), ['한국어 문장입니다.']);
});
test('long silences flush unpunctuated speech', () => {
  const result = reconstructSentences([cue(0, 2, 'first thought'), cue(8, 10, 'second thought')]);
  assert.equal(result.length, 2); assert.equal(result[0].end, 2);
});

test('unpunctuated Japanese captions stay readable and retain source cue boundaries', () => {
  // Transcribed from the screenshot; timings are a synthetic ASR fixture.
  const fragments = ['おはようございます', 'かずきです', '今回はミセスグリーンアップルの', 'かっこいいギターフレーズベスト５',
    'やっていきたいと思います', 'いやこの企画で特定のアーティストさんするの', '久しぶりですね',
    '皆さんミセス聞いてますでしょうか', '最近のバンドとかアーティストさんで', 'ギターがかっこいいのは誰って聞かれたらもう'];
  const cues = parseJson3({ events: [{ tStartMs: 0, dDurationMs: 18000,
    segs: fragments.map((utf8, i) => ({ utf8, tOffsetMs: i * 1800 })) }] });
  for (const language of ['ja', 'auto']) {
    const result = reconstructSentences(cues, { language });
    assert.ok(result.length >= 4);
    assert.equal(result.map(s => s.text).join('').replace(/\s/g, ''), fragments.join(''));
    for (const s of result) {
      assert.ok(s.text.length <= 48);
      assert.ok(s.end - s.start <= 7);
      assert.ok(cues.some(c => c.start === s.start));
      assert.ok(cues.some(c => c.end === s.end));
    }
    assert.ok(!result[sentenceIndex(result, 2)].text.includes('最近のバンド'));
    assert.equal(navigationTarget(result, 2, 1), result[1].start);
  }
});

test('short pauses separate unpunctuated thoughts without flushing every word', () => {
  const result = reconstructSentences([cue(0, 1, 'first'), cue(1, 2, 'thought'), cue(2.8, 4, 'next thought')]);
  assert.deepEqual(result.map(s => s.text), ['first thought', 'next thought']);
});

test('duration limit applies inside a single cue even below the character limit', () => {
  const text = '今日は字幕の時間を確認するためにゆっくり話しています';
  const result = reconstructSentences([cue(2, 30, text)], { language: 'ja' });
  assert.ok(result.length >= 4);
  assert.equal(result.map(s => s.text).join(''), text);
  assert.equal(result[0].start, 2); assert.equal(result.at(-1).end, 30);
  for (let i = 0; i < result.length; i++) {
    assert.ok(result[i].end - result[i].start <= 7 + 1e-9);
    if (i) assert.equal(result[i].start, result[i - 1].end);
  }
});
test('long sentences split at natural boundaries with continuous timing', () => {
  const text = 'We went to the market, and then we walked by the river, because it was a beautiful sunny day.';
  const result = reconstructSentences([cue(0, 12, text)], { maxChars: 45 });
  assert.ok(result.length >= 2); assert.equal(result.map(s => s.text).join(' ').replace(/\s+/g, ' '), text);
  assert.equal(result.at(-1).end, 12);
  for (let i = 1; i < result.length; i++) assert.ok(result[i].start >= result[i - 1].end);
});
test('rolling captions drop only overlapping repeated prefix', () => {
  assert.deepEqual(normalizeCues([cue(0, 3, 'hello world'), cue(2, 4, 'hello world again')]), [cue(0, 2, 'hello world'), cue(2, 4, 'again')]);
  assert.equal(normalizeCues([cue(0, 1, 'yes'), cue(2, 3, 'yes')]).length, 2);
});
test('JSON3 ignores metadata and respects word offsets', () => {
  const result = parseJson3({ events: [{ tStartMs: 0 }, { tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: 'Hello', tOffsetMs: 0 }, { utf8: ' world.', tOffsetMs: 500 }] }] });
  assert.deepEqual(result, [cue(1, 1.5, 'Hello'), cue(1.5, 3, 'world.')]);
});
test('lookup and navigation handle gaps, boundaries and timeline ends', () => {
  const lines = [cue(1, 3, 'a'), cue(4, 6, 'b'), cue(8, 10, 'c')];
  assert.equal(sentenceIndex(lines, 2), 0); assert.equal(sentenceIndex(lines, 3), -1); assert.equal(sentenceIndex(lines, 4), 1);
  assert.equal(navigationTarget(lines, 5, -1), 1); assert.equal(navigationTarget(lines, 5, 1), 8);
  assert.equal(navigationTarget(lines, 7, -1), 4); assert.equal(navigationTarget(lines, 7, 1), 8);
  assert.equal(navigationTarget(lines, 1, -1), null); assert.equal(navigationTarget(lines, 9, 1), null);
});
test('typing guard checks shadow composed path and interactive controls', () => {
  for (const el of [{ tagName: 'INPUT' }, { isContentEditable: true }, { getAttribute: () => 'slider' }, { tagName: 'SELECT' }, { tagName: 'BUTTON' }]) {
    assert.equal(isTypingEvent({ composedPath: () => [{ tagName: 'DIV' }, el] }), true);
  }
  assert.equal(isTypingEvent({ composedPath: () => [{ tagName: 'VIDEO' }] }), false);
});
test('remote endpoints require HTTPS and cannot embed secrets or redirects', () => {
  assert.equal(validateEndpoint('https://api.example.com/v1/chat/completions').origin, 'https://api.example.com');
  assert.equal(validateEndpoint('http://localhost:5000/translate').port, '5000');
  for (const value of ['http://example.com', 'https://user:secret@example.com', 'file:///tmp/a', 'https://example.com?key=x']) assert.throws(() => validateEndpoint(value));
});
test('transcription timestamps map to the captured part of the video', () => {
  const result = transcriptionCues({ segments: [{ start: 0, end: 2, text: 'Hello.' }, { start: 2, end: 8, text: 'Goodbye.' }] }, 120, 5);
  assert.deepEqual(result, [cue(120, 122, 'Hello.'), cue(122, 125, 'Goodbye.')]);
  assert.throws(() => transcriptionCues({ text: 'No timestamps' }, 0, 1), /timestamped/);
});
test('invalid and empty cues never become displayable sentences', () => {
  assert.deepEqual(reconstructSentences([cue(NaN, 1, 'bad'), cue(4, 2, 'bad'), cue(-1, 0, 'bad'), cue(1, 2, ' ')]), []);
});
