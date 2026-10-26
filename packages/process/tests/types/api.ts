import { ProcessRunner, runProcess, startProcess, type ProcessOptions, type ProcessSession } from '../../src/index.ts';
import { test } from '../../src/test.ts';

class AlternateSupervisor extends ProcessRunner {
  override start(options: ProcessOptions): Promise<ProcessSession> { return startProcess(options); }
}

void new AlternateSupervisor();
void runProcess({ executable: 'solver', args: ['--help'], expectedExitCodes: [0, 2], stdin: new Uint8Array([0, 255]) });
// @ts-expect-error Shell commands must not become an execution capability.
void runProcess({ executable: 'solver', shell: true });
// @ts-expect-error Arguments remain strings, never inferred shell fragments or numbers.
void startProcess({ executable: 'solver', args: [123] });
test('typed process fixture', async ({ processes }) => {
  const result = await processes.run({ executable: 'solver', cwd: processes.directory });
  const bytes: Buffer = result.stdout.bytes;
  void bytes;
});
