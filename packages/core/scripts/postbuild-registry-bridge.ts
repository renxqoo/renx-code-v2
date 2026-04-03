/**
 * Post-build fix: generate dist/providers/registry/index.js
 *
 * Node ESM resolves `from './registry'` to the directory `./registry/`
 * (which contains compiled sub-modules) instead of the file `./registry.js`.
 * This script creates a bridge index.js so the directory import works.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const indexPath = join(__dirname, '..', 'dist', 'providers', 'registry', 'index.js');

mkdirSync(dirname(indexPath), { recursive: true });
writeFileSync(indexPath, "export { ProviderRegistry, Models, MODEL_CONFIGS } from '../registry.js';\n");
console.log('postbuild: wrote dist/providers/registry/index.js');
