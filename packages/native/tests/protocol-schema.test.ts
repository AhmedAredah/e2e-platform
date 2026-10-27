import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { ENGINE_ERROR_CODES, LOCATOR_ACTION_KINDS } from '@e2e-platform/core/engine';
import { describe, expect, it } from 'vitest';
import { parseSnapshot } from '../src/driver/snapshot.ts';
import { NativeTransport, RpcNativeDriver } from '../src/index.ts';

interface Fixture { readonly name: string; readonly definition: string; readonly valid: boolean; readonly value: unknown }
const schema = JSON.parse(readFileSync(new URL('../schema/native-bridge-1.schema.json', import.meta.url), 'utf8')) as {
  $id: string;
  $defs: { actionKind: { enum: readonly string[] }; errorCode: { enum: readonly string[] } };
};
const fixtures = JSON.parse(readFileSync(new URL('../schema/fixtures/native-bridge-1.conformance.json', import.meta.url), 'utf8')) as Fixture[];
const ajv = new Ajv2020({ allErrors: true, strict: false });
ajv.addSchema(schema);

describe('native protocol v1 canonical serialization', () => {
  it.each(fixtures)('$name', ({ definition, valid, value }) => {
    const validate = ajv.compile({ $ref: `${schema.$id}#/$defs/${definition}` });
    expect(validate(JSON.parse(JSON.stringify(value)))).toBe(valid);
    if (valid) expect(validate.errors ?? []).toEqual([]);
  });

  it('keeps the schema vocabulary aligned with the public engine contract', () => {
    expect(schema.$defs.actionKind.enum).toEqual(LOCATOR_ACTION_KINDS);
    expect(schema.$defs.errorCode.enum).toEqual(ENGINE_ERROR_CODES);
  });

  it('accepts the golden initialization and secure snapshot through the actual driver', async () => {
    const initialization = fixtures.find((fixture) => fixture.name === 'initialization response')?.value as { result: unknown };
    const snapshot = fixtures.find((fixture) => fixture.name === 'snapshot response')?.value as { result: unknown };
    class GoldenTransport extends NativeTransport {
      async request(method: string): Promise<unknown> {
        if (method === 'initialize') return initialization.result;
        if (method === 'snapshot') return snapshot.result;
        return null;
      }
      close(): void {}
    }
    const driver = new RpcNativeDriver(new GoldenTransport());
    const context = { signal: new AbortController().signal, timeoutMs: 1000 };
    expect((await driver.initialize('fixture-token-never-production', context)).protocolVersion).toBe(1);
    const observed = await driver.snapshot(context, true);
    expect(observed.root.children?.[0]?.states?.secure).toBe(true);
    expect(observed.maskedRegionCount).toBe(1);
    await expect(driver.perform({ id: 'input', revision: '' }, { kind: 'tap' }, context)).resolves.toBeUndefined();
  });

  it('rejects every golden secure-node leak through the actual parser', () => {
    for (const fixture of fixtures.filter((entry) => entry.definition === 'node' && !entry.valid &&
      (entry.value as { states?: { secure?: boolean } } | null)?.states?.secure === true)) {
      expect(() => parseSnapshot({ root: fixture.value, viewport: { width: 1, height: 1 } }, false)).toThrow(/secure node/);
    }
  });

  it('keeps all golden node states consistent with runtime validation', () => {
    for (const fixture of fixtures.filter((entry) => entry.definition === 'node')) {
      const parse = () => parseSnapshot({ root: fixture.value, viewport: { width: 1, height: 1 } }, false);
      if (fixture.valid) expect(parse).not.toThrow();
      else expect(parse).toThrow();
    }
  });

  it('rejects ambiguous, unbounded or malformed owned-window enumeration', async () => {
    const window = { id: 'one', title: 'Editor', visible: true, active: true, modal: false };
    for (const value of [null, [window, window], Array.from({ length: 257 }, (_, index) => ({ ...window, id: String(index) })),
      [{ ...window, title: 'x'.repeat(257) }], [{ ...window, active: 'true' }], [{ ...window, arbitrary: 'field' }]]) {
      class WindowTransport extends NativeTransport {
        async request(): Promise<unknown> { return value; }
        close(): void {}
      }
      const driver = new RpcNativeDriver(new WindowTransport());
      await expect(driver.windows({ signal: new AbortController().signal, timeoutMs: 100 })).rejects.toMatchObject({ code: 'ENGINE_FAILURE' });
    }
  });
});
