import type { SpawnSyncOptions, SpawnSyncOptionsWithStringEncoding, SpawnSyncReturns } from 'node:child_process';

export function runPackageManager(name: 'npm' | 'npx' | 'pnpm', args: readonly string[], options: SpawnSyncOptionsWithStringEncoding): SpawnSyncReturns<string>;
export function runPackageManager(name: 'npm' | 'npx' | 'pnpm', args: readonly string[], options?: SpawnSyncOptions): SpawnSyncReturns<Buffer | string>;
