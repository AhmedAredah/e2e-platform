import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DotnetLaunchProfile, ExecutableLaunchProfile, PythonLaunchProfile, type ApplicationLaunchProfile } from '@e2e-cpp/process';

interface RuntimeEntry { executable: string; entrypoint: string; buildFingerprint: string; version: string; }
const directory = fileURLToPath(new URL('../', import.meta.url));

/** Resolves a tested runtime from the build manifest; missing runtimes fail instead of skipping. */
export function applicationProfile(language: string): ApplicationLaunchProfile {
  if (!['python', 'dotnet', 'rust'].includes(language)) throw new Error(`Unknown application language: ${language}`);
  let manifest: unknown;
  try { manifest = JSON.parse(readFileSync(new URL('../build/runtime-manifest.json', import.meta.url), 'utf8')) as unknown; }
  catch { throw new Error('Build all language applications first: node scripts/languages/build.mjs from the repository root'); }
  const entry = (manifest as { runtimes?: Record<string, RuntimeEntry> }).runtimes?.[language];
  if (entry === undefined || [entry.executable, entry.entrypoint, entry.buildFingerprint, entry.version].some((value) => typeof value !== 'string' || value === '')) throw new Error(`Invalid runtime manifest for ${language}`);
  const env = Object.fromEntries(['PATH', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'DOTNET_ROOT'].flatMap((name) => process.env[name] === undefined ? [] : [[name, process.env[name]!]]));
  const common = { identity: `example.calculator.${language}`, buildFingerprint: entry.buildFingerprint, cwd: directory, env: { ...env, DOTNET_CLI_TELEMETRY_OPTOUT: '1' }, inheritEnv: false };
  if (language === 'python') return new PythonLaunchProfile({ ...common, interpreter: entry.executable, script: entry.entrypoint });
  if (language === 'dotnet') return new DotnetLaunchProfile({ ...common, dotnet: entry.executable, assembly: entry.entrypoint });
  return new ExecutableLaunchProfile({ ...common, executable: entry.entrypoint });
}
