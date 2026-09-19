import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
for (const folder of ['extension', 'src', 'scripts', 'tests', 'lab']) {
  for (const file of await readdir(resolve(root, folder))) {
    if (!/\.m?js$/.test(file)) continue;
    const result = spawnSync(process.execPath, ['--check', resolve(root, folder, file)], { encoding: 'utf8' });
    if (result.status !== 0) { console.error(result.error?.message || result.stderr); process.exitCode = 1; }
  }
}
if (!process.exitCode) console.log('JavaScript syntax checks passed.');
