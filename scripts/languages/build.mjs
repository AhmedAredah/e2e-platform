/** Builds real application fixtures using installed toolchains; downloads no packages. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runProcess } from '../../packages/process/dist/index.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const example = path.join(root, 'examples', 'with-languages');
const build = path.join(example, 'build');

/** Runs a bounded direct command and exposes tool diagnostics on failure. */
async function command(executable, args, env) {
  let result;
  try { result = await runProcess({executable, args, cwd: example, env, timeoutMs: 180_000, maxOutputBytes: 1024 * 1024}); }
  catch (error) {
    if (error.result) { process.stdout.write(error.result.stdout.bytes); process.stderr.write(error.result.stderr.bytes); }
    throw error;
  }
  if (result.stdout.truncated || result.stderr.truncated) throw new Error('Tool output exceeded its capture budget');
  return result.stdout.bytes.toString('utf8').trim();
}

/** Hashes the tested source or output files, without using paths as logical app identity. */
async function fingerprint(directory, accept = () => true) {
  const hash = createHash('sha256');
  async function visit(current) {
    const entries = (await readdir(current, {withFileTypes: true})).toSorted((a, b) => a.name.localeCompare(b.name, 'en'));
    for (const entry of entries) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory() && entry.name !== '__pycache__') await visit(file);
      else if (entry.isFile() && accept(file)) { hash.update(path.relative(directory, file).split(path.sep).join('/') + '\0'); hash.update(await readFile(file)); }
    }
  }
  await visit(directory);
  return `sha256:${hash.digest('hex')}`;
}

/** Requires Python, .NET and Rust; absent toolchains are errors, never skipped qualification. */
export async function buildApplications() {
  await mkdir(build, {recursive: true});
  await rm(path.join(build, 'runtime-manifest.json'), {force: true});
  const env = {...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1', DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1'};
  const python = process.env.E2E_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
  const dotnet = process.env.E2E_DOTNET ?? 'dotnet';
  const cargo = process.env.E2E_CARGO ?? 'cargo';
  const rustc = process.env.E2E_RUSTC ?? process.env.RUSTC ?? 'rustc';
  env.RUSTC = rustc;
  const pythonFacts = JSON.parse(await command(python, ['-c', 'import json,sys; print(json.dumps({"executable":sys.executable,"version":sys.version.split()[0]}))'], env));
  const dotnetVersion = await command(dotnet, ['--version'], env);
  const cargoVersion = await command(cargo, ['--version'], env);
  const rustVersion = await command(rustc, ['--version'], env);
  const dotnetProject = path.join(example, 'apps', 'dotnet', 'CalculatorDemo.csproj');
  await command(dotnet, ['restore', dotnetProject, '--configfile', path.join(example, 'apps', 'dotnet', 'NuGet.Config'), '--nologo'], env);
  await rm(path.join(build, 'dotnet'), {recursive: true, force: true});
  await command(dotnet, ['build', dotnetProject, '--no-restore', '--configuration', 'Release', '--output', path.join(build, 'dotnet'), '--nologo'], env);
  const binary = path.join(build, 'rust', 'release', `e2e-language-calculator${process.platform === 'win32' ? '.exe' : ''}`);
  // A caller's Cargo target configuration must not leave an old host binary eligible for testing.
  await rm(binary, {force: true});
  await command(cargo, ['build', '--manifest-path', path.join(example, 'apps', 'rust', 'Cargo.toml'), '--release', '--offline', '--locked', '--target-dir', path.join(build, 'rust')], env);
  const manifest = {
    schemaVersion: 1,
    platform: process.platform,
    architecture: process.arch,
    runtimes: {
      python: {executable: pythonFacts.executable, entrypoint: path.join(example, 'apps', 'python', 'main.py'), version: pythonFacts.version, buildFingerprint: await fingerprint(path.join(example, 'apps', 'python'), file => file.endsWith('.py'))},
      dotnet: {executable: dotnet, entrypoint: path.join(build, 'dotnet', 'CalculatorDemo.dll'), version: dotnetVersion, buildFingerprint: await fingerprint(path.join(build, 'dotnet'))},
      rust: {executable: binary, entrypoint: binary, version: rustVersion, buildToolVersion: cargoVersion, buildFingerprint: `sha256:${createHash('sha256').update(await readFile(binary)).digest('hex')}`},
    },
  };
  await writeFile(path.join(build, 'runtime-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = await buildApplications();
  process.stdout.write(`Built Python, C# and Rust application fixtures: ${JSON.stringify(manifest.runtimes)}\n`);
}
