import type { ToolFileSystemPolicy, ToolNetworkPolicy, ToolSandboxMode } from './contracts';
import { normalizeFileSystemPolicy, normalizeNetworkPolicy } from './permissions';

export interface ShellSandboxPolicy {
  readonly type: ToolSandboxMode;
  readonly readableRoots: string[];
  readonly writableRoots: string[];
  readonly networkAccess: boolean;
  readonly environment: Record<string, string>;
}

export interface CreateShellSandboxPolicyOptions {
  readonly type: ToolSandboxMode;
  readonly fileSystemPolicy: ToolFileSystemPolicy;
  readonly networkPolicy: ToolNetworkPolicy;
  readonly runtimeTag?: string;
  readonly environment?: Record<string, string>;
}

export function createShellSandboxPolicy(
  options: CreateShellSandboxPolicyOptions
): ShellSandboxPolicy {
  const fileSystemPolicy = normalizeFileSystemPolicy(options.fileSystemPolicy);
  const networkPolicy = normalizeNetworkPolicy(options.networkPolicy);
  const networkAccess = networkPolicy.mode === 'enabled';
  const readableRoots = Array.from(
    new Set([...fileSystemPolicy.readRoots, ...fileSystemPolicy.writeRoots])
  );
  const writableRoots =
    options.type === 'restricted'
      ? []
      : fileSystemPolicy.mode === 'unrestricted'
        ? []
        : fileSystemPolicy.writeRoots;
  const environment: Record<string, string> = {
    ...(options.environment || {}),
    CODEX_SANDBOX: options.runtimeTag || options.type,
    CODEX_SANDBOX_POLICY: options.type,
  };

  if (!networkAccess) {
    environment.CODEX_SANDBOX_NETWORK_DISABLED = '1';
  }

  return {
    type: options.type,
    readableRoots,
    writableRoots,
    networkAccess,
    environment,
  };
}
