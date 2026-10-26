import { basename } from 'node:path/posix';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** Reads the current configuration's executable artifacts without guessing a build layout. */
export function configuredExecutables(buildDirectory, configurationName = 'Release') {
  const replyDirectory = join(buildDirectory, '.cmake', 'api', 'v1', 'reply');
  let indexes;
  try { indexes = readdirSync(replyDirectory).filter((name) => /^index-.*\.json$/.test(name)); }
  catch (cause) { throw new Error(`No CMake File API reply in ${buildDirectory}; configure and build with scripts/cpp/verify.mjs first`, { cause }); }
  indexes.sort((a, b) => statSync(join(replyDirectory, b)).mtimeMs - statSync(join(replyDirectory, a)).mtimeMs);
  if (!indexes.length) throw new Error('CMake did not return File API metadata');
  const index = JSON.parse(readFileSync(join(replyDirectory, indexes[0]), 'utf8'));
  const reply = index.reply?.['codemodel-v2'];
  if (!reply?.jsonFile) throw new Error('CMake did not return a codemodel response');
  const model = JSON.parse(readFileSync(join(replyDirectory, reply.jsonFile), 'utf8'));
  const configuration = model.configurations.find((item) => item.name === configurationName);
  if (!configuration) throw new Error(`CMake codemodel contains no ${configurationName} configuration`);
  const targets = new Map();
  for (const reference of configuration.targets) {
    const target = JSON.parse(readFileSync(join(replyDirectory, reference.jsonFile), 'utf8'));
    const artifact = primaryExecutableArtifact(target);
    if (artifact !== undefined) targets.set(target.name, resolve(model.paths.build, artifact));
  }
  return targets;
}

/** Requires the named configured executable to exist as a file before launching it. */
export function requireExecutableTarget(targets, name) {
  const executable = targets.get(name);
  let exists = false;
  if (executable) { try { exists = statSync(executable).isFile(); } catch { /* Missing build artifact. */ } }
  if (!exists) throw new Error(`current CMake configuration did not build ${name}`);
  return executable;
}

/** Selects CMake's named primary executable, excluding PDBs/import libraries and stale path guesses. */
export function primaryExecutableArtifact(target) {
  if (target.type !== 'EXECUTABLE') return undefined;
  const artifacts = target.artifacts ?? [];
  if (typeof target.nameOnDisk === 'string') {
    const named = artifacts.filter((artifact) => typeof artifact.path === 'string' && basename(artifact.path) === target.nameOnDisk);
    if (named.length === 1) return named[0].path;
    throw new Error(`CMake target ${target.name} has no unambiguous primary executable artifact`);
  }
  if (artifacts.length === 1 && typeof artifacts[0].path === 'string') return artifacts[0].path;
  throw new Error(`CMake target ${target.name} does not identify its primary executable`);
}
