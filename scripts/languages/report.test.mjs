import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateLanguageReport } from './report.mjs';

/** Creates an independent example of the report contract, including all required language/scenario pairs. */
function report(negative) {
  const titles = negative ? ['rejects the planted CLI wrong result', 'rejects the planted HTTP wrong result'] : ['CLI returns independently checked arithmetic', 'CLI rejects malformed operands with a nonzero exit', 'HTTP returns checked arithmetic and rejects malformed requests'];
  const status = negative ? 'failed' : 'passed';
  return {schemaVersion: 'report-1', run: {status, errors: [], results: ['python', 'dotnet', 'rust'].flatMap(targetId => titles.map(title => ({kind: 'test', targetId, titlePath: [title], status, attempts: [{status, cleanup: 'complete', secondaryErrors: [], ...(negative ? {error: {category: 'test', code: 'ASSERTION_FAILED'}} : {})}]})))}};
}

test('accepts complete positive and independently rejected negative coverage', () => {
  assert.equal(validateLanguageReport(report(false), false), 9);
  assert.equal(validateLanguageReport(report(true), true), 6);
});
for (const [name, mutate] of [
  ['missing runtime', document => document.run.results.splice(0, 2)],
  ['duplicate CLI replacing HTTP', document => {document.run.results[1].titlePath = document.run.results[0].titlePath;}],
  ['skipped negative', document => {document.run.results[0].status = 'skipped';}],
  ['infrastructure failure', document => {document.run.results[0].attempts[0].error = {category: 'infrastructure', code: 'ENGINE_FAILURE'};}],
  ['cleanup failure', document => {document.run.results[0].attempts[0].cleanup = 'failed';}],
  ['secondary cleanup error', document => {document.run.results[0].attempts[0].secondaryErrors.push({code: 'PROCESS_CLEANUP_FAILED'});}],
  ['contradictory attempt status', document => {document.run.results[0].attempts[0].status = 'passed';}],
  ['retry', document => {document.run.results[0].attempts.push(document.run.results[0].attempts[0]);}],
  ['run-level error', document => {document.run.errors.push({code: 'CONFIG_LOAD_FAILED'});}],
]) {
  test(`rejects ${name} as qualification evidence`, () => {
    const document = report(true); mutate(document);
    assert.throws(() => validateLanguageReport(document, true));
  });
}
test('rejects a renamed positive scenario that would otherwise preserve counts', () => {
  const document = report(false); document.run.results[2].titlePath = ['another CLI test'];
  assert.throws(() => validateLanguageReport(document, false));
});
