import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Records the compiler and Qt configuration that CMake actually selected. */
export function readBuildQualification(directory) {
  const cacheText = readFileSync(join(directory, 'CMakeCache.txt'), 'utf8');
  const cache = new Map([...cacheText.matchAll(/^([^/#\r\n][^:\r\n]*):[^=\r\n]+=(.*)$/gm)].map((match) => [match[1], match[2].trim()]));
  const cmakeVersion = ['MAJOR', 'MINOR', 'PATCH'].map((part) => cache.get(`CMAKE_CACHE_${part}_VERSION`)).join('.');
  if (!/^\d+\.\d+\.\d+$/.test(cmakeVersion)) throw new Error('CMake cache does not identify its version');
  const compiler = readFileSync(join(directory, 'CMakeFiles', cmakeVersion, 'CMakeCXXCompiler.cmake'), 'utf8');
  const setting = (name) => compiler.match(new RegExp(`set\\(${name} "([^"\\n]*)"\\)`))?.[1] ?? null;
  let qtVersion = null;
  const qtDirectory = cache.get('Qt6Core_DIR');
  if (qtDirectory) {
    for (const filename of ['Qt6CoreConfigVersion.cmake', 'Qt6CoreConfigVersionImpl.cmake']) {
      const file = join(qtDirectory, filename);
      if (!existsSync(file)) continue;
      const match = readFileSync(file, 'utf8').match(/set\(PACKAGE_VERSION\s+"?([\d.]+)"?\)/);
      if (match) { qtVersion = match[1]; break; }
    }
    if (!qtVersion) throw new Error('Qt was configured but its version cannot be recorded');
  }
  const compilerIdentity = { id: setting('CMAKE_CXX_COMPILER_ID'), version: setting('CMAKE_CXX_COMPILER_VERSION'), path: setting('CMAKE_CXX_COMPILER') };
  if (Object.values(compilerIdentity).some((value) => !value)) throw new Error('CMake compiler identity is incomplete');
  return {
    cmake: cmakeVersion,
    generator: cache.get('CMAKE_GENERATOR') ?? null,
    compiler: compilerIdentity,
    buildType: cache.get('CMAKE_BUILD_TYPE') ?? null,
    configuredTypes: cache.get('CMAKE_CONFIGURATION_TYPES')?.split(';') ?? [],
    qt: qtVersion,
  };
}
