/** Requires every intended scenario to execute exactly once with settled cleanup. */
export function validateLanguageReport(document, negative) {
  const run = document.run;
  if (document.schemaVersion !== 'report-1' || run?.status !== (negative ? 'failed' : 'passed') || !Array.isArray(run.results) || run.errors?.length) throw new Error('Invalid language run report');
  const selected = run.results.filter(item => item.kind === 'test' && item.skip?.cause !== 'filtered');
  if (selected.length !== (negative ? 6 : 9)) throw new Error(`Expected ${negative ? 6 : 9} executed results, received ${selected.length}`);
  const titles = negative
    ? ['rejects the planted CLI wrong result', 'rejects the planted HTTP wrong result']
    : ['CLI returns independently checked arithmetic', 'CLI rejects malformed operands with a nonzero exit', 'HTTP returns checked arithmetic and rejects malformed requests'];
  const expectedCases = new Set(['python', 'dotnet', 'rust'].flatMap(language => titles.map(title => `${language}\0${title}`)));
  for (const item of selected) {
    if (!expectedCases.delete(`${item.targetId}\0${item.titlePath.at(-1)}`)) throw new Error('Duplicate or unexpected language/scenario pair in verification');
    if (item.status !== (negative ? 'failed' : 'passed') || item.attempts?.length !== 1) throw new Error('Unexpected skipped, retried or incomplete result');
    const attempt = item.attempts[0];
    if (attempt.status !== (negative ? 'failed' : 'passed') || (!negative && attempt.error !== undefined)) throw new Error('Attempt outcome contradicts the intended result');
    if (attempt.cleanup !== 'complete' || attempt.secondaryErrors?.length) throw new Error('Application cleanup did not complete');
    if (negative && (attempt.error?.code !== 'ASSERTION_FAILED' || attempt.error.category !== 'test')) throw new Error('A negative run failed for a reason other than its planted wrong result');
  }
  if (expectedCases.size !== 0) throw new Error('A required language/scenario pair did not run');
  return selected.length;
}
