#!/usr/bin/env bun

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { RELEASE_TARGET_BY_ID } from './release-targets.mjs';
import { toBundledBunfsPath } from '../src/runtime/bunfs-path.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, '..');
const [targetId, binaryOutputPath, parserWorkerPath, version] = process.argv.slice(2);

if (!targetId || !binaryOutputPath || !parserWorkerPath || !version) {
  console.error(
    'Usage: bun ./scripts/compile-release-target.mjs <targetId> <binaryOutputPath> <parserWorkerPath> <version>'
  );
  process.exit(1);
}

const target = RELEASE_TARGET_BY_ID.get(targetId);
if (!target) {
  console.error(`Unknown release target: ${targetId}`);
  process.exit(1);
}

const workerRelativePath = path.relative(packageRoot, parserWorkerPath).replaceAll('\\', '/');
const workerBundledPath = toBundledBunfsPath(workerRelativePath, target.os);
const compile = {
  target: target.bunTarget,
  outfile: binaryOutputPath,
  execArgv: ['--'],
};

if (target.os === 'win32') {
  compile.windows = {};
}

try {
  const result = await Bun.build({
    tsconfig: path.join(packageRoot, 'tsconfig.json'),
    compile,
    entrypoints: [path.join(packageRoot, 'src', 'index.tsx'), parserWorkerPath],
    define: {
      OTUI_TREE_SITTER_WORKER_PATH: JSON.stringify(workerBundledPath),
      RENX_BUILD_VERSION: JSON.stringify(version),
    },
  });

  if (!result.success) {
    for (const log of result.logs) {
      console.error(log.message);
    }
    console.error(`Failed to compile target ${target.id}.`);
    process.exit(1);
  }
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(`Failed to compile target ${target.id}: ${detail}`);
  process.exit(1);
}
