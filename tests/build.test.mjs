import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildExtension } from '../scripts/build.mjs';

test('rebuild removes obsolete output and rejects mismatched release versions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sentence-build-'));
  for (const folder of ['src', 'extension', 'node_modules/googlevideo', 'dist']) await mkdir(join(root, folder), { recursive: true });
  await writeFile(join(root, 'package.json'), JSON.stringify({ version: '1.5.3' }));
  await writeFile(join(root, 'extension/manifest.json'), JSON.stringify({ name: 'Fixture', version: '1.5.3' }));
  await writeFile(join(root, 'src/sabr-page.js'), 'globalThis.fixture = true;');
  await writeFile(join(root, 'node_modules/googlevideo/LICENSE'), 'fixture license');
  await writeFile(join(root, 'LICENSE'), 'project license');
  await writeFile(join(root, 'dist/obsolete-secret.txt'), 'must not ship');
  await buildExtension(root);
  await assert.rejects(access(join(root, 'dist/obsolete-secret.txt')), { code: 'ENOENT' });
  assert.match(await readFile(join(root, 'dist/sabr-page.js'), 'utf8'), /fixture/);
  assert.match(await readFile(join(root, 'dist/BUILD.txt'), 'utf8'), /1\.5\.3/);
  await writeFile(join(root, 'package.json'), JSON.stringify({ version: '1.5.4' }));
  await assert.rejects(buildExtension(root), /versions must match/);
});
