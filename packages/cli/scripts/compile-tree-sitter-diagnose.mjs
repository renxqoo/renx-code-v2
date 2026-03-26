#!/usr/bin/env bun

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { toBundledBunfsPath } from '../src/runtime/bunfs-path.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, '..');
const outputPath = path.join(packageRoot, 'release', 'platforms', 'win32-x64', 'bin', 'tree-sitter-diagnose.exe');
const parserWorkerPath = path.join(packageRoot, 'node_modules', '@opentui', 'core', 'parser.worker.js');
const workerRelativePath = path.relative(packageRoot, parserWorkerPath).replaceAll('\\', '/');
const workerBundledPath = toBundledBunfsPath(workerRelativePath, 'win32');

const result = await Bun.build({
  tsconfig: path.join(packageRoot, 'tsconfig.json'),
  compile: {
    target: 'bun-windows-x64-modern',
    outfile: outputPath,
    execArgv: ['--'],
    windows: {},
  },
  entrypoints: [path.join(packageRoot, 'scripts', 'tree-sitter-diagnose.ts'), parserWorkerPath],
  define: {
    OTUI_TREE_SITTER_WORKER_PATH: JSON.stringify(workerBundledPath),
  },
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log.message);
  }
  process.exit(1);
}

console.log(outputPath);
