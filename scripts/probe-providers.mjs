import { translate } from '../extension/providers.js';
const result = await translate({ text: 'Hello, world.', source: 'en', target: 'es' }, 'mymemory',
  { endpoint: 'https://api.mymemory.translated.net/get', key: '', model: '' }, AbortSignal.timeout(20000));
console.log(JSON.stringify({ provider: 'MyMemory', input: 'Hello, world.', translation: result }));
