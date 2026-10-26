import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { SecretLedger } from '../../src/internal/redact.ts';
import { AttemptDiagnostics } from '../../src/run/attempt-diagnostics.ts';

/** Publishes one bounded diagnostics buffer in an isolated directory. */
async function publish(diagnostics: AttemptDiagnostics, ledger: SecretLedger, check: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'e2e-diagnostics-'));
  try {
    await diagnostics.publish({ dir, register: vi.fn(() => 'artifact') }, ledger.redact);
    await check(dir);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

describe('bounded diagnostics secrecy', () => {
  it('redacts a secret split across output callbacks and registered after capture', async () => {
    const diagnostics = new AttemptDiagnostics();
    diagnostics.appLog({ source: 'console', level: 'info', text: 'before sensitive-' });
    diagnostics.appLog({ source: 'console', level: 'info', text: 'late-value after' });
    const ledger = new SecretLedger([['token', 'sensitive-late-value']]);
    await publish(diagnostics, ledger, async (dir) => {
      expect(await readFile(path.join(dir, 'application.log'), 'utf8')).toBe('before <secret:token> after');
    });
  });

  it('discards all buffered output on overflow rather than persisting a secret prefix', async () => {
    const diagnostics = new AttemptDiagnostics();
    diagnostics.appLog({ source: 'console', level: 'info', text: 'sensitive-prefix-' });
    diagnostics.appLog({ source: 'console', level: 'info', text: 'x'.repeat(262_144) });
    await publish(diagnostics, new SecretLedger(), async (dir) => {
      const text = await readFile(path.join(dir, 'application.log'), 'utf8');
      expect(text).not.toContain('sensitive-prefix');
      expect(text).toContain('omitted');
    });
  });

  it('drops oversized metadata fields whole and redacts retained keys and values', async () => {
    const diagnostics = new AttemptDiagnostics();
    diagnostics.environment({ safe: '1', secret: 'sensitive-' + 'x'.repeat(2050), 'private-key': 'private-value' });
    await publish(diagnostics, new SecretLedger([['key', 'private-key'], ['value', 'private-value']]), async (dir) => {
      const text = await readFile(path.join(dir, 'environment.json'), 'utf8');
      expect(text).not.toContain('sensitive-');
      expect(text).not.toContain('private-');
      expect(JSON.parse(text)).toEqual({ safe: '1', '<secret:key>': '<secret:value>' });
    });
  });
});
