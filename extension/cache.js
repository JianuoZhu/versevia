import { AI_ENGINES } from './catalog.js';
export const CACHE_LIMIT = 10000;
export const CACHE_TTL = 30 * 86400000;
// IndexedDB is extension-origin-only. No credentials are stored in cache keys.
let database;
function db() {
  return database ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('sentence-translations', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('translations', { keyPath: 'key' }).createIndex('updated', 'updated');
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
}
export async function cacheKey(input, engine, config) {
  const bytes = new TextEncoder().encode(JSON.stringify({ v: input.batch ? 3 : 1, engine, endpoint: config.endpoint, model: config.model,
    source: input.source, target: input.target, text: input.text, before: [...AI_ENGINES, 'deepl'].includes(engine) ? input.before : '', after: [...AI_ENGINES, 'deepl'].includes(engine) ? input.after : '',
    context: AI_ENGINES.includes(engine) ? input.context : undefined, references: AI_ENGINES.includes(engine) ? input.references : undefined }));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
}
export async function taskCacheKey(task, input, engine, config) {
  const bytes = new TextEncoder().encode(JSON.stringify({ task, input, engine, endpoint: config.endpoint, model: config.model }));
  return `${task}:` + [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
}
export async function cacheGet(key) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const request = database.transaction('translations').objectStore('translations').get(key);
    request.onsuccess = () => resolve(request.result && Date.now() - request.result.updated < CACHE_TTL ? request.result.text : undefined);
    request.onerror = () => reject(request.error);
  });
}
export async function cachePut(key, text) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('translations', 'readwrite'), store = tx.objectStore('translations');
    store.put({ key, text, updated: Date.now() });
    const count = store.count();
    count.onsuccess = () => {
      let remove = count.result - CACHE_LIMIT;
      const cursor = store.index('updated').openCursor();
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (c && (remove > 0 || c.value.updated < Date.now() - CACHE_TTL)) { c.delete(); remove--; c.continue(); }
      };
    };
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  });
}
export async function cacheClear() {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('translations', 'readwrite'); tx.objectStore('translations').clear();
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
  });
}
