import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const moduleUrl = new URL('./completion-guard.mjs', import.meta.url).href;

/** Runs the lifecycle in its own Node process so test-runner handles cannot hide unresolved work. */
function controller(body) {
  const code = `import { VerificationCompletionGuard } from ${JSON.stringify(moduleUrl)}; const guard = new VerificationCompletionGuard(); ${body}`;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', code], { encoding: 'utf8', timeout: 10_000 });
  if (result.error) throw result.error;
  return result;
}

test('fails nonzero when an awaited operation never settles and no handles remain', () => {
  const result = controller('await new Promise(() => {}); guard.complete();');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ended before completion/);
});

test('permits a completed verifier to exit successfully', () => {
  const result = controller('await Promise.resolve(); guard.complete();');
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
});

test('preserves an existing failure code instead of overwriting its diagnosis', () => {
  const result = controller('process.exitCode = 2;');
  assert.equal(result.status, 2);
  assert.equal(result.stderr, '');
});
