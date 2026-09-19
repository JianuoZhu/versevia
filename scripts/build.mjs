import { cp, mkdir, readFile, readdir, writeFile, rm, realpath, lstat } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
export async function buildExtension(directory = resolve(import.meta.dirname, '..')) {
  const root = await realpath(directory);
  const destination = resolve(root, 'dist');
  // Clean only this project's generated directory, never a linked external target.
  if (relative(root, destination) !== 'dist') throw new Error('Invalid build destination.');
  const existing = await lstat(destination).catch(error => { if (error.code !== 'ENOENT') throw error; });
  if (existing && (existing.isSymbolicLink() || await realpath(destination) !== destination)) throw new Error('dist must not be a link.');
  const manifest = JSON.parse(await readFile(resolve(root, 'extension/manifest.json'), 'utf8'));
  const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  if (manifest.version !== pkg.version) throw new Error('Package and extension versions must match.');
  await build({ entryPoints: [resolve(root, 'src/sabr-page.js')], outfile: resolve(root, 'extension/sabr-page.js'), bundle: true, format: 'iife', platform: 'browser', target: 'chrome116', minify: true, legalComments: 'inline' });
  await cp(resolve(root, 'node_modules/googlevideo/LICENSE'), resolve(root, 'extension/GOOGLEVIDEO-LICENSE.txt'));
  await cp(resolve(root, 'LICENSE'), resolve(root, 'extension/LICENSE.txt'));
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  await cp(resolve(root, 'extension'), destination, { recursive: true });
  const files = await readdir(destination);
  await writeFile(resolve(destination, 'BUILD.txt'), `${manifest.name} ${manifest.version}\nBuilt from extension/ using Node ${process.version}.\nLoad this directory as an unpacked extension.\n`);
  console.log(`Built ${files.length} entries in ${destination}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await buildExtension();
