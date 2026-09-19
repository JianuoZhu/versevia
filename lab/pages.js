// Standalone visual fixture. No real Chrome APIs, credentials, audio or network providers.
import { DEFAULTS, PROVIDERS, sanitizePreferences } from '../extension/config.js';
const view = new URL(location.href).searchParams.get('view') === 'popup' ? 'popup' : 'options';
const html = new DOMParser().parseFromString(await (await fetch(`/extension/${view}.html`)).text(), 'text/html');
html.querySelectorAll('script').forEach(el => el.remove());
html.querySelector('link[rel=stylesheet]').href = '/extension/theme.css';
if (html.querySelector('link[rel=icon]')) html.querySelector('link[rel=icon]').href = '/extension/icons/sentence-32.png';
document.head.replaceChildren(...html.head.childNodes);
document.body.className = html.body.className;
document.body.replaceChildren(...html.body.childNodes);
const banner = document.createElement('p'); banner.className = 'notice';
banner.textContent = 'LOCAL UI FIXTURE · No actual extension connection. Do not enter credentials. Changes last only until reload. Audio capture and provider requests are unavailable.';
document.querySelector('main').prepend(banner);
let prefs = { ...DEFAULTS, theme: 'mint' };
window.chrome = {
  runtime: {
    id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    getURL: path => `/extension/${path}`,
    openOptionsPage: async () => { location.href = '/lab/pages.html'; },
    sendMessage: async m => {
      if (m.type === 'get-preferences') return { ok: true, preferences: prefs };
      if (m.type === 'set-preferences') { prefs = sanitizePreferences({ ...prefs, ...m.preferences }); return { ok: true, preferences: prefs }; }
      if (m.type === 'get-providers') return { ok: true, providers: structuredClone(PROVIDERS) };
      if (m.type === 'capture-state') return { ok: true };
      if (m.type === 'speech-readiness') return { ok: true, ready: false, message: 'Demo only. Connect a speech service in the installed extension.' };
      return { ok: false, error: 'This UI fixture does not connect providers or record audio.' };
    }
  },
  permissions: { request: async () => false },
  tabs: {
    query: async () => [{ id: 1, url: 'https://www.youtube.com/watch?v=abcdefghijk' }],
    create: async () => { location.href = '/lab/pages.html?provider=asr'; },
    sendMessage: async () => ({ videoId: 'abcdefghijk', enabled: true, paused: false, rate: 1, duration: 300, status: 'Demo playback · no actual YouTube connection.' })
  }
};
await import(`/extension/${view}.js`);
