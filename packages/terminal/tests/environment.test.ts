import { expect, test } from 'vitest';
import { terminalEnvironment } from '../src/transport/environment.ts';

test('Windows terminal environment removes aliases before applying overrides', () => {
  expect(terminalEnvironment({ Path: 'old', PATH: 'duplicate', keep: 'yes' }, { PaTh: undefined }, true)).toEqual({ keep: 'yes', TERM: 'xterm-256color' });
  expect(terminalEnvironment({ Path: 'old', TERM: 'old' }, { PATH: 'new', term: 'custom' }, true)).toEqual({ PATH: 'new', term: 'custom' });
  expect(terminalEnvironment({ Path: 'old' }, { PATH: undefined }, false)).toEqual({ Path: 'old', TERM: 'xterm-256color' });
});
