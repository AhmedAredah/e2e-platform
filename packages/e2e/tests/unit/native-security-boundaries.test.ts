/** Independent regressions for the MIT fork's runner-owned secret boundaries. */
import { mkdtemp, readFile, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatNode, prepareObservation, projectTree } from '../../src/agent/observation.ts';
import type { SemanticNode } from '../../src/engine/surface.ts';
import { processSecrets, SecretLedger } from '../../src/internal/redact.ts';
import { StreamingRedactor } from '../../src/internal/output-redaction.ts';
import { classifyError, serializeError } from '../../src/internal/errors.ts';
import { createAttemptArtifacts } from '../../src/run/artifacts.ts';
import { restoreProtection, snapshotProtection } from '../../src/run/secrecy.ts';
import { ManagedProcess } from '../../src/run/managed-process.ts';
import { SessionStore, type SessionIdentity } from '../../src/run/sessions.ts';

const SENTINEL = 'native-audit-secret-Xy8Z7-3841';
const identity: SessionIdentity = { targetId: 'native', engineName: 'test', engineVersion: '1', spiVersion: 1, platform: 'native', appIdentity: 'identity' };

it('redacts every semantic prose field before normalization and rejects secret-bearing references', () => {
  const whitespaceSecret = 'secret\nwith  spaces';
  const ledger = new SecretLedger([['password', SENTINEL], ['spaced', whitespaceSecret]]);
  const node: SemanticNode = { ref: { id: 'n1', revision: 'r1' }, role: SENTINEL, name: SENTINEL, text: whitespaceSecret,
    value: SENTINEL, testId: SENTINEL, attributes: { [SENTINEL]: SENTINEL }, framePath: [SENTINEL] };
  const text = formatNode(node, 0, ledger.redact);
  expect(text).not.toContain(SENTINEL);
  expect(text).not.toContain('secret with spaces');
  expect(JSON.stringify(projectTree(node, ledger.redact))).not.toContain(SENTINEL);
  expect(() => formatNode({ ...node, ref: { id: SENTINEL, revision: 'r1' } }, 0, ledger.redact)).toThrow('identity contains');
  const prepared = prepareObservation({ kind: 'semantic', truncated: false, tree: { ...node, name: 'x'.repeat(100_000) }, root: node.ref,
    revision: 'r1', capturedAt: '', viewport: { width: 1, height: 1 }, redaction: { secureNodeCount: 0, maskedRegionCount: 0 } },
  { redact: ledger.redact, maxBytes: 256 });
  expect(Buffer.byteLength(prepared.text)).toBeLessThanOrEqual(256);
});

describe('streaming output', () => {
  it('redacts each possible split of a Unicode and multiline secret', () => {
    for (const value of [SENTINEL, 'alpha\nbeta', 'secrét🦊終']) {
      const bytes = Buffer.from(`before ${value} after`);
      for (let split = 0; split <= bytes.length; split++) {
        const stream = new StreamingRedactor(new SecretLedger([['token', value]]));
        const output = stream.write(bytes.subarray(0, split)) + stream.write(bytes.subarray(split)) + stream.flush();
        expect(output).toBe('before <secret:token> after');
      }
    }
  });
  it('emits self-overlapping secrets incrementally without retaining an unbounded suffix', () => {
    const stream = new StreamingRedactor(new SecretLedger([['token', 'aa']]));
    for (let index = 0; index < 100; index++) {
      const output = stream.write('a'.repeat(1000));
      expect(output.length).toBeGreaterThan(0);
      expect(output).not.toContain('aa');
    }
    expect(stream.flush()).toBe('<secret:token>');
  });
  it('supports newly registered values and never injects a secret through its name', () => {
    const ledger = new SecretLedger();
    const stream = new StreamingRedactor(ledger);
    expect(stream.write('ordinary')).toBe('ordinary');
    ledger.register(SENTINEL, SENTINEL);
    expect(stream.write(SENTINEL.slice(0, 8)) + stream.write(SENTINEL.slice(8)) + stream.flush()).not.toContain(SENTINEL);
  });
});

