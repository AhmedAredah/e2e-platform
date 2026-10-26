/** Prevents an unresolved controller promise from turning an unfinished verification into exit zero. */
export class VerificationCompletionGuard {
  #complete = false;

  constructor() {
    process.once('beforeExit', () => {
      if (!this.#complete && (process.exitCode === undefined || Number(process.exitCode) === 0)) {
        process.stderr.write('C++ verification ended before completion; no successful qualification was recorded.\n');
        process.exitCode = 1;
      }
    });
  }

  /** Call only after all checks, summary persistence and the final success message. */
  complete() { this.#complete = true; }
}
