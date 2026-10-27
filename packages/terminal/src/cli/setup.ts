#!/usr/bin/env node
import { NodePtyInstallation } from '../transport/installation.ts';

try {
  const args = process.argv.slice(2);
  if (args.length === 1 && ['--help', '-h'].includes(args[0]!)) {
    console.log('Usage: e2e-platform-terminal-setup\n\nExplicitly repair node-pty 1.1.0 macOS helper permissions after installing the optional peer. Other platforms require no helper changes.');
  } else if (args.length > 0) {
    throw new Error('Unknown setup arguments; use e2e-platform-terminal-setup --help');
  } else if (process.platform !== 'darwin') {
    console.log('No macOS node-pty helper setup is needed on this platform.');
  } else {
    await import('node-pty');
    const installation = NodePtyInstallation.loaded();
    const repaired = installation?.repair() ?? false;
    console.log(repaired ? 'Repaired the installed node-pty 1.1.0 helper executable permissions.' : 'The installed node-pty helper is executable.');
  }
} catch (cause) {
  console.error(cause instanceof Error ? cause.message : String(cause));
  if (cause instanceof Error && cause.cause instanceof Error) console.error(cause.cause.message);
  console.error('Install the optional node-pty peer and allow its native build scripts before running terminal setup.');
  process.exitCode = 1;
}
