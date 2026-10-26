import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { validateDocumentation } from './check-docs-local.mjs';

test('offline documentation gate rejects absent pages and assets without treating code examples as links', () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-gate-'));
  try {
    writeFileSync(join(root, 'docs.json'), JSON.stringify({ navigation: { pages: ['index', 'missing'] } }));
    writeFileSync(join(root, 'index.mdx'), '# Welcome\n[asset](absent.png)\n[external](https://example.com)\n```md\n[example](not-a-real-file)\n```\n');
    const result = validateDocumentation(root);
    assert.equal(result.checkedPages, 1);
    assert.equal(result.errors.length, 2);
    assert.match(result.errors[0], /navigation: missing/);
    assert.match(result.errors[1], /absent\.png/);
    writeFileSync(join(root, 'missing.mdx'), '# Present\n');
    writeFileSync(join(root, 'absent.png'), 'asset');
    assert.deepEqual(validateDocumentation(root).errors, []);
  } finally { rmSync(root, { force: true, recursive: true }); }
});
