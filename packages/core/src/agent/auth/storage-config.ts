import * as path from 'node:path';
import { resolveRenxStorageRoot } from '../../config/paths';

export const AGENT_AUTH_STORAGE_DIR_ENV = 'AGENT_AUTH_STORAGE_DIR';
export const AGENT_AUTH_POLICY_VERSION_ENV = 'AGENT_AUTH_POLICY_VERSION';

const DEFAULT_AUTH_SUBDIR = 'auth';
const DEFAULT_POLICY_VERSION = 'auth-v1';

export interface AuthorizationStorageConfig {
  readonly rootDir: string;
  readonly grantsFilePath: string;
  readonly approvalsFilePath: string;
  readonly auditsFilePath: string;
  readonly policyVersion: string;
}

export function getAuthorizationStorageConfig(
  env: NodeJS.ProcessEnv = process.env
): AuthorizationStorageConfig {
  const configuredRoot = env[AGENT_AUTH_STORAGE_DIR_ENV]?.trim();
  const rootDir =
    configuredRoot && configuredRoot.length > 0
      ? path.resolve(configuredRoot)
      : path.join(resolveRenxStorageRoot(env), DEFAULT_AUTH_SUBDIR);

  return {
    rootDir,
    grantsFilePath: path.join(rootDir, 'permission-grants.json'),
    approvalsFilePath: path.join(rootDir, 'approval-decisions.json'),
    auditsFilePath: path.join(rootDir, 'authorization-audit.json'),
    policyVersion: env[AGENT_AUTH_POLICY_VERSION_ENV]?.trim() || DEFAULT_POLICY_VERSION,
  };
}

export function resolveAuthorizationStorageRoot(override?: string): string {
  if (override && override.trim().length > 0) {
    return path.resolve(override);
  }
  return getAuthorizationStorageConfig().rootDir;
}
