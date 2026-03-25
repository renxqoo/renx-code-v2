import * as fs from 'node:fs';
import * as path from 'node:path';
import { LogLevel } from '../logger';
import {
  resolveRenxDatabasePath,
  resolveRenxHome,
  resolveRenxLogsDir,
  resolveRenxStorageRoot,
} from './paths';
import type {
  ConfigModelDefinition,
  LoadConfigOptions,
  LogConfig,
  RenxConfig,
  ResolvedConfig,
} from './types';

const PROJECT_DIR_NAME = '.renx';
const CONFIG_FILENAME = 'config.json';
const CUSTOM_MODELS_ENV_VAR = 'RENX_CUSTOM_MODELS_JSON';
const AGENT_FULL_ACCESS_ENV = 'AGENT_FULL_ACCESS';
const AGENT_DEFAULT_APPROVAL_POLICY_ENV = 'AGENT_DEFAULT_APPROVAL_POLICY';
const AGENT_DEFAULT_TRUST_LEVEL_ENV = 'AGENT_DEFAULT_TRUST_LEVEL';
const AGENT_DEFAULT_FILESYSTEM_MODE_ENV = 'AGENT_DEFAULT_FILESYSTEM_MODE';
const AGENT_DEFAULT_NETWORK_MODE_ENV = 'AGENT_DEFAULT_NETWORK_MODE';
const AGENT_TIMEOUT_BUDGET_MS_ENV = 'AGENT_TIMEOUT_BUDGET_MS';

const DEFAULTS: RenxConfig = {
  log: {
    level: 'INFO',
    format: 'pretty',
    console: false,
    file: true,
  },
  storage: {
    fileHistory: {
      enabled: true,
      maxPerFile: 20,
      maxAgeDays: 14,
      maxTotalMb: 500,
    },
  },
  agent: {
    maxSteps: 10000,
    defaultModel: 'minimax-2.5',
  },
};

function writeConfigFile(configPath: string, config: Partial<RenxConfig>): string {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return configPath;
}

function ensureGlobalConfigFile(globalDir: string): string {
  const globalConfigPath = path.join(globalDir, CONFIG_FILENAME);
  if (!fs.existsSync(globalConfigPath)) {
    writeConfigFile(globalConfigPath, DEFAULTS);
  }
  return globalConfigPath;
}

function readJsonFile<T>(filePath: string): T | null {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseCustomModelsEnv(
  raw: string | undefined
): Record<string, ConfigModelDefinition> | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isPlainObject(parsed)) {
      return null;
    }

    const result: Record<string, ConfigModelDefinition> = {};
    for (const [modelId, modelConfig] of Object.entries(parsed)) {
      if (!isPlainObject(modelConfig)) {
        continue;
      }
      result[modelId] = modelConfig as ConfigModelDefinition;
    }

    return result;
  } catch {
    return null;
  }
}

function parseLogLevelValue(raw: string | undefined): LogLevel | null {
  if (!raw) {
    return null;
  }

  const normalized = raw.trim().toUpperCase();
  switch (normalized) {
    case 'TRACE':
      return LogLevel.TRACE;
    case 'DEBUG':
      return LogLevel.DEBUG;
    case 'INFO':
      return LogLevel.INFO;
    case 'WARN':
      return LogLevel.WARN;
    case 'ERROR':
      return LogLevel.ERROR;
    case 'FATAL':
      return LogLevel.FATAL;
    default:
      return null;
  }
}

function parseLogLevelString(raw: string | undefined): LogConfig['level'] | null {
  if (!raw) {
    return null;
  }

  const normalized = raw.trim().toUpperCase();
  if (['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'].includes(normalized)) {
    return normalized as LogConfig['level'];
  }
  return null;
}

function parseBoolean(raw: string | undefined): boolean | null {
  if (raw === undefined) {
    return null;
  }

  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return null;
}

