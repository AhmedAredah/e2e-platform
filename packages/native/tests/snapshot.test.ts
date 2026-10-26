import { describe, expect, it } from 'vitest';
import { parseScreenshot, parseSnapshot } from '../src/driver/snapshot.ts';

const root = { ref: { id: 'root', revision: '' }, role: 'window' };
const base = { root, viewport: { width: 500, height: 400 } };

describe('native source-data validation', () => {
  it('rejects secure values, attributes and descendants rather than forwarding them', () => {
    for (const payload of [{ value: 'secret' }, { attributes: { content: 'secret' } }, { children: [{ ref: { id: 'child' }, text: 'secret' }] }]) {
      expect(() => parseSnapshot({ ...base, root: { ...root, states: { secure: true }, ...payload } }, true)).toThrow(/secure node/);
    }
    expect(parseSnapshot({ ...base, root: { ...root, name: 'Password', states: { secure: true } } }, true).secureCount).toBe(1);
  });

  it('rejects duplicate IDs, excessive depth and invalid viewport geometry', () => {
    expect(() => parseSnapshot({ ...base, root: { ...root, children: [root] } }, true)).toThrow(/duplicate/);
    let deep: unknown = { ref: { id: 'last' } };
    for (let index = 0; index < 66; index++) deep = { ref: { id: `node-${index}` }, children: [deep] };
    expect(() => parseSnapshot({ ...base, root: deep }, true)).toThrow(/limit/);
    expect(() => parseSnapshot({ ...base, viewport: { width: -1, height: 10 } }, true)).toThrow(/dimension/);
    expect(() => parseSnapshot({ ...base, treeUnavailable: true }, true)).toThrow(/unavailable semantic/);
  });

  it('keeps locator reads complete and omits oversized observation fields without exposing prefixes', () => {
    const snapshot = { ...base, root: { ...root, name: 'n'.repeat(500), text: 't'.repeat(1000) } };
    expect(parseSnapshot(snapshot, true).snapshot.root.name).toBe('[omitted: text exceeds limit]');
    expect(parseSnapshot(snapshot, true).snapshot.root.text).toBe('[omitted: text exceeds limit]');
    expect(parseSnapshot(snapshot, false).snapshot.root.text).toHaveLength(1000);
  });

  it.each([['name', 256], ['text', 512]] as const)('never forwards a secret prefix crossing the %s boundary', (field, limit) => {
    const value = 'native-boundary-secret-Q29-123456';
    const full = 'x'.repeat(limit - 12) + value;
    const observed = parseSnapshot({ ...base, root: { ...root, [field]: full } }, true).snapshot.root;
    expect(observed[field]).not.toContain(value.slice(0, 12));
    expect(observed[field]).toBe('[omitted: text exceeds limit]');
    expect(parseSnapshot({ ...base, root: { ...root, [field]: full } }, false).snapshot.root[field]).toBe(full);
  });

  it('refuses unmasked pixels and dishonest secure-region coverage', () => {
    expect(() => parseScreenshot({ base64: '', width: 1, height: 1, mimeType: 'image/png', masked: false }, 0)).toThrow(/unmasked/);
    expect(() => parseScreenshot({ base64: '', width: 1, height: 1, mimeType: 'image/png', masked: true, maskedRegionCount: 0 }, 1)).toThrow(/coverage/);
  });
});
