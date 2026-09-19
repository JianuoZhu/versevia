import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
for (const args of [['--long'], ['--alignment'], ['--seek'], ['--seek', '--full'], ['--reindex']]) {
  test(`production subtitle scheduling ${args.join(' ')}`, () => {
    const result = spawnSync(process.execPath, ['scripts/probe-subtitle-latency.mjs', ...args], { encoding: 'utf8', timeout: 15000 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });
}
