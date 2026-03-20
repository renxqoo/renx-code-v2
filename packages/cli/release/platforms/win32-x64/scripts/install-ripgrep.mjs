#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, '..');
const manifestPath = path.join(packageRoot, 'bin', 'rg');

const TARGETS = {
  'darwin:arm64': { target: 'aarch64-apple-darwin', platformKey: 'macos-aarch64' },
  'darwin:x64': { target: 'x86_64-apple-darwin', platformKey: 'macos-x86_64' },
  'linux:arm64': { target: 'aarch64-unknown-linux-musl', platformKey: 'linux-aarch64' },
  'linux:x64': { target: 'x86_64-unknown-linux-musl', platformKey: 'linux-x86_64' },
  'win32:arm64': { target: 'aarch64-pc-windows-msvc', platformKey: 'windows-aarch64' },
  'win32:x64': { target: 'x86_64-pc-windows-msvc', platformKey: 'windows-x86_64' },
};

async function main() {
  if (process.env.RENX_SKIP_RIPGREP_INSTALL === '1') {
    console.log('[renx] skipping bundled ripgrep install (RENX_SKIP_RIPGREP_INSTALL=1)');
    return;
  }

  const targetInfo = TARGETS[`${process.platform}:${process.arch}`];
  if (!targetInfo) {
    console.warn(
      `[renx] no bundled ripgrep target for ${process.platform}/${process.arch}; falling back to system rg if available`
    );
    return;
  }

  const manifest = await loadManifest(manifestPath);
  const platformInfo = manifest.platforms?.[targetInfo.platformKey];
  if (!platformInfo) {
    throw new Error(`ripgrep manifest is missing platform ${targetInfo.platformKey}`);
  }

  const binaryName = process.platform === 'win32' ? 'rg.exe' : 'rg';
  const installDir = path.join(packageRoot, 'vendor', 'ripgrep', targetInfo.target, 'path');
  const binaryPath = path.join(installDir, binaryName);
  if (await fileExists(binaryPath)) {
    return;
  }

  await fs.mkdir(installDir, { recursive: true });

  const provider = platformInfo.providers?.[0];
  const url = provider?.url;
  if (!url) {
    throw new Error(`ripgrep manifest has no provider URL for ${targetInfo.platformKey}`);
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-ripgrep-'));
  try {
    const archivePath = path.join(tempDir, path.basename(new URL(url).pathname));
    console.log(`[renx] downloading ripgrep for ${targetInfo.target}`);
    await downloadFile(url, archivePath);
    await verifyArchive(archivePath, platformInfo);

    const extractDir = path.join(tempDir, 'extract');
    await fs.mkdir(extractDir, { recursive: true });
    await extractArchive(archivePath, platformInfo.format, extractDir);

    const memberPath = path.join(extractDir, platformInfo.path);
    await fs.copyFile(memberPath, binaryPath);
    if (process.platform !== 'win32') {
      await fs.chmod(binaryPath, 0o755);
    }
    console.log(`[renx] installed bundled ripgrep to ${binaryPath}`);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function loadManifest(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  const json = raw.startsWith('#!') ? raw.split('\n').slice(1).join('\n') : raw;
  return JSON.parse(json);
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function downloadFile(url, destination) {
  await new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      if (
        response.statusCode &&
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        response.headers.location
      ) {
        response.resume();
        downloadFile(response.headers.location, destination).then(resolve, reject);
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`download failed with status ${response.statusCode ?? 'unknown'}`));
        return;
      }

      const output = createWriteStream(destination);
      response.pipe(output);
      output.on('finish', () => {
        output.close();
        resolve(undefined);
      });
      output.on('error', reject);
    });
    request.on('error', reject);
  });
}

async function verifyArchive(archivePath, platformInfo) {
  const stats = await fs.stat(archivePath);
  if (typeof platformInfo.size === 'number' && stats.size !== platformInfo.size) {
    throw new Error(
      `unexpected ripgrep archive size: expected ${platformInfo.size}, got ${stats.size}`
    );
  }

  if (platformInfo.hash === 'sha256' && platformInfo.digest) {
    const file = await fs.readFile(archivePath);
    const digest = createHash('sha256').update(file).digest('hex');
    if (digest !== platformInfo.digest) {
      throw new Error('ripgrep archive sha256 digest mismatch');
    }
  }
}

async function extractArchive(archivePath, format, destination) {
  if (format === 'zip') {
    const command = resolvePowerShellExecutable();
    const result = spawnSync(
      command,
      [
        '-NoProfile',
        '-Command',
        `Expand-Archive -LiteralPath '${escapePowerShell(archivePath)}' -DestinationPath '${escapePowerShell(destination)}' -Force`,
      ],
      {
        stdio: 'inherit',
        windowsHide: true,
      }
    );
    if (result.error || result.status !== 0) {
      throw new Error('failed to extract ripgrep zip archive');
    }
    return;
  }

  if (format === 'tar.gz') {
    const result = spawnSync('tar', ['-xzf', archivePath, '-C', destination], {
      stdio: 'inherit',
      windowsHide: true,
    });
    if (result.error || result.status !== 0) {
      throw new Error('failed to extract ripgrep tar.gz archive');
    }
    return;
  }

  throw new Error(`unsupported ripgrep archive format: ${format}`);
}

function resolvePowerShellExecutable() {
  return process.env.SystemRoot
    ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    : 'powershell.exe';
}

function escapePowerShell(value) {
  return value.replace(/'/g, "''");
}

main().catch((error) => {
  console.warn(
    `[renx] bundled ripgrep install skipped: ${error instanceof Error ? error.message : String(error)}`
  );
});
