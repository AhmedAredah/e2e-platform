/** Records the completed package's source, public entries, and generated file hashes. */
import { writeFileSync } from 'node:fs';
import { buildInventory } from './dist-integrity.mjs';

writeFileSync('dist/.build.json', `${JSON.stringify(buildInventory())}\n`);
