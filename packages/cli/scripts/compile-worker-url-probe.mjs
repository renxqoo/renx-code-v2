#!/usr/bin/env bun

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, '..');
const outputPath = path.join(packageRoot, 'release', 'platforms', 'win32-x64', 'bin', 'worker-url-probe.exe');
const workerEntry = path.join(packageRoot, 'scripts', 'worker-ping.ts');

const result = await Bun.build({
  tsconfig: path.join(packageRoot, 'tsconfig.json'),
  compile: {
    target: 'bun-windows-x64-modern',
    outfile: outputPath,
    execArgv: ['--'],
    windows: {},
  },
  entrypoints: [path.join(packageRoot, 'scripts', 'worker-url-probe.ts'), workerEntry],
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log.message);
  }
  process.exit(1);
}

console.log(outputPath);
