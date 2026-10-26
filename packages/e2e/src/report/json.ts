/** The built-in `json` reporter: the report document to stdout, and nothing else there. */

import type { Reporter } from '../types.ts';
import { writeStructuredOutput } from '../internal/output-redaction.ts';

export const jsonReporter: Reporter = {
  name: 'json',
  async onRunFinished(run) {
    writeStructuredOutput(process.stdout, `${JSON.stringify(run.report, null, 2)}\n`);
  },
};
