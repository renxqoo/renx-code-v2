import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type {
  ToolExecutionPlan,
  ToolFileSystemPolicy,
  ToolNetworkPolicy,
  ToolPermissionProfile,
} from './contracts';
import { ToolV2PermissionError } from './errors';

function expandHomePath(rawPath: string): string {
  if (rawPath === '~') {
    return os.homedir();
  }
  if (rawPath.startsWith('~/')) {
    return path.join(os.homedir(), rawPath.slice(2));
  }
  return rawPath;
}

function normalizeRoot(inputPath: string): string {
  return path.resolve(expandHomePath(inputPath));
}

function isWithinRoot(candidatePath: string, rootPath: string): boolean {
  return candidatePath === rootPath || candidatePath.startsWith(`${rootPath}${path.sep}`);
}

function normalizeHost(host: string): string {
  return host.trim().toLowerCase();
}

function resolvePermissionRoot(resolvedPath: string): string {
  try {
    const stats = fs.statSync(resolvedPath);
    if (stats.isDirectory()) {
      return resolvedPath;
    }
  } catch {
    // Fall back to parent directory for files that do not exist yet.
  }

  return path.dirname(resolvedPath);
}

function compactRoots(roots: Iterable<string>): string[] {
  const sorted = Array.from(new Set(roots)).sort((left, right) => left.length - right.length);
  const result: string[] = [];

  for (const root of sorted) {
    if (result.some((existing) => isWithinRoot(root, existing))) {
      continue;
    }
    result.push(root);
  }

  return result;
}

export function createWorkspaceFileSystemPolicy(
  workspaceRoot = process.cwd()
): ToolFileSystemPolicy {
  const normalized = normalizeRoot(workspaceRoot);
  return {
    mode: 'restricted',
    readRoots: [normalized],
    writeRoots: [normalized],
  };
}

export function createReadOnlyFileSystemPolicy(
  workspaceRoot = process.cwd()
): ToolFileSystemPolicy {
  const normalized = normalizeRoot(workspaceRoot);
  return {
    mode: 'restricted',
    readRoots: [normalized],
    writeRoots: [],
  };
}

export function createUnrestrictedFileSystemPolicy(): ToolFileSystemPolicy {
  return {
    mode: 'unrestricted',
    readRoots: [],
    writeRoots: [],
  };
}

export function createRestrictedNetworkPolicy(): ToolNetworkPolicy {
  return {
    mode: 'restricted',
  };
}

export function createEnabledNetworkPolicy(): ToolNetworkPolicy {
  return {
    mode: 'enabled',
  };
}

export function normalizeFileSystemPolicy(policy: ToolFileSystemPolicy): ToolFileSystemPolicy {
  return {
    mode: policy.mode,
    readRoots: policy.readRoots.map(normalizeRoot),
    writeRoots: policy.writeRoots.map(normalizeRoot),
  };
}

export function normalizeNetworkPolicy(policy: ToolNetworkPolicy): ToolNetworkPolicy {
  return {
    mode: policy.mode,
    allowedHosts: policy.allowedHosts?.map(normalizeHost),
    deniedHosts: policy.deniedHosts?.map(normalizeHost),
  };
}

export function normalizePermissionProfile(
  profile?: ToolPermissionProfile | null
): ToolPermissionProfile | undefined {
  if (!profile) {
    return undefined;
  }
  return {
    fileSystem: profile.fileSystem
      ? {
          read: (profile.fileSystem.read || []).map(normalizeRoot),
          write: (profile.fileSystem.write || []).map(normalizeRoot),
        }
      : undefined,
    network: profile.network
      ? {
          enabled: profile.network.enabled,
          allowedHosts: profile.network.allowedHosts?.map(normalizeHost),
          deniedHosts: profile.network.deniedHosts?.map(normalizeHost),
        }
      : undefined,
  };
}

export function mergePermissionProfiles(
  base?: ToolPermissionProfile,
  extra?: ToolPermissionProfile
): ToolPermissionProfile | undefined {
  const normalizedBase = normalizePermissionProfile(base);
  const normalizedExtra = normalizePermissionProfile(extra);
  if (!normalizedBase && !normalizedExtra) {
    return undefined;
  }
  return {
    fileSystem: {
      read: Array.from(
        new Set([
          ...(normalizedBase?.fileSystem?.read || []),
          ...(normalizedExtra?.fileSystem?.read || []),
        ])
      ),
      write: Array.from(
        new Set([
          ...(normalizedBase?.fileSystem?.write || []),
          ...(normalizedExtra?.fileSystem?.write || []),
        ])
      ),
    },
    network: {
      enabled: normalizedExtra?.network?.enabled ?? normalizedBase?.network?.enabled ?? undefined,
      allowedHosts: Array.from(
        new Set([
          ...(normalizedBase?.network?.allowedHosts || []),
          ...(normalizedExtra?.network?.allowedHosts || []),
        ])
      ),
      deniedHosts: Array.from(
        new Set([
          ...(normalizedBase?.network?.deniedHosts || []),
          ...(normalizedExtra?.network?.deniedHosts || []),
        ])
      ),
    },
  };
}

