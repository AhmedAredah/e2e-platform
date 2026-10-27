/** Rejects skipped, broken-setup and incomplete-cleanup runs as qualification evidence. */
export function validateNativeReport(document, { expected, minimumResults = 1, failureTitle, failureOracle }) {
  const report = document.run;
  if (document.schemaVersion !== 'report-1' || report?.status !== expected || !Array.isArray(report.results)) {
    throw new Error('Native qualification report has an unexpected schema or verdict');
  }
  if (report.errors?.length) throw new Error('Unexpected run-level errors in native qualification');
  const selected = report.results.filter((result) => result.kind === 'test' && result.skip?.cause !== 'filtered');
  if (selected.length < minimumResults) throw new Error('Too few selected native qualification tests');
  for (const result of selected) {
    if (!result.attempts?.length) throw new Error('An intended native qualification test did not execute');
    for (const attempt of result.attempts) {
      if (attempt.cleanup !== 'complete' || attempt.secondaryErrors?.length) {
        throw new Error('Native qualification encountered failed or incomplete cleanup');
      }
    }
  }
  if (expected === 'passed') {
    if (selected.some((result) => result.status !== 'passed')) throw new Error('Positive native qualification contained a non-passing result');
  } else if (expected === 'failed') {
    const failed = selected.filter((result) => result.status !== 'passed');
    if (failed.length !== 1 || failed[0].status !== 'failed' || failed[0].attempts.length !== 1) {
      throw new Error('The planted defect must be the only failure, with no retry or skip');
    }
    const attempt = failed[0].attempts[0];
    if (failed[0].titlePath.at(-1) !== failureTitle || attempt.error?.code !== 'ASSERTION_FAILED' || attempt.error.category !== 'test'
      || typeof failureOracle !== 'string' || !/^\[oracle:[a-z0-9-]+\]$/.test(failureOracle)
      || !attempt.error.message?.includes(failureOracle)) {
      throw new Error('The intended planted-defect assertion did not fail');
    }
  } else {
    throw new Error('Native qualification requires an explicit passed or failed verdict');
  }
  return report;
}
