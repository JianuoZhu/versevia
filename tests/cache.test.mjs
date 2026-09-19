import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { cacheGet, cachePut, cacheClear, CACHE_LIMIT } from '../extension/cache.js';
test('persistent cache supports hits, replacement, pruning and explicit deletion', async () => {
  await cacheClear(); assert.equal(await cacheGet('missing'), undefined);
  await cachePut('sample', 'Hola'); assert.equal(await cacheGet('sample'), 'Hola');
  await cachePut('sample', 'Hola de nuevo'); assert.equal(await cacheGet('sample'), 'Hola de nuevo');
  // Force an older record to exercise TTL on retrieval.
  const database = await new Promise((resolve, reject) => { const request = indexedDB.open('sentence-translations', 1); request.onsuccess = () => resolve(request.result); request.onerror = reject; });
  await new Promise(resolve => {
    const tx = database.transaction('translations', 'readwrite');
    tx.objectStore('translations').put({ key: 'expired', text: 'old', updated: 0 }); tx.oncomplete = resolve;
  });
  assert.equal(await cacheGet('expired'), undefined);
  await new Promise(resolve => {
    const tx = database.transaction('translations', 'readwrite');
    for (let i = 0; i < CACHE_LIMIT; i++) tx.objectStore('translations').put({ key: `k${i}`, text: String(i), updated: Date.now() + i });
    tx.oncomplete = resolve;
  });
  await cachePut('newest', 'new');
  const count = await new Promise(resolve => { const request = database.transaction('translations').objectStore('translations').count(); request.onsuccess = () => resolve(request.result); });
  assert.equal(count, CACHE_LIMIT);
  await cacheClear(); assert.equal(await cacheGet('newest'), undefined); database.close();
});