export interface EffectiveToolPermissions {
  readonly fileSystem: ToolFileSystemPolicy;
  readonly network: ToolNetworkPolicy;
}

export function applyPermissionProfile(
  base: EffectiveToolPermissions,
  grants?: ToolPermissionProfile
): EffectiveToolPermissions {
  const normalizedFileSystem = normalizeFileSystemPolicy(base.fileSystem);
  const normalizedNetwork = normalizeNetworkPolicy(base.network);
  const normalizedGrants = normalizePermissionProfile(grants);
  if (!normalizedGrants) {
    return {
      fileSystem: normalizedFileSystem,
      network: normalizedNetwork,
    };
  }

  return {
    fileSystem:
      normalizedFileSystem.mode === 'unrestricted'
        ? normalizedFileSystem
        : {
            mode: normalizedFileSystem.mode,
            readRoots: Array.from(
              new Set([
                ...normalizedFileSystem.readRoots,
                ...normalizedFileSystem.writeRoots,
                ...(normalizedGrants.fileSystem?.read || []),
                ...(normalizedGrants.fileSystem?.write || []),
              ])
            ),
            writeRoots: Array.from(
              new Set([
                ...normalizedFileSystem.writeRoots,
                ...(normalizedGrants.fileSystem?.write || []),
              ])
            ),
          },
    network:
      normalizedGrants.network?.enabled === true
        ? {
            mode: 'enabled',
            allowedHosts: Array.from(
              new Set([
                ...(normalizedNetwork.allowedHosts || []),
                ...(normalizedGrants.network.allowedHosts || []),
              ])
            ),
            deniedHosts: Array.from(
              new Set([
                ...(normalizedNetwork.deniedHosts || []),
                ...(normalizedGrants.network.deniedHosts || []),
              ])
            ),
          }
        : normalizedNetwork,
  };
}

export function isPermissionProfileSatisfied(
  base: EffectiveToolPermissions,
  requested?: ToolPermissionProfile
): boolean {
  const normalizedFileSystem = normalizeFileSystemPolicy(base.fileSystem);
  const normalizedNetwork = normalizeNetworkPolicy(base.network);
  const normalizedRequested = normalizePermissionProfile(requested);
  if (!normalizedRequested) {
    return true;
  }

  if (normalizedFileSystem.mode === 'unrestricted') {
    if (
      normalizedRequested.network?.enabled !== true &&
      (normalizedRequested.network?.allowedHosts || []).length === 0 &&
      (normalizedRequested.network?.deniedHosts || []).length === 0
    ) {
      return true;
    }
  }

  const readableRoots = Array.from(
    new Set([...normalizedFileSystem.readRoots, ...normalizedFileSystem.writeRoots])
  );
  for (const requestedRead of normalizedRequested.fileSystem?.read || []) {
    if (!readableRoots.some((root) => isWithinRoot(requestedRead, root))) {
      return false;
    }
  }

  for (const requestedWrite of normalizedRequested.fileSystem?.write || []) {
    if (!normalizedFileSystem.writeRoots.some((root) => isWithinRoot(requestedWrite, root))) {
      return false;
    }
  }

  if (normalizedRequested.network?.enabled === true && normalizedNetwork.mode !== 'enabled') {
    return false;
  }

  const deniedHosts = new Set(normalizedNetwork.deniedHosts || []);
  if (
    (normalizedRequested.network?.allowedHosts || []).some((host) =>
      deniedHosts.has(normalizeHost(host))
    )
  ) {
    return false;
  }

  if (
    normalizedNetwork.allowedHosts &&
    normalizedNetwork.allowedHosts.length > 0 &&
    (normalizedRequested.network?.allowedHosts || []).some(
      (host) => !normalizedNetwork.allowedHosts?.includes(normalizeHost(host))
    )
  ) {
    return false;
  }

  return true;
}

