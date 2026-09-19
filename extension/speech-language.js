const names = { english: 'en', russian: 'ru', japanese: 'ja', chinese: 'zh', spanish: 'es', french: 'fr', german: 'de', korean: 'ko', portuguese: 'pt', italian: 'it', arabic: 'ar', hindi: 'hi', ukrainian: 'uk', dutch: 'nl', polish: 'pl', turkish: 'tr', vietnamese: 'vi', thai: 'th', indonesian: 'id', hebrew: 'he' };
export function speechLanguage(value) {
  if (typeof value !== 'string') return 'auto';
  const s = value.trim().toLowerCase();
  return names[s] || (/^[a-z]{2,3}(?:-[a-z0-9]+)*$/.test(s) && s !== 'auto' && s !== 'und' ? s.split('-')[0] : 'auto');
}
export function recognitionLanguage(requested, track) {
  const choice = speechLanguage(requested), actual = speechLanguage(track);
  if (choice !== 'auto' && actual !== 'auto' && choice !== actual) throw new Error(`Selected audio is ${actual}, but source language is ${choice}. Select the matching YouTube audio track or change Source language.`);
  return choice === 'auto' ? actual : choice;
}
export function transcriptionLanguage(data, expected) {
  const requested = speechLanguage(expected), reported = speechLanguage(data?.language);
  if (requested !== 'auto' && reported !== 'auto' && requested !== reported) throw new Error(`Speech service returned ${reported} for ${requested} audio. Subtitles were not saved. Check the speech model and source language, then retry.`);
  // A service may label its response English while returning mostly Cyrillic text.
  // Only flag a strong mismatch, not a name, quotation or isolated loanword.
  if (requested === 'en') {
    const text = (data?.segments || []).map(s => s.text || '').join('');
    const letters = text.match(/\p{L}/gu) || [], cyrillic = text.match(/\p{Script=Cyrillic}/gu) || [];
    if (letters.length >= 24 && cyrillic.length / letters.length > 0.8) throw new Error('Speech service returned predominantly Cyrillic text for English audio. Subtitles were not saved. Check the speech model and retry.');
  }
  return requested === 'auto' ? reported : requested;
}
export function audioIdentity(source) {
  return typeof source?.trackId === 'string' && source.trackId.length <= 512 ? source.trackId : '';
}
