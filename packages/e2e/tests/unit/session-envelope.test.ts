/** Session envelope wire format. */

import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { uuidv7 } from '../../src/internal/ids.ts';
import { SessionStore, type SessionIdentity } from '../../src/run/sessions.ts';
import {
  assertValidSessionEnvelope,
  isValidSessionEnvelope,
  specFixture,
} from '../helpers/session-schema.ts';

const identity: SessionIdentity = {
  targetId: 'web',
  engineName: 'playwright',
  engineVersion: '1.61.1',
  spiVersion: 1,
  platform: 'web',
  appIdentity: 'a'.repeat(64),
};

/** Saves one state and returns both the parsed envelope and its store. */
async function saveEnvelope(): Promise<{ store: SessionStore; envelope: Record<string, unknown> }> {
  const root = await mkdtemp(path.join(tmpdir(), 'e2e-sessions-'));
  const runId = uuidv7();
  const store = SessionStore.create(runId, root);
  await store.save('member', identity, {
    format: 'playwright-state',
    version: 1,
    data: { cookies: [{ name: 'sid', value: 'abc' }] },
  });
  const [file] = await readdir(path.join(root, runId));
  const raw = await readFile(path.join(root, runId, file!), 'utf8');
  return { store, envelope: JSON.parse(raw) as Record<string, unknown> };
}

describe('session envelope', () => {
  it('stores separator-containing target/session tuples independently across workers', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'e2e-session-tuples-'));
    const runId = uuidv7();
    const store = SessionStore.create(runId, root);
    const reader = SessionStore.forWorker(runId, root, Buffer.from(store.exportKeyForWorker(), 'base64'));
    const first = { ...identity, targetId: 'a--b' };
    const second = { ...identity, targetId: 'a' };
    try {
      await store.save('c', first, { format: 'test', version: 1, data: 'first' });
      await store.save('b--c', second, { format: 'test', version: 1, data: 'second' });
      expect(await readdir(path.join(root, runId))).toHaveLength(2);
      expect((await reader.load('c', first)).data).toBe('first');
      expect((await reader.load('b--c', second)).data).toBe('second');
      store.cleanup();
      expect(await readdir(root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('produces an envelope that validates against session-v1.schema.json', async () => {
    const { store, envelope } = await saveEnvelope();
    try {
      assertValidSessionEnvelope(envelope);
      expect((envelope.state as { algorithm: string }).algorithm).toBe('A256GCM');
    } finally {
      store.cleanup();
    }
  });

  it('round-trips the produced envelope', async () => {
    const { store } = await saveEnvelope();
    try {
      const loaded = await store.load('member', identity);
      expect(loaded.data).toEqual({ cookies: [{ name: 'sid', value: 'abc' }] });
    } finally {
      store.cleanup();
    }
  });

  it('accepts the canonical valid fixture', () => {
    assertValidSessionEnvelope(specFixture('session-v1.valid.json'));
  });

  it('rejects the canonical invalid fixture', () => {
    expect(isValidSessionEnvelope(specFixture('session-v1.invalid.json'))).toBe(false);
  });
});
