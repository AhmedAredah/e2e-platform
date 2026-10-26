import { test as base } from '@e2e-cpp/core';
import { ProcessWorkspace, type ProcessFixture } from './fixtures/workspace.ts';

export { expect } from '@e2e-cpp/core';

export type { ProcessFixture } from './fixtures/workspace.ts';

/** e2e test with an isolated subprocess workspace and automatic process-tree cleanup. */
export const test = base.extend<{ processes: ProcessFixture }>({
  processes: async (_fixtures, use) => {
    const fixture = await ProcessWorkspace.create();
    try { await use(fixture); }
    finally { await fixture.dispose(); }
  },
});
