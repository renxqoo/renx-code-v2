import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.resolve(__dirname, '..', 'dist');

const extsToKeep = new Set(['.js', '.mjs', '.cjs', '.json', '.node']);

const resolveRuntimeSpecifier = (sourceFilePath, specifier) => {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
    return null;
  }

  const ext = path.extname(specifier);
  if (extsToKeep.has(ext)) {
    return null;
  }

  const sourceDir = path.dirname(sourceFilePath);
  const baseTarget = path.resolve(sourceDir, specifier);
  const asFile = `${baseTarget}.js`;
  if (existsSync(asFile)) {
    return `${specifier}.js`;
  }

  const asIndex = path.join(baseTarget, 'index.js');
  if (existsSync(asIndex)) {
    return `${specifier}/index.js`;
  }

  return null;
};

const rewriteContent = (filePath, content) => {
  return content
    .replace(/(from\s+['"])(\.{1,2}\/[^'"]+)(['"])/g, (match, prefix, specifier, suffix) => {
      const resolved = resolveRuntimeSpecifier(filePath, specifier);
      if (!resolved) {
        return match;
      }
      return `${prefix}${resolved}${suffix}`;
    })
    .replace(/(import\s*\(\s*['"])(\.{1,2}\/[^'"]+)(['"]\s*\))/g, (match, prefix, specifier, suffix) => {
      const resolved = resolveRuntimeSpecifier(filePath, specifier);
      if (!resolved) {
        return match;
      }
      return `${prefix}${resolved}${suffix}`;
    });
};

const walk = (dir, files = []) => {
  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      walk(fullPath, files);
      continue;
    }
    if (fullPath.endsWith('.js') || fullPath.endsWith('.d.ts')) {
      files.push(fullPath);
    }
  }
  return files;
};

for (const filePath of walk(distDir)) {
  const original = readFileSync(filePath, 'utf8');
  const updated = rewriteContent(filePath, original);
  if (updated !== original) {
    writeFileSync(filePath, updated, 'utf8');
  }
}
