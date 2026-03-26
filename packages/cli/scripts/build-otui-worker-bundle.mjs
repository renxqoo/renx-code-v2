#!/usr/bin/env bun

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, '..');
const outdir = path.join(packageRoot, 'release', 'platforms', 'win32-x64', 'bin', 'otui-worker-bundle');

const result = await Bun.build({
  target: 'bun',
  entrypoints: [path.join(packageRoot, 'node_modules', '@opentui', 'core', 'parser.worker.js')],
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

for (const output of result.outputs) {
  console.log(output.path);
}
