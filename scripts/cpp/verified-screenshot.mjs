import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

/** Reads only the current report's step-owned screenshot, verifying its sealed bytes. */
export async function readStepScreenshot(attempt, directory) {
  const steps = attempt.steps.filter((step) => step.api === 'app.screenshot' && step.status === 'passed');
  const captures = attempt.artifacts.filter((artifact) => artifact.kind === 'screenshot');
  if (steps.length !== 1 || steps[0].artifacts.length !== 1 || captures.length !== 1) throw new Error('Expected exactly one current explicit Qt screenshot');
  const artifact = captures[0];
  if (steps[0].artifacts[0] !== artifact.id || artifact.producer?.kind !== 'step' || artifact.producer.stepId !== steps[0].id
    || artifact.redaction !== 'complete' || artifact.mediaType !== 'image/png') throw new Error('Qt screenshot ownership or masking attestation is invalid');
  if (typeof artifact.path !== 'string' || isAbsolute(artifact.path) || artifact.path.includes('\0')) throw new Error('Invalid Qt screenshot path');
  const root = await realpath(directory);
  const file = await realpath(resolve(root, artifact.path));
  const local = relative(root, file);
  if (local === '' || local === '..' || local.startsWith('../') || local.startsWith('..\\') || isAbsolute(local)) throw new Error('Qt screenshot escaped its artifact directory');
  const bytes = await readFile(file);
  if (bytes.byteLength !== artifact.size || createHash('sha256').update(bytes).digest('hex') !== artifact.sha256) throw new Error('Qt screenshot differs from the sealed report artifact');
  return bytes;
}
