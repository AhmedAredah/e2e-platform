import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { NodePtyInstallation } from '../src/transport/installation.ts';

vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs')>();
  return { ...original, renameSync: vi.fn(original.renameSync) };
});

const directories: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(fs.renameSync).mockReset();
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function fixture(version = '1.1.0') {
  const root = fs.mkdtempSync(join(tmpdir(), 'terminal peer with spaces & '));
  directories.push(root);
  fs.writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'node-pty', version }));
  const nativeModule = join(root, 'prebuilds/darwin-arm64/pty.node');
  fs.mkdirSync(dirname(nativeModule), { recursive: true });
  const helper = join(dirname(nativeModule), 'spawn-helper');
  fs.writeFileSync(helper, Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0, 1, 2, 3]));
  fs.chmodSync(helper, 0o644);
  return { root, helper, installation: new NodePtyInstallation(root, nativeModule) };
}

// Windows does not implement POSIX executable mode bits; its setup CLI is
// covered separately and must remain a no-op without the optional peer.
describe.skipIf(process.platform === 'win32')('explicit macOS helper setup filesystem contract', () => {
  test('preflight diagnoses the missing execute bit without mutating a shared helper', () => {
    const { helper, installation } = fixture();
    const before = fs.statSync(helper);
    expect(() => installation.assertReady()).toThrow(expect.objectContaining({
      code: 'DEPENDENCY_MISSING', message: expect.stringContaining('e2e-platform-terminal-setup'),
    }));
    expect(fs.statSync(helper).mode).toBe(before.mode);
    expect(fs.statSync(helper).ino).toBe(before.ino);
  });

  test('explicit repair preserves bytes and shared-store permissions, then is idempotent', () => {
    const { root, helper, installation } = fixture();
    const shared = join(root, 'shared-store-copy');
    fs.linkSync(helper, shared);
    const bytes = fs.readFileSync(helper);
    expect(installation.repair()).toBe(true);
    expect(() => installation.assertReady()).not.toThrow();
    expect(fs.readFileSync(helper)).toEqual(bytes);
    expect(fs.statSync(helper).mode & 0o777).toBe(0o755);
    expect(fs.statSync(shared).mode & 0o777).toBe(0o644);
    expect(fs.statSync(helper).ino).not.toBe(fs.statSync(shared).ino);
    const repaired = fs.statSync(helper);
    expect(installation.repair()).toBe(false);
    expect(fs.statSync(helper).ino).toBe(repaired.ino);
    expect(fs.readdirSync(dirname(helper))).toEqual(['spawn-helper']);
  });

  test('missing and non-regular helpers cannot be repaired', () => {
    const { helper, installation } = fixture();
    fs.rmSync(helper);
    expect(() => installation.repair()).toThrow(expect.objectContaining({ code: 'DEPENDENCY_MISSING' }));
    fs.mkdirSync(helper);
    expect(() => installation.repair()).toThrow(expect.objectContaining({ code: 'DEPENDENCY_MISSING' }));
  });

  test('repair does not grant access to users who could not read a private helper', () => {
    const { helper, installation } = fixture();
    fs.chmodSync(helper, 0o600);
    expect(installation.repair()).toBe(true);
    expect(fs.statSync(helper).mode & 0o777).toBe(0o700);
  });

  test('symlinks and directory escapes never change another file', () => {
    const { root, helper, installation } = fixture();
    const external = fixture();
    fs.rmSync(helper);
    fs.symlinkSync(external.helper, helper);
    expect(() => installation.repair()).toThrow(expect.objectContaining({ code: 'DEPENDENCY_MISSING' }));
    expect(fs.statSync(external.helper).mode & 0o777).toBe(0o644);
    const escaped = new NodePtyInstallation(root, join(dirname(external.helper), 'pty.node'));
    expect(() => escaped.repair()).toThrow(expect.objectContaining({ code: 'DEPENDENCY_MISSING' }));
    expect(fs.statSync(external.helper).mode & 0o777).toBe(0o644);
  });

  test('unsupported peer versions require reinstalling instead of guessed repairs', () => {
    const { helper, installation } = fixture('1.2.0');
    expect(() => installation.repair()).toThrow(expect.objectContaining({ code: 'DEPENDENCY_MISSING' }));
    expect(fs.statSync(helper).mode & 0o777).toBe(0o644);
  });

  test('a read-only installation failure preserves the original and removes temporary files', () => {
    const { helper, installation } = fixture();
    const before = fs.statSync(helper);
    vi.mocked(fs.renameSync).mockImplementationOnce(() => { throw Object.assign(new Error('Read-only filesystem'), { code: 'EROFS' }); });
    expect(() => installation.repair()).toThrow(expect.objectContaining({
      code: 'DEPENDENCY_MISSING', message: expect.stringContaining('read-only'),
    }));
    expect(fs.statSync(helper).ino).toBe(before.ino);
    expect(fs.statSync(helper).mode).toBe(before.mode);
    expect(fs.readdirSync(dirname(helper))).toEqual(['spawn-helper']);
  });
});

test('malformed metadata and another package identity are rejected before repair', () => {
  const { root, helper } = fixture();
  for (const metadata of ['null', '{bad json}', JSON.stringify({ name: 'another-peer', version: '1.1.0' }), JSON.stringify({ name: 'node-pty', version: 1 })]) {
    fs.writeFileSync(join(root, 'package.json'), metadata);
    expect(() => new NodePtyInstallation(root, join(dirname(helper), 'pty.node'))).toThrow(expect.objectContaining({ code: 'DEPENDENCY_MISSING' }));
  }
});

test('shipped setup command has help and rejects unknown arguments before any mutation', () => {
  const script = fileURLToPath(new URL('../dist/cli/setup.js', import.meta.url));
  const result = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain('Usage: e2e-platform-terminal-setup');
  const invalid = spawnSync(process.execPath, [script, '--unexpected'], { encoding: 'utf8' });
  expect(invalid.status).toBe(1);
  expect(invalid.stderr).toContain('Unknown setup arguments');
});

test.skipIf(process.platform === 'darwin')('shipped setup command needs no optional peer on other platforms', () => {
  const directory = fs.mkdtempSync(join(tmpdir(), 'terminal setup standalone '));
  directories.push(directory);
  fs.cpSync(fileURLToPath(new URL('../dist', import.meta.url)), join(directory, 'dist'), { recursive: true });
  fs.writeFileSync(join(directory, 'package.json'), JSON.stringify({ type: 'module' }));
  const result = spawnSync(process.execPath, [join(directory, 'dist/cli/setup.js')], { encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain('No macOS node-pty helper setup is needed');
});
