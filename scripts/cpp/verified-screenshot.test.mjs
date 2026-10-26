import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { readStepScreenshot } from './verified-screenshot.mjs';

/** Creates one sealed current artifact and an unrelated retained screenshot. */
async function fixture(body) {
  const directory = await mkdtemp(join(tmpdir(), 'e2e-qt-artifacts-'));
  const artifacts = join(directory, 'artifacts');
  const bytes = Buffer.from('current screenshot bytes');
  const artifact = {
    id: 'capture', kind: 'screenshot', mediaType: 'image/png', redaction: 'complete',
    producer: { kind: 'step', stepId: 'screenshot-step' }, path: 'digest/current.png',
    size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  const attempt = { steps: [{ id: 'screenshot-step', api: 'app.screenshot', status: 'passed', artifacts: ['capture'] }], artifacts: [artifact] };
  try {
    await mkdir(join(artifacts, 'digest'), { recursive: true });
    await mkdir(join(artifacts, 'legacy'), { recursive: true });
    await writeFile(join(artifacts, artifact.path), bytes);
    await writeFile(join(artifacts, 'legacy', 'previous.png'), 'old screenshot');
    await body({ directory, artifacts, bytes, artifact, attempt });
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test('uses the current sealed screenshot and ignores unrelated retained PNGs', async () => {
  await fixture(async ({ attempt, artifacts, bytes }) => assert.deepEqual(await readStepScreenshot(attempt, artifacts), bytes));
});

test('rejects duplicate current screenshots or incorrect step ownership', async () => {
  await fixture(async ({ attempt, artifacts, artifact }) => {
    attempt.artifacts.push({ ...artifact, id: 'second' });
    await assert.rejects(readStepScreenshot(attempt, artifacts), /exactly one/);
    attempt.artifacts.pop();
    artifact.producer.stepId = 'another-step';
    await assert.rejects(readStepScreenshot(attempt, artifacts), /ownership/);
    artifact.producer.stepId = 'screenshot-step';
    attempt.steps[0].artifacts[0] = 'another-capture';
    await assert.rejects(readStepScreenshot(attempt, artifacts), /ownership/);
  });
});

test('rejects screenshots whose sealed size or hash differs', async () => {
  await fixture(async ({ attempt, artifacts, artifact, bytes }) => {
    artifact.size += 1;
    await assert.rejects(readStepScreenshot(attempt, artifacts), /sealed report/);
    artifact.size = bytes.length;
    await writeFile(join(artifacts, artifact.path), Buffer.alloc(bytes.length));
    await assert.rejects(readStepScreenshot(attempt, artifacts), /sealed report/);
  });
});

test('rejects absolute paths and parent traversal outside the artifact root', async () => {
  await fixture(async ({ directory, attempt, artifacts, artifact, bytes }) => {
    await writeFile(join(directory, 'outside.png'), bytes);
    artifact.path = '../outside.png';
    await assert.rejects(readStepScreenshot(attempt, artifacts), /escaped/);
    artifact.path = join(directory, 'outside.png');
    await assert.rejects(readStepScreenshot(attempt, artifacts), /Invalid Qt screenshot path/);
  });
});
