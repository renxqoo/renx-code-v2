import { existsSync } from 'node:fs';

import { parseArgv, readBooleanFlag } from '../shared/argv.js';
import { toJson } from '../shared/output.js';
import { resolveBunExecutable } from '../shared/process.js';
import { getCoreModules } from '../shared/core-modules.js';
import type { CommandContext, CommandResult } from '../shared/types.js';

function formatCheck(label: string, ok: boolean, detail: string): string {
  return `${ok ? 'OK' : 'FAIL'}  ${label}: ${detail}`;
}

export async function runDoctorCommand(ctx: CommandContext): Promise<CommandResult> {
  const parsed = parseArgv(ctx.argv, { allowPositionals: false });
  const json = readBooleanFlag(parsed, 'json');

  const bun = resolveBunExecutable(ctx.env);
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];

  checks.push({
    name: 'node',
    ok: true,
    detail: process.version,
  });

  checks.push({
    name: 'bun',
    ok: Boolean(bun),
    detail: bun || 'not found',
  });

  checks.push({
    name: 'repoRoot',
    ok: existsSync(ctx.repoRoot),
    detail: ctx.repoRoot,
  });

  checks.push({
    name: 'workspaceRoot',
    ok: existsSync(ctx.cwd),
    detail: ctx.cwd,
  });

  let modelIds: string[] = [];
  let configPaths: { global?: string; project?: string } = {};
  let dbPath = '';
  let coreError: string | undefined;

  try {
    const modules = await getCoreModules(ctx.repoRoot);
    await modules.loadEnvFiles(ctx.cwd);
    modules.loadConfigToEnv({ projectRoot: ctx.cwd });

    modelIds = modules.ProviderRegistry.getModelIds();
    configPaths = {
      global: modules.getGlobalConfigPath(),
      project: modules.getProjectConfigPath(ctx.cwd),
    };
    dbPath = modules.resolveRenxDatabasePath(process.env);

    checks.push({
      name: 'coreModules',
      ok: true,
      detail: 'loaded',
    });

    checks.push({
      name: 'models',
      ok: modelIds.length > 0,
      detail: modelIds.length > 0 ? `${modelIds.length} available` : 'none',
    });

    checks.push({
      name: 'databasePath',
      ok: dbPath.length > 0,
      detail: dbPath || 'unresolved',
    });
  } catch (error) {
    coreError = error instanceof Error ? error.message : String(error);
    checks.push({
      name: 'coreModules',
      ok: false,
      detail: coreError,
    });
  }

  const requiredModelEnv = ['OPENAI_API_KEY', 'QWEN_API_KEY', 'ANTHROPIC_API_KEY'];
  const envStatus = requiredModelEnv.map((name) => ({
    key: name,
    configured: Boolean(process.env[name]),
  }));

  if (json) {
    const payload = {
      ok: checks.every((item) => item.ok),
      checks,
      environment: {
        node: process.version,
        bun,
        repoRoot: ctx.repoRoot,
        workspaceRoot: ctx.cwd,
        modelEnv: envStatus,
      },
      core: {
        modelIds,
        configPaths,
        dbPath,
        dbExists: dbPath ? existsSync(dbPath) : false,
        error: coreError,
      },
    };

    return {
      exitCode: payload.ok ? 0 : 1,
      stdout: toJson(payload),
    };
  }

  const lines = [
    'Renx Doctor',
    '',
    ...checks.map((check) => formatCheck(check.name, check.ok, check.detail)),
    '',
    'Environment:',
    ...envStatus.map((item) => `  ${item.key}: ${item.configured ? 'configured' : 'missing'}`),
  ];

  if (modelIds.length > 0) {
    lines.push('', `Models: ${modelIds.join(', ')}`);
  }

  if (configPaths.global || configPaths.project) {
    lines.push('', 'Config paths:');
    if (configPaths.global) {
      lines.push(`  global: ${configPaths.global}`);
    }
    if (configPaths.project) {
      lines.push(`  project: ${configPaths.project}`);
    }
  }

  if (dbPath) {
    lines.push('', `Database: ${dbPath} (${existsSync(dbPath) ? 'exists' : 'missing'})`);
  }

  if (coreError) {
    lines.push('', `Core error: ${coreError}`);
  }

  const ok = checks.every((item) => item.ok);
  return {
    exitCode: ok ? 0 : 1,
    stdout: `${lines.join('\n')}\n`,
  };
}
