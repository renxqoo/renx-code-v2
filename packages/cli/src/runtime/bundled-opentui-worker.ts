import * as fs from 'node:fs';
import path from 'node:path';

export function resolveBundledOpenTuiWorkerEnv(
  env: NodeJS.ProcessEnv = process.env,
  binaryPackageRoot?: string,
  pathExists: (candidate: string) => boolean = fs.existsSync
): NodeJS.ProcessEnv {
  if (env.OTUI_TREE_SITTER_WORKER_PATH) {
    return {
      OTUI_TREE_SITTER_WORKER_PATH: env.OTUI_TREE_SITTER_WORKER_PATH,
    };
  }

  if (!binaryPackageRoot) {
    return {};
  }

  const wrapperPath = path.join(
    binaryPackageRoot,
    'bin',
    'otui-worker-bundle',
    'parser.worker.wrapper.mjs'
  );

  if (!pathExists(wrapperPath)) {
    return {};
  }

  return {
    OTUI_TREE_SITTER_WORKER_PATH: wrapperPath,
  };
}
