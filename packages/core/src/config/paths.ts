import { homedir } from 'node:os';
import * as path from 'node:path';

export const RENX_HOME_ENV = 'RENX_HOME';
const DEFAULT_RENX_DIRNAME = '.renx';

function readEnvPath(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key]?.trim();
  return value && value.length > 0 ? path.resolve(value) : undefined;
}

export function resolveRenxHome(env: NodeJS.ProcessEnv = process.env): string {
  return readEnvPath(env, RENX_HOME_ENV) ?? path.join(homedir(), DEFAULT_RENX_DIRNAME);
}

export function resolveRenxLogsDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveRenxHome(env), 'logs');
}

export function resolveRenxStorageRoot(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveRenxHome(env), 'storage');
}

export function resolveRenxTaskDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveRenxHome(env), 'task');
}

export function resolveRenxSkillsDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveRenxHome(env), 'skills');
}

export function resolveDefaultSkillRoots(
  workspaceRoot: string,
  env: NodeJS.ProcessEnv = process.env
): string[] {
  return [
    path.join(homedir(), '.agents', 'skills'),
    resolveRenxSkillsDir(env),
    path.join(workspaceRoot, '.agents', 'skills'),
    path.join(workspaceRoot, '.renx', 'skills'),
    path.resolve(workspaceRoot, '..', 'core', 'src', 'skills'),
    path.join(workspaceRoot, 'packages', 'core', 'src', 'skills'),
  ].filter((value, index, array) => value.length > 0 && array.indexOf(value) === index);
}

export function resolveRenxDatabasePath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveRenxHome(env), 'data.db');
}
