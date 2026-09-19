import { DEFAULTS } from '/extension/config.js';
import { translate } from '/extension/providers.js';
import { indexSource } from '/extension/semantic.js';
const semanticDemo = new URLSearchParams(location.search).has('semantic');
let preferences = { ...DEFAULTS, semanticSegmentation: semanticDemo, mode: 'bilingual', engine: 'ai', ...(semanticDemo ? { targetLanguage: 'zh' } : {}) };
const semanticPhrases = ['おはようございます', 'かずきです', '今回はミセスグリーンアップルのかっこいいギターフレーズを紹介しますので最後まで見ていただけるとうれしいです', '皆さんこの曲を聞いたことがありますか'];
const semanticCues = semanticPhrases.map((text, i) => ({ text, start: [0, 2, 4, 14][i], end: [2, 4, 14, 18][i] }));
const semanticSource = indexSource(semanticCues, 'ja');
const semanticEnds = semanticPhrases.map(p => semanticSource.tokens.find(t => t.hi === semanticSource.text.indexOf(p) + p.length).id);
const semanticClause = semanticSource.tokens.find(t => t.hi === semanticSource.text.indexOf('ので') + 2).id;
const semanticReplies = ['大家早上好', '我是 Kazuki', '这次为大家介绍 Mrs. GREEN APPLE 的精彩吉他乐句，希望大家能看到最后。', '大家听过这首歌吗？'];
let liveMT = false;
const listeners = [];
const replies = new Map([
  ['Every new language opens a different way of seeing the world.', 'Cada nuevo idioma abre una forma diferente de ver el mundo.'],
  ['A complete thought is easier to understand than a handful of fragments.', 'Un pensamiento completo es más fácil de entender que un puñado de fragmentos.'],
  ['Take your time, and move forward one sentence at a time.', 'Tómate tu tiempo y avanza una frase a la vez.'],
  ['You can always go back to hear something again.', 'Siempre puedes volver para escuchar algo de nuevo.']
]);
globalThis.chrome = { runtime: { id: 'lab', onMessage: { addListener: fn => listeners.push(fn) }, sendMessage: async message => {
  if (message.type === 'get-preferences') return { ok: true, preferences };
  if (message.type === 'set-preferences') { preferences = { ...preferences, ...message.preferences }; listeners.forEach(fn => fn({ type: 'preferences-changed', preferences }, { id: 'lab' }, () => {})); return { ok: true, preferences }; }
  if (message.type === 'segment-subtitles') {
    if (!semanticDemo) return { ok: false, error: 'Open the semantic fixture to simulate this workflow.' };
    return { ok: true, result: { leadingEnd: message.input.tokens[0].id - 1,
      sentences: semanticEnds.filter(end => end >= message.input.tokens[0].id && end <= message.input.tokens.at(-1).id)
        .map(end => ({ end, parts: end === semanticEnds[2] ? [semanticClause, end] : [end] })) } };
  }
  if (message.type === 'align-subtitle') return { ok: true, result: { groups: [{ from: 0, to: 0, translation: '这次为大家介绍 Mrs. GREEN APPLE 的精彩吉他乐句，' }, { from: 1, to: 1, translation: '希望大家能看到最后。' }] } };
  if (message.type === 'translate-batch') return { ok: true, translations: message.sentences.map(s => ({ id: s.id, translation: semanticDemo ? semanticReplies[semanticPhrases.indexOf(s.text)] : replies.get(s.text) || '[Local fixture translation]' })) };
  if (message.type === 'translate') {
    if (liveMT) {
      try { return { ok: true, text: await translate({ ...message, target: preferences.targetLanguage }, 'mymemory', { endpoint: 'https://api.mymemory.translated.net/get', key: '', model: '' }, AbortSignal.timeout(25000)) }; }
      catch (error) { return { ok: false, error: error.message }; }
    }
    return { ok: true, text: replies.get(message.text) || '[Local fixture translation]' };
  }
  return { ok: true };
} } };
window.addEventListener('message', event => {
  const m = event.data; if (event.source !== window || m?.channel !== 'sentence-youtube-v1' || m.direction !== 'request') return;
  const data = m.type === 'discover' ? { ready: true, tracks: semanticDemo ? [{ id: 'a.ja', language: 'ja', label: 'Japanese', kind: 'automatic', isDefault: true }] : [{ id: '.en', language: 'en', label: 'English', kind: 'creator', isDefault: true }, { id: 'a.en', language: 'en', label: 'English', kind: 'automatic' }] } : semanticDemo ?
    { body: JSON.stringify({ events: semanticCues.map(c => ({ tStartMs: c.start * 1000, dDurationMs: (c.end - c.start) * 1000, segs: [{ utf8: c.text }] })) }) } :
    { body: JSON.stringify({ events: [
      { tStartMs: 0, dDurationMs: 3000, segs: [{ utf8: 'Every new language opens' }] },
      { tStartMs: 3000, dDurationMs: 5000, segs: [{ utf8: 'a different way of seeing the world.' }] },
      { tStartMs: 9000, dDurationMs: 9000, segs: [{ utf8: 'A complete thought is easier to understand than a handful of fragments.' }] },
      { tStartMs: 19000, dDurationMs: 9000, segs: [{ utf8: 'Take your time, and move forward one sentence at a time.' }] },
      { tStartMs: 30000, dDurationMs: 8000, segs: [{ utf8: 'You can always go back to hear something again.' }] }
    ] }) };
  window.postMessage({ ...data, channel: m.channel, direction: 'response', requestId: m.requestId, videoId: m.videoId }, location.origin);
});
const video = document.querySelector('video');
if (semanticDemo) {
  document.getElementById('lab-description').textContent = 'SEMANTIC PIPELINE FIXTURE: Japanese captions with hand-authored sentence boundaries and Chinese translations. Production player code; simulated model responses and timing. No AI provider is called.';
  document.getElementById('live-translation').hidden = true;
  const clauseButton = document.createElement('button'); clauseButton.textContent = 'Go to long sentence';
  clauseButton.onclick = () => { video.currentTime = 5; video.pause(); };
  document.getElementById('seek').after(clauseButton);
}
document.getElementById('live-translation').onclick = () => {
  liveMT = true; preferences = { ...preferences, engine: 'mymemory', mode: 'bilingual', targetLanguage: 'es' };
  document.getElementById('lab-description').textContent = 'LIVE TRANSLATION: these public demo sentences are sent to the real MyMemory API. The caption timeline and extension messaging remain local fixtures. No API key is used.';
  listeners.forEach(fn => fn({ type: 'preferences-changed', preferences, providerChanged: true }, { id: 'lab' }, () => {}));
};
document.getElementById('seek').onclick = () => { video.currentTime = 1; document.getElementById('movie_player').focus(); };
document.getElementById('navigate').onclick = () => {
  history.pushState({}, '', location.search.includes('abcdefghijk') ? '/watch?v=lmnopqrstuv' : '/watch?v=abcdefghijk');
  document.dispatchEvent(new Event('yt-navigate-finish'));
};
document.getElementById('fullscreen').onclick = () => document.getElementById('movie_player').requestFullscreen();
setInterval(() => {
  document.getElementById('snapshot').textContent = `Playback: ${video.paused ? 'paused' : 'playing'}  ·  Time: ${video.currentTime.toFixed(2)} s  ·  Rate: ${video.playbackRate}×\nOverlay: ${preferences.enabled ? 'enabled' : 'disabled'}  ·  Mode: ${preferences.mode}  ·  Source: ${preferences.sourceKind}`;
}, 200);
await import('/extension/content.js');
