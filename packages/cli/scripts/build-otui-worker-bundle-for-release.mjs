#!/usr/bin/env bun

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { RELEASE_TARGET_BY_ID } from './release-targets.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, '..');
const [targetId, outdir] = process.argv.slice(2);

if (!targetId || !outdir) {
  console.error(
    'Usage: bun ./scripts/build-otui-worker-bundle-for-release.mjs <targetId> <outdir>'
  );
  process.exit(1);
}

const target = RELEASE_TARGET_BY_ID.get(targetId);
if (!target) {
  console.error(`Unknown release target: ${targetId}`);
  process.exit(1);
}

mkdirSync(outdir, { recursive: true });

const parserWorkerEntry = path.join(packageRoot, 'node_modules', '@opentui', 'core', 'parser.worker.js');
const wrapperPath = path.join(outdir, 'parser.worker.wrapper.mjs');

const result = await Bun.build({
  target: 'bun',
  entrypoints: [parserWorkerEntry],
  outdir,
  minify: false,
  sourcemap: 'none',
  splitting: false,
  naming: '[name].[ext]',
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log.message);
  }
  process.exit(1);
}

writeFileSync(
  wrapperPath,
  [
    "import path from 'node:path';",
    "import { fileURLToPath, pathToFileURL } from 'node:url';",
    '',
    'const __filename = fileURLToPath(import.meta.url);',
    'const __dirname = path.dirname(__filename);',
    'process.chdir(__dirname);',
    "await import(pathToFileURL(path.join(__dirname, 'parser.worker.js')).href);",
    '',
  ].join('\n')
);

for (const output of result.outputs) {
  console.log(output.path);
}
console.log(wrapperPath);
