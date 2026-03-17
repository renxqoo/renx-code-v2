import type {
  ToolApprovalPolicy,
  ToolFileSystemPolicy,
  ToolNetworkPolicy,
  ToolTrustLevel,
} from './contracts';
import {
  createReadOnlyFileSystemPolicy,
  createRestrictedNetworkPolicy,
  createWorkspaceFileSystemPolicy,
  normalizeFileSystemPolicy,
} from './permissions';

export const DEFAULT_TOOL_TRUST_LEVEL: ToolTrustLevel = 'unknown';

export interface DefaultToolExecutionBaseline {
  readonly fileSystemPolicy: ToolFileSystemPolicy;
  readonly networkPolicy: ToolNetworkPolicy;
  readonly approvalPolicy: ToolApprovalPolicy;
  readonly trustLevel: ToolTrustLevel;
}

export interface CreateDefaultToolExecutionBaselineOptions {
  readonly workingDirectory?: string;
  readonly trustLevel?: ToolTrustLevel;
}

export function resolveDefaultToolTrustLevel(trustLevel?: ToolTrustLevel): ToolTrustLevel {
  return trustLevel || DEFAULT_TOOL_TRUST_LEVEL;
}

export function resolveDefaultApprovalPolicyForTrust(
  trustLevel?: ToolTrustLevel
): ToolApprovalPolicy {
  return resolveDefaultToolTrustLevel(trustLevel) === 'untrusted' ? 'unless-trusted' : 'on-request';
}

export function resolveDefaultFileSystemPolicyForTrust(
  workingDirectory?: string,
  trustLevel?: ToolTrustLevel
): ToolFileSystemPolicy {
  const resolvedTrustLevel = resolveDefaultToolTrustLevel(trustLevel);
  return resolvedTrustLevel === 'unknown'
    ? createReadOnlyFileSystemPolicy(workingDirectory)
    : createWorkspaceFileSystemPolicy(workingDirectory);
}

export function isDerivedDefaultApprovalPolicy(
  approvalPolicy: ToolApprovalPolicy,
  trustLevel?: ToolTrustLevel
): boolean {
  return approvalPolicy === resolveDefaultApprovalPolicyForTrust(trustLevel);
}

export function isDerivedDefaultFileSystemPolicy(
  fileSystemPolicy: ToolFileSystemPolicy,
  workingDirectory?: string,
  trustLevel?: ToolTrustLevel
): boolean {
  const left = normalizeFileSystemPolicy(fileSystemPolicy);
  const right = normalizeFileSystemPolicy(
    resolveDefaultFileSystemPolicyForTrust(workingDirectory, trustLevel)
  );
  return (
    left.mode === right.mode &&
    areStringListsEqual(left.readRoots, right.readRoots) &&
    areStringListsEqual(left.writeRoots, right.writeRoots)
  );
}

export function createDefaultToolExecutionBaseline(
  options: CreateDefaultToolExecutionBaselineOptions = {}
): DefaultToolExecutionBaseline {
  const trustLevel = resolveDefaultToolTrustLevel(options.trustLevel);
  return {
    fileSystemPolicy: resolveDefaultFileSystemPolicyForTrust(options.workingDirectory, trustLevel),
    networkPolicy: createRestrictedNetworkPolicy(),
    approvalPolicy: resolveDefaultApprovalPolicyForTrust(trustLevel),
    trustLevel,
  };
}

function areStringListsEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const normalizedLeft = [...left].sort();
  const normalizedRight = [...right].sort();
  return normalizedLeft.every((value, index) => value === normalizedRight[index]);
}