function parsePositiveInt(raw: string | undefined): number | null {
  if (!raw) {
    return null;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function parseNonNegativeInt(raw: string | undefined): number | null {
  if (!raw) {
    return null;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function parseApprovalPolicy(
  raw: string | undefined
): 'never' | 'on-request' | 'on-failure' | 'unless-trusted' | null {
  if (!raw) {
    return null;
  }

  const normalized = raw.trim().toLowerCase();
  if (['never', 'on-request', 'on-failure', 'unless-trusted'].includes(normalized)) {
    return normalized as 'never' | 'on-request' | 'on-failure' | 'unless-trusted';
  }
  return null;
}

function parseTrustLevel(raw: string | undefined): 'unknown' | 'trusted' | 'untrusted' | null {
  if (!raw) {
    return null;
  }

  const normalized = raw.trim().toLowerCase();
  if (['unknown', 'trusted', 'untrusted'].includes(normalized)) {
    return normalized as 'unknown' | 'trusted' | 'untrusted';
  }
  return null;
}

function parseFileSystemMode(
  raw: string | undefined
): 'read-only' | 'workspace-write' | 'unrestricted' | null {
  if (!raw) {
    return null;
  }

  const normalized = raw.trim().toLowerCase();
  if (['read-only', 'workspace-write', 'unrestricted'].includes(normalized)) {
    return normalized as 'read-only' | 'workspace-write' | 'unrestricted';
  }
  return null;
}

function parseNetworkMode(raw: string | undefined): 'restricted' | 'enabled' | null {
  if (!raw) {
    return null;
  }

  const normalized = raw.trim().toLowerCase();
  if (normalized === 'restricted' || normalized === 'enabled') {
    return normalized as 'restricted' | 'enabled';
  }
  return null;
}

function deepMerge<T extends object>(base: T, override: Partial<T>): T {
  const result = { ...base };
  for (const key of Object.keys(override) as Array<keyof T>) {
    const value = override[key];
    if (value === undefined || value === null) {
      continue;
    }

    if (
      typeof value === 'object' &&
      !Array.isArray(value) &&
      typeof base[key] === 'object' &&
      base[key] !== null &&
      !Array.isArray(base[key])
    ) {
      result[key] = deepMerge(
        base[key] as Record<string, unknown>,
        value as Record<string, unknown>
      ) as T[keyof T];
      continue;
    }

    result[key] = value as T[keyof T];
  }

  return result;
}

function applyEnvOverrides(config: RenxConfig, env: NodeJS.ProcessEnv): RenxConfig {
  const result: RenxConfig = { ...config };

  const logLevel = parseLogLevelString(env.AGENT_LOG_LEVEL);
  const logFormat = env.AGENT_LOG_FORMAT;
  const logConsole = parseBoolean(env.AGENT_LOG_CONSOLE);
  const logFile = parseBoolean(env.AGENT_LOG_FILE_ENABLED);

  if (logLevel || logFormat || logConsole !== null || logFile !== null) {
    result.log = { ...(result.log ?? {}) };
    if (logLevel) {
      result.log.level = logLevel;
    }
    if (logFormat === 'json' || logFormat === 'pretty') {
      result.log.format = logFormat;
    }
    if (logConsole !== null) {
      result.log.console = logConsole;
    }
    if (logFile !== null) {
      result.log.file = logFile;
    }
  }

  const fileHistoryEnabled = parseBoolean(env.AGENT_FILE_HISTORY_ENABLED);
  const maxPerFile = parseNonNegativeInt(env.AGENT_FILE_HISTORY_MAX_PER_FILE);
  const maxAgeDays = parseNonNegativeInt(env.AGENT_FILE_HISTORY_MAX_AGE_DAYS);
  const maxTotalMb = parseNonNegativeInt(env.AGENT_FILE_HISTORY_MAX_TOTAL_MB);

  if (
    fileHistoryEnabled !== null ||
    maxPerFile !== null ||
    maxAgeDays !== null ||
    maxTotalMb !== null
  ) {
    result.storage = { ...(result.storage ?? {}) };
    result.storage.fileHistory = { ...(result.storage.fileHistory ?? {}) };
    if (fileHistoryEnabled !== null) {
      result.storage.fileHistory.enabled = fileHistoryEnabled;
    }
    if (maxPerFile !== null) {
      result.storage.fileHistory.maxPerFile = maxPerFile;
    }
    if (maxAgeDays !== null) {
      result.storage.fileHistory.maxAgeDays = maxAgeDays;
    }
    if (maxTotalMb !== null) {
      result.storage.fileHistory.maxTotalMb = maxTotalMb;
    }
  }

  const defaultModel = env.AGENT_MODEL?.trim();
  const maxSteps = parsePositiveInt(env.AGENT_MAX_STEPS);
  const timeoutBudgetMs = parsePositiveInt(env[AGENT_TIMEOUT_BUDGET_MS_ENV]);
  const fullAccess = parseBoolean(env[AGENT_FULL_ACCESS_ENV]);
  const approvalPolicy = parseApprovalPolicy(env[AGENT_DEFAULT_APPROVAL_POLICY_ENV]);
  const trustLevel = parseTrustLevel(env[AGENT_DEFAULT_TRUST_LEVEL_ENV]);
  const fileSystemMode = parseFileSystemMode(env[AGENT_DEFAULT_FILESYSTEM_MODE_ENV]);
  const networkMode = parseNetworkMode(env[AGENT_DEFAULT_NETWORK_MODE_ENV]);

  if (
    defaultModel ||
    maxSteps !== null ||
    timeoutBudgetMs !== null ||
    fullAccess !== null ||
    approvalPolicy ||
    trustLevel ||
    fileSystemMode ||
    networkMode
  ) {
    result.agent = { ...(result.agent ?? {}) };
    if (defaultModel) {
      result.agent.defaultModel = defaultModel;
    }
    if (maxSteps !== null) {
      result.agent.maxSteps = maxSteps;
    }
    if (timeoutBudgetMs !== null) {
      result.agent.timeoutBudgetMs = timeoutBudgetMs;
    }
    if (fullAccess !== null || approvalPolicy || trustLevel || fileSystemMode || networkMode) {
      result.agent.permissions = { ...(result.agent.permissions ?? {}) };
      if (fullAccess !== null) {
        result.agent.permissions.fullAccess = fullAccess;
      }
      if (approvalPolicy) {
        result.agent.permissions.approvalPolicy = approvalPolicy;
      }
      if (trustLevel) {
        result.agent.permissions.trustLevel = trustLevel;
      }
      if (fileSystemMode) {
        result.agent.permissions.fileSystemMode = fileSystemMode;
      }
      if (networkMode) {
        result.agent.permissions.networkMode = networkMode;
      }
    }
  }

  const customModels = parseCustomModelsEnv(env[CUSTOM_MODELS_ENV_VAR]);
  if (customModels) {
    result.models = deepMerge(result.models ?? {}, customModels);
  }

  return result;
}

function resolveConfig(
  merged: RenxConfig,
  env: NodeJS.ProcessEnv,
  sources: { global: string | null; project: string | null }
): ResolvedConfig {
  const logDir = resolveRenxLogsDir(env);
  const storageRoot = resolveRenxStorageRoot(env);
  const dbPath = resolveRenxDatabasePath(env);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  return {
    log: {
      level: parseLogLevelValue(merged.log?.level) ?? LogLevel.INFO,
      format: merged.log?.format ?? 'pretty',
      console: merged.log?.console ?? true,
      file: merged.log?.file ?? false,
      dir: logDir,
      filePath: path.join(logDir, `${timestamp}.log`),
    },
    storage: {
      root: storageRoot,
      fileHistory: {
        enabled: merged.storage?.fileHistory?.enabled ?? true,
        maxPerFile: merged.storage?.fileHistory?.maxPerFile ?? 20,
        maxAgeDays: merged.storage?.fileHistory?.maxAgeDays ?? 14,
        maxTotalMb: merged.storage?.fileHistory?.maxTotalMb ?? 500,
      },
    },
    db: {
      path: dbPath,
    },
    agent: {
      maxSteps: merged.agent?.maxSteps ?? 10000,
      defaultModel: merged.agent?.defaultModel ?? 'minimax-2.5',
      timeoutBudgetMs: merged.agent?.timeoutBudgetMs,
      permissions: {
        fullAccess: merged.agent?.permissions?.fullAccess ?? false,
        approvalPolicy: merged.agent?.permissions?.approvalPolicy,
        trustLevel: merged.agent?.permissions?.trustLevel,
        fileSystemMode: merged.agent?.permissions?.fileSystemMode,
        networkMode: merged.agent?.permissions?.networkMode,
      },
    },
    models: merged.models ?? {},
    sources,
  };
}

export function loadConfig(options: LoadConfigOptions = {}): ResolvedConfig {
  const env = options.env ?? process.env;
  const projectRoot = options.projectRoot ?? process.cwd();
  const globalDir = options.globalDir ?? resolveRenxHome(env);

  let config: RenxConfig = { ...DEFAULTS };

  const globalConfigPath = ensureGlobalConfigFile(globalDir);
  const globalConfig = readJsonFile<RenxConfig>(globalConfigPath);
  let globalSource: string | null = null;
  if (globalConfig) {
    config = deepMerge(config, globalConfig);
    globalSource = globalConfigPath;
  }

  const projectConfigPath = path.join(projectRoot, PROJECT_DIR_NAME, CONFIG_FILENAME);
  const projectConfig = readJsonFile<RenxConfig>(projectConfigPath);
  let projectSource: string | null = null;
  if (projectConfig) {
    config = deepMerge(config, projectConfig);
    projectSource = projectConfigPath;
  }

  if (options.loadEnv !== false) {
    config = applyEnvOverrides(config, env);
  }

  return resolveConfig(config, env, {
    global: globalSource,
    project: projectSource,
  });
}

export function loadConfigToEnv(options: LoadConfigOptions = {}): string[] {
  const projectRoot = options.projectRoot ?? process.cwd();
  const globalDir = options.globalDir ?? resolveRenxHome(process.env);
  const loadedFiles: string[] = [];

  const protectedEnvKeys = new Set(Object.keys(process.env));
  const protectedCustomModels = parseCustomModelsEnv(process.env[CUSTOM_MODELS_ENV_VAR]) ?? {};

  const globalConfigPath = ensureGlobalConfigFile(globalDir);
  const globalConfig = readJsonFile<RenxConfig>(globalConfigPath);
  if (globalConfig) {
    applyConfigToEnv(globalConfig, protectedEnvKeys, protectedCustomModels);
    loadedFiles.push(globalConfigPath);
  }

  const projectConfigPath = path.join(projectRoot, PROJECT_DIR_NAME, CONFIG_FILENAME);
  const projectConfig = readJsonFile<RenxConfig>(projectConfigPath);
  if (projectConfig) {
    applyConfigToEnv(projectConfig, protectedEnvKeys, protectedCustomModels);
    loadedFiles.push(projectConfigPath);
  }

  return loadedFiles;
}

function applyConfigToEnv(
  config: RenxConfig,
  protectedEnvKeys: Set<string>,
  protectedCustomModels: Record<string, ConfigModelDefinition>
): void {
  const setIfUnset = (key: string, value: string | undefined) => {
    if (value !== undefined && !protectedEnvKeys.has(key)) {
      process.env[key] = value;
    }
  };

  if (config.log) {
    setIfUnset('AGENT_LOG_LEVEL', config.log.level);
    setIfUnset('AGENT_LOG_FORMAT', config.log.format);
    setIfUnset(
      'AGENT_LOG_CONSOLE',
      config.log.console !== undefined ? String(config.log.console) : undefined
    );
    setIfUnset(
      'AGENT_LOG_FILE_ENABLED',
      config.log.file !== undefined ? String(config.log.file) : undefined
    );
  }

  if (config.storage?.fileHistory) {
    setIfUnset(
      'AGENT_FILE_HISTORY_ENABLED',
      config.storage.fileHistory.enabled !== undefined
        ? String(config.storage.fileHistory.enabled)
        : undefined
    );
    setIfUnset(
      'AGENT_FILE_HISTORY_MAX_PER_FILE',
      config.storage.fileHistory.maxPerFile !== undefined
        ? String(config.storage.fileHistory.maxPerFile)
        : undefined
    );
    setIfUnset(
      'AGENT_FILE_HISTORY_MAX_AGE_DAYS',
      config.storage.fileHistory.maxAgeDays !== undefined
        ? String(config.storage.fileHistory.maxAgeDays)
        : undefined
    );
    setIfUnset(
      'AGENT_FILE_HISTORY_MAX_TOTAL_MB',
      config.storage.fileHistory.maxTotalMb !== undefined
        ? String(config.storage.fileHistory.maxTotalMb)
        : undefined
    );
  }

  if (config.agent) {
    setIfUnset('AGENT_MODEL', config.agent.defaultModel);
    setIfUnset(
      'AGENT_MAX_STEPS',
      config.agent.maxSteps !== undefined ? String(config.agent.maxSteps) : undefined
    );
    if (config.agent.permissions) {
      setIfUnset(
        AGENT_FULL_ACCESS_ENV,
        config.agent.permissions.fullAccess !== undefined
          ? String(config.agent.permissions.fullAccess)
          : undefined
      );
      setIfUnset(AGENT_DEFAULT_APPROVAL_POLICY_ENV, config.agent.permissions.approvalPolicy);
      setIfUnset(AGENT_DEFAULT_TRUST_LEVEL_ENV, config.agent.permissions.trustLevel);
      setIfUnset(AGENT_DEFAULT_FILESYSTEM_MODE_ENV, config.agent.permissions.fileSystemMode);
      setIfUnset(AGENT_DEFAULT_NETWORK_MODE_ENV, config.agent.permissions.networkMode);
    }
  }

  if (config.models && Object.keys(config.models).length > 0) {
    const existingModels = parseCustomModelsEnv(process.env[CUSTOM_MODELS_ENV_VAR]) ?? {};
    const mergedModels = deepMerge(existingModels, config.models);

    if (protectedEnvKeys.has(CUSTOM_MODELS_ENV_VAR)) {
      process.env[CUSTOM_MODELS_ENV_VAR] = JSON.stringify(
        deepMerge(mergedModels, protectedCustomModels)
      );
      return;
    }

    process.env[CUSTOM_MODELS_ENV_VAR] = JSON.stringify(mergedModels);
  }
}

export function getGlobalConfigDir(): string {
  return resolveRenxHome(process.env);
}

export function getProjectConfigDir(projectRoot?: string): string {
  return path.join(projectRoot ?? process.cwd(), PROJECT_DIR_NAME);
}

export function getGlobalConfigPath(): string {
  return path.join(getGlobalConfigDir(), CONFIG_FILENAME);
}

export function getProjectConfigPath(projectRoot?: string): string {
  return path.join(getProjectConfigDir(projectRoot), CONFIG_FILENAME);
}

export function ensureConfigDirs(projectRoot?: string): void {
  fs.mkdirSync(getGlobalConfigDir(), { recursive: true });
  fs.mkdirSync(getProjectConfigDir(projectRoot), { recursive: true });
}

export function writeProjectConfig(config: Partial<RenxConfig>, projectRoot?: string): string {
  const configPath = getProjectConfigPath(projectRoot);
  return writeConfigFile(configPath, config);
}

export function writeGlobalConfig(config: Partial<RenxConfig>): string {
  const configPath = getGlobalConfigPath();
  return writeConfigFile(configPath, config);
}