it('encrypts protection with session state and restores both ledger history and pixel taint', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'native-session-protection-'));
  const store = SessionStore.create('run', root);
  try {
    const source = { ledger: new SecretLedger([['token', SENTINEL], ['token', `${SENTINEL}-rotated`]]), taint: { value: true } };
    await store.save('member', identity, { format: 'fake', version: 1, data: { token: SENTINEL } }, snapshotProtection(source));
    expect(await readFile(path.join(root, 'run', 'native--member.json'), 'utf8')).not.toContain(SENTINEL);
    const restored = { ledger: new SecretLedger(), taint: { value: false } };
    restoreProtection(restored, await store.loadProtection('member', identity));
    expect(restored.taint.value).toBe(true);
    expect(restored.ledger.redact(`${SENTINEL} ${SENTINEL}-rotated`)).not.toContain(SENTINEL);
    expect((await store.load('member', identity)).data).toEqual({ token: SENTINEL });
    await expect(store.load('member', { ...identity, appIdentity: 'different' })).rejects.toMatchObject({ code: 'SESSION_MISMATCH' });
    await expect(store.save('../escape', identity, { format: 'fake', version: 1, data: {} })).rejects.toMatchObject({ code: 'SESSION_INVALID' });
  } finally { store.cleanup(); }
});

it('redacts text downloads before disk metadata and store publication, and withholds opaque downloads', async () => {
  processSecrets.register('audit', SENTINEL);
  const root = await mkdtemp(path.join(tmpdir(), 'native-artifact-security-'));
  const published: Uint8Array[] = [];
  const artifacts = createAttemptArtifacts({ artifactsRoot: root, segments: ['test'], attemptId: 'attempt', store: { async put(artifact) { published.push(artifact.bytes); return { ref: 'stored' }; } } });
  await writeFile(path.join(artifacts.dir, 'data.csv'), `value\n${SENTINEL}\n`);
  await writeFile(path.join(artifacts.dir, 'opaque.bin'), Buffer.concat([Buffer.from([0xff, 0x00]), Buffer.from(SENTINEL)]));
  artifacts.sink.register('download', 'data.csv');
  artifacts.sink.register('download', 'opaque.bin');
  expect(() => artifacts.sink.register('log', '../outside.txt')).toThrow('inside');
  await artifacts.settle();
  expect(await readFile(path.join(artifacts.dir, 'data.csv'), 'utf8')).not.toContain(SENTINEL);
  expect(published).toHaveLength(1);
  expect(Buffer.from(published[0]!).toString()).not.toContain(SENTINEL);
  expect(artifacts.records[1]).toMatchObject({ redaction: 'incomplete' });
  expect(artifacts.records[1]!.path).toBeUndefined();
  await expect(access(path.join(artifacts.dir, 'opaque.bin'))).rejects.toThrow();
});

it('bounds cyclic aggregate errors and redacts default error serialization', () => {
  processSecrets.register('audit', SENTINEL);
  const aggregate = new AggregateError([], SENTINEL);
  aggregate.errors.push(aggregate);
  const serialized = serializeError(classifyError(new Error('outer', { cause: aggregate })));
  expect(JSON.stringify(serialized)).not.toContain(SENTINEL);
  expect(Buffer.byteLength(serialized.message)).toBeLessThanOrEqual(8192);
});


it('redacts registered secrets split across a managed command log before disk persistence', async () => {
  processSecrets.register('audit', SENTINEL);
  const root = await mkdtemp(path.join(tmpdir(), 'native-managed-log-'));
  const command = new ManagedProcess('security fixture', { executable: process.execPath,
    args: ['-e', `process.stdout.write(${JSON.stringify(SENTINEL.slice(0, 9))}); setTimeout(() => process.stdout.write(${JSON.stringify(SENTINEL.slice(9) + '\n')}), 20);`], log: 'command.log' }, root, { waitForExit: true });
  await command.start();
  await command.stop();
  const content = await readFile(path.join(root, 'command.log'), 'utf8');
  expect(content).not.toContain(SENTINEL);
  expect(content).toContain('<secret:audit>');
});
