import * as path from 'node:path';
import type { ResolvedShell, ShellCommandWorks, ShellPathExists } from './shell-runtime';

const POWERSHELL_PROBE_ARGS = [
  '-NoProfile',
  '-NonInteractive',
  '-Command',
  '$PSVersionTable.PSVersion.Major',
];
const POWERSHELL_UTF8_OUTPUT_PREFIX =
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $OutputEncoding = [Console]::OutputEncoding;';
const POWERSHELL_QUIET_PREFERENCES_PREFIX = [
  "$ProgressPreference='SilentlyContinue'",
  "$InformationPreference='SilentlyContinue'",
  "$ErrorActionPreference='Stop'",
].join('\n');

export function resolvePreferredWindowsShell(
  env: NodeJS.ProcessEnv,
  pathExists: ShellPathExists,
  commandWorks: ShellCommandWorks
): ResolvedShell {
  if (commandWorks('pwsh', POWERSHELL_PROBE_ARGS)) {
    return {
      shellPath: 'pwsh',
      flavor: 'powershell',
    };
  }

  const systemRoot = env.SystemRoot || 'C:\\Windows';
  const powershellPath = path.join(
    systemRoot,
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  );
  if (pathExists(powershellPath) && commandWorks(powershellPath, POWERSHELL_PROBE_ARGS)) {
    return {
      shellPath: powershellPath,
      flavor: 'powershell',
    };
  }

  if (commandWorks('powershell.exe', POWERSHELL_PROBE_ARGS)) {
    return {
      shellPath: 'powershell.exe',
      flavor: 'powershell',
    };
  }

  return {
    shellPath: env.COMSPEC || 'cmd.exe',
    flavor: 'cmd',
  };
}

export function createWindowsForegroundShellInvocation(
  shell: ResolvedShell,
  command: string
): { shellPath: string; shellArgs: string[] } {
  if (shell.flavor === 'powershell') {
    const script = buildPowerShellExitPreservingScript(command);
    return {
      shellPath: shell.shellPath,
      shellArgs: [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        encodePowerShellScript(script),
      ],
    };
  }

  return {
    shellPath: shell.shellPath,
    shellArgs: ['/d', '/s', '/c', command],
  };
}

export function createWindowsBackgroundShellInvocation(
  shell: ResolvedShell,
  command: string,
  statusPath: string
): { shellPath: string; shellArgs: string[] } {
  if (shell.flavor === 'powershell') {
    const statusPathLiteral = escapePowerShellSingleQuotedString(statusPath);
    const script = [
      buildPowerShellExitPreservingScript(command, false),
      `Set-Content -Path '${statusPathLiteral}' -Value $__renx_exit -NoNewline`,
      'exit $__renx_exit',
    ].join('\n');
    return {
      shellPath: shell.shellPath,
      shellArgs: [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        encodePowerShellScript(script),
      ],
    };
  }

  return {
    shellPath: shell.shellPath,
    shellArgs: [
      '/d',
      '/s',
      '/c',
      `(${command}) & set "__renx_exit=%ERRORLEVEL%" & > "${statusPath}" echo %__renx_exit% & exit /b %__renx_exit%`,
    ],
  };
}

function encodePowerShellScript(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

function buildPowerShellExitPreservingScript(command: string, appendExit = true): string {
  const script = [
    prefixPowerShellScriptWithUtf8(command),
    '$__renx_exit = if ($null -ne $LASTEXITCODE) { [int]$LASTEXITCODE } elseif ($?) { 0 } else { 1 }',
  ];
  if (appendExit) {
    script.push('exit $__renx_exit');
  }
  return script.join('\n');
}

function escapePowerShellSingleQuotedString(value: string): string {
  return value.replace(/'/g, "''");
}

function prefixPowerShellScriptWithUtf8(script: string): string {
  const trimmed = script.trimStart();
  const prefixes: string[] = [];

  if (!trimmed.startsWith(POWERSHELL_UTF8_OUTPUT_PREFIX)) {
    prefixes.push(POWERSHELL_UTF8_OUTPUT_PREFIX);
  }

  if (!trimmed.includes("$ProgressPreference='SilentlyContinue'")) {
    prefixes.push(POWERSHELL_QUIET_PREFERENCES_PREFIX);
  }

  if (prefixes.length === 0) {
    return script;
  }

  return `${prefixes.join('\n')}\n${script}`;
}
