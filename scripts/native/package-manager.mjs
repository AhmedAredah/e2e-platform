import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';

/** Reads Windows environment keys without assuming PATH's capitalization. */
function environmentValue(env, name) {
  const key = Object.keys(env).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : env[key];
}

/** Checks a candidate without treating an inaccessible path as an executable. */
function isFile(file) {
  try { return statSync(file).isFile(); } catch { return false; }
}

/** Uses pnpm 12's supported JS entry when its shim names the native package bin. */
function nativePnpmScriptBeside(directory, shim) {
  const normalized = shim.replaceAll('/', '\\').replace(/\\+/g, '\\').toLowerCase();
  for (const segments of [['node_modules', 'pnpm'], ['..', 'pnpm']]) {
    const packageDirectory = join(directory, ...segments);
    // Match complete, quoted, fixed paths. Never evaluate batch syntax or use a
    // path supplied by the shim or manifest to choose an arbitrary executable.
    const referencesNativeBin = ['pnpm', 'pnpm.exe'].some((entry) =>
      ['%~dp0', '%dp0%'].some((prefix) => ['', '\\'].some((separator) =>
        normalized.includes(`"${prefix}${separator}${[...segments, entry].join('\\')}"`)))
      && isFile(join(packageDirectory, entry)));
    if (!referencesNativeBin) continue;
    let manifest;
    try { manifest = JSON.parse(readFileSync(join(packageDirectory, 'package.json'), 'utf8')); } catch { continue; }
    if (manifest?.name !== 'pnpm' || !['pnpm', 'pnpm.exe'].includes(manifest.bin?.pnpm)) continue;
    const script = join(packageDirectory, 'bin', 'pnpm.mjs');
    if (isFile(script)) return script;
  }
  return undefined;
}

/** Resolves the JavaScript entry adjacent to npm, pnpm or Corepack's Windows shim. */
function scriptBeside(directory, name, shim) {
  const packageName = name === 'npx' ? 'npm' : name;
  const entries = name === 'pnpm' ? ['pnpm.cjs', 'pnpm.js', 'pnpm.mjs'] : [`${name}-cli.js`];
  const candidates = entries.flatMap((entry) => [
    join(directory, 'node_modules', packageName, 'bin', entry),
    join(directory, '..', packageName, 'bin', entry),
    join(directory, entry),
  ]);
  if (name === 'pnpm') candidates.push(
    join(directory, 'node_modules', 'corepack', 'dist', 'pnpm.js'),
    join(directory, '..', 'corepack', 'dist', 'pnpm.js'),
  );
  return candidates.find((candidate) => isFile(candidate)
    && (shim === undefined || (shim.includes(basename(candidate))
      && shim.includes('corepack') === candidate.includes(`${join('corepack', 'dist')}`))))
    ?? (name === 'pnpm' && shim !== undefined ? nativePnpmScriptBeside(directory, shim) : undefined);
}

/** Finds an executable or a known JS entry; never executes an unknown batch wrapper. */
function windowsInvocation(name, env, execPath) {
  const inherited = environmentValue(env, 'npm_execpath');
  const entries = name === 'pnpm' ? ['pnpm.cjs', 'pnpm.js', 'pnpm.mjs'] : [`${name}-cli.js`];
  if (inherited && isAbsolute(inherited) && entries.includes(basename(inherited)) && isFile(inherited)) {
    return { executable: execPath, prefix: [inherited] };
  }
  const directories = (environmentValue(env, 'PATH') ?? '').split(';').filter(Boolean).map((directory) => directory.replace(/^"(.*)"$/, '$1'));
  for (const directory of directories) {
    const executable = join(directory, `${name}.exe`);
    if (isFile(executable)) return { executable, prefix: [] };
    const shim = [join(directory, `${name}.cmd`), join(directory, `${name}.bat`)].find(isFile);
    if (shim === undefined) continue;
    const script = scriptBeside(directory, name, readFileSync(shim, 'utf8'));
    if (script !== undefined) return { executable: execPath, prefix: [script] };
    throw new Error(`Cannot safely resolve ${name}'s JavaScript entry beside ${shim}; use a standard npm/pnpm/Corepack installation or a native executable`);
  }
  const bundled = scriptBeside(dirname(execPath), name);
  if (bundled !== undefined) return { executable: execPath, prefix: [bundled] };
  throw new Error(`Cannot find ${name}; install it and add its directory to PATH`);
}

/** Invokes package managers with argument boundaries intact, including Windows shims. */
export function runPackageManager(name, args, options = {}, runtime = {}) {
  if (!['npm', 'npx', 'pnpm'].includes(name)) throw new Error(`Unsupported package manager: ${name}`);
  const env = options.env ?? runtime.env ?? process.env;
  const invocation = (runtime.platform ?? process.platform) === 'win32'
    ? windowsInvocation(name, env, runtime.execPath ?? process.execPath)
    : { executable: name, prefix: [] };
  return spawnSync(invocation.executable, [...invocation.prefix, ...args], { ...options, env, shell: false });
}
