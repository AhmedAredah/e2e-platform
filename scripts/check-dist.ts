/** Refuses incomplete, stale, altered, or unexpectedly extended package builds. */
import { verifyBuild } from './dist-integrity.mjs';

try { verifyBuild(); }
catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
