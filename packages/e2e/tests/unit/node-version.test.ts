import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SUPPORTED_NODE_RANGE, unsupportedNodeMessage } from '../../src/internal/node-version.ts';

describe('unsupportedNodeMessage', () => {
  it('mirrors the engines field of package.json', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
      engines: { node: string };
    };
    expect(manifest.engines.node).toBe(SUPPORTED_NODE_RANGE);
  });

  it.each(['22.22.3', 'v22.22.4', '22.23.0', '24.8.0', '24.22.1', '25.0.0', '26.4.0'])(
    'accepts supported version %s', (version) => {
      expect(unsupportedNodeMessage(version)).toBeUndefined();
    },
  );

  it.each(['18.20.4', '20.19.0', '22.22.2', '22.21.99', '23.99.0', '24.0.0', '24.7.99'])(
    'rejects unsupported version %s', (version) => {
      expect(unsupportedNodeMessage(version)).toContain('requires Node.js 22.22.3+');
      expect(unsupportedNodeMessage(version)).toContain(`this is Node.js ${version}`);
      expect(unsupportedNodeMessage(version)).toContain('nvm use 22');
    },
  );
});
