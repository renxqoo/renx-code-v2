import * as fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import * as path from 'node:path';
import { minimatch } from 'minimatch';

export const DEFAULT_IGNORE_GLOBS = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/.nuxt/**',
  '**/coverage/**',
];

export interface CollectedFile {
  readonly absolutePath: string;
  readonly relativePath: string;
}

export async function collectFilesByGlob(options: {
  rootPath: string;
  pattern: string;
  includeHidden: boolean;
  ignorePatterns: string[];
  maxResults: number;
}): Promise<{ files: CollectedFile[]; truncated: boolean }> {
  const files: CollectedFile[] = [];
  const queue = [options.rootPath];
  const visited = new Set<string>();
  let truncated = false;

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    let realCurrent: string;
    try {
      realCurrent = await fs.realpath(current);
    } catch {
      continue;
    }

    if (visited.has(realCurrent)) {
      continue;
    }
    visited.add(realCurrent);

    let entries: Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (!options.includeHidden && entry.name.startsWith('.')) {
        continue;
      }

      const absolutePath = path.join(current, entry.name);
      const relativePath = path.relative(options.rootPath, absolutePath).split(path.sep).join('/');
      if (!relativePath || relativePath === '.') {
        continue;
      }

      const ignored = options.ignorePatterns.some((pattern) =>
        minimatch(relativePath, pattern, { dot: options.includeHidden })
      );
      if (ignored) {
        continue;
      }

      if (entry.isDirectory()) {
        queue.push(absolutePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (!minimatch(relativePath, options.pattern, { dot: options.includeHidden })) {
        continue;
      }

      files.push({ absolutePath, relativePath });
      if (files.length >= options.maxResults) {
        truncated = true;
        return { files, truncated };
      }
    }
  }

  return { files, truncated };
}
