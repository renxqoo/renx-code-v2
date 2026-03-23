import type { ResolvedShell, ShellPathExists } from './shell-runtime';

export function resolvePreferredPosixShell(
  env: NodeJS.ProcessEnv,
  pathExists: ShellPathExists
): ResolvedShell {
  const userShell = env.SHELL;
  if (userShell && pathExists(userShell)) {
    return {
      shellPath: userShell,
      flavor: 'posix',
    };
  }

  if (pathExists('/bin/bash')) {
    return {
      shellPath: '/bin/bash',
      flavor: 'posix',
    };
  }

  return {
    shellPath: '/bin/sh',
    flavor: 'posix',
  };
}

export function createPosixForegroundShellInvocation(
  shell: ResolvedShell,
  command: string
): { shellPath: string; shellArgs: string[] } {
  return {
    shellPath: shell.shellPath,
    shellArgs: ['-c', command],
  };
}

export function createPosixBackgroundShellInvocation(
  shell: ResolvedShell,
  command: string,
  statusPath: string
): { shellPath: string; shellArgs: string[] } {
  return {
    shellPath: shell.shellPath,
    shellArgs: [
      '-c',
      `{ ${command}; }; __renx_exit=$?; printf '%s' "$__renx_exit" > '${statusPath.replace(/'/g, `'\\''`)}'; exit "$__renx_exit"`,
    ],
  };
}