export function collectMissingPermissionProfile(
  plan: Pick<ToolExecutionPlan, 'readPaths' | 'writePaths' | 'networkTargets'>,
  workingDirectory: string,
  base: EffectiveToolPermissions
): ToolPermissionProfile | undefined {
  const normalizedFileSystem = normalizeFileSystemPolicy(base.fileSystem);
  const normalizedNetwork = normalizeNetworkPolicy(base.network);
  const readableRoots = Array.from(
    new Set(
      normalizedFileSystem.mode === 'unrestricted'
        ? []
        : [...normalizedFileSystem.readRoots, ...normalizedFileSystem.writeRoots]
    )
  );
  const missingRead = new Set<string>();
  const missingWrite = new Set<string>();
  const missingHosts = new Set<string>();

  if (normalizedFileSystem.mode !== 'unrestricted') {
    for (const readPath of plan.readPaths || []) {
      const resolvedPath = resolveToolPath(readPath, workingDirectory);
      if (!readableRoots.some((root) => isWithinRoot(resolvedPath, root))) {
        missingRead.add(resolvePermissionRoot(resolvedPath));
      }
    }

    for (const writePath of plan.writePaths || []) {
      const resolvedPath = resolveToolPath(writePath, workingDirectory);
      if (!normalizedFileSystem.writeRoots.some((root) => isWithinRoot(resolvedPath, root))) {
        missingWrite.add(resolvePermissionRoot(resolvedPath));
      }
    }
  }

  for (const networkTarget of plan.networkTargets || []) {
    let url: URL;
    try {
      url = new URL(networkTarget);
    } catch {
      continue;
    }

    if (!['http:', 'https:'].includes(url.protocol)) {
      continue;
    }

    const host = normalizeHost(url.hostname);
    const blockedByAllowlist =
      normalizedNetwork.allowedHosts &&
      normalizedNetwork.allowedHosts.length > 0 &&
      !normalizedNetwork.allowedHosts.includes(host);
    const blockedByMode = normalizedNetwork.mode !== 'enabled';
    if (blockedByAllowlist || blockedByMode) {
      missingHosts.add(host);
    }
  }

  if (missingRead.size === 0 && missingWrite.size === 0 && missingHosts.size === 0) {
    return undefined;
  }

  return {
    fileSystem:
      missingRead.size > 0 || missingWrite.size > 0
        ? {
            read: compactRoots(missingRead),
            write: compactRoots(missingWrite),
          }
        : undefined,
    network:
      missingHosts.size > 0
        ? {
            enabled: true,
            allowedHosts: Array.from(missingHosts),
          }
        : undefined,
  };
}

export function resolveToolPath(requestedPath: string, workingDirectory: string): string {
  const expanded = expandHomePath(requestedPath.trim());
  if (path.isAbsolute(expanded)) {
    return path.resolve(expanded);
  }
  return path.resolve(workingDirectory, expanded);
}

export function assertReadAccess(
  requestedPath: string,
  workingDirectory: string,
  policy: ToolFileSystemPolicy
): string {
  const resolvedPath = resolveToolPath(requestedPath, workingDirectory);
  const normalizedPolicy = normalizeFileSystemPolicy(policy);
  if (normalizedPolicy.mode === 'unrestricted') {
    return resolvedPath;
  }

  const readableRoots = Array.from(
    new Set([...normalizedPolicy.readRoots, ...normalizedPolicy.writeRoots])
  );
  if (readableRoots.some((root) => isWithinRoot(resolvedPath, root))) {
    return resolvedPath;
  }

  throw new ToolV2PermissionError(`Read access denied: ${requestedPath}`, {
    requestedPath: resolvedPath,
    readableRoots,
  });
}

export function assertWriteAccess(
  requestedPath: string,
  workingDirectory: string,
  policy: ToolFileSystemPolicy
): string {
  const resolvedPath = resolveToolPath(requestedPath, workingDirectory);
  const normalizedPolicy = normalizeFileSystemPolicy(policy);
  if (normalizedPolicy.mode === 'unrestricted') {
    return resolvedPath;
  }

  if (normalizedPolicy.writeRoots.some((root) => isWithinRoot(resolvedPath, root))) {
    return resolvedPath;
  }

  throw new ToolV2PermissionError(`Write access denied: ${requestedPath}`, {
    requestedPath: resolvedPath,
    writableRoots: normalizedPolicy.writeRoots,
  });
}

export function assertNetworkAccess(urlString: string, policy: ToolNetworkPolicy): URL {
  const normalizedPolicy = normalizeNetworkPolicy(policy);
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new ToolV2PermissionError(`Invalid URL: ${urlString}`);
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new ToolV2PermissionError(`Unsupported URL protocol: ${url.protocol}`);
  }

  if (normalizedPolicy.mode !== 'enabled') {
    throw new ToolV2PermissionError(`Network access denied: ${urlString}`);
  }

  const host = normalizeHost(url.hostname);
  if (normalizedPolicy.deniedHosts?.includes(host)) {
    throw new ToolV2PermissionError(`Network access denied for host: ${host}`);
  }
  if (
    normalizedPolicy.allowedHosts &&
    normalizedPolicy.allowedHosts.length > 0 &&
    !normalizedPolicy.allowedHosts.includes(host)
  ) {
    throw new ToolV2PermissionError(`Host is not in allowlist: ${host}`);
  }

  return url;
}
