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

  it('keeps locator reads complete while bounding observation text', () => {
    const snapshot = { ...base, root: { ...root, name: 'n'.repeat(500), text: 't'.repeat(1000) } };
    expect(parseSnapshot(snapshot, true).snapshot.root.name).toHaveLength(256);
    expect(parseSnapshot(snapshot, true).snapshot.root.text).toHaveLength(512);
    expect(parseSnapshot(snapshot, false).snapshot.root.text).toHaveLength(1000);
  });

  it('refuses unmasked pixels and dishonest secure-region coverage', () => {
    expect(() => parseScreenshot({ base64: '', width: 1, height: 1, mimeType: 'image/png', masked: false }, 0)).toThrow(/unmasked/);
    expect(() => parseScreenshot({ base64: '', width: 1, height: 1, mimeType: 'image/png', masked: true, maskedRegionCount: 0 }, 1)).toThrow(/coverage/);
  });
});
