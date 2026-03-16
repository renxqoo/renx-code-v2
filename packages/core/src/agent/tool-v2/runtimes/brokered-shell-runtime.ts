import type { ShellSandboxPolicy } from '../shell-sandbox';
import { ToolV2ExecutionError } from '../errors';
import {
  getShellRuntimeCapabilities,
  syncShellRuntimeSandboxPolicy,
  type ShellBackgroundExecutionRecord,
  type ShellBackgroundRuntime,
  type ShellRuntime,
  type ShellRuntimeCapabilities,
  type ShellRuntimeRequest,
  type ShellRuntimeResult,
  type ShellSandboxStateAwareRuntime,
} from './shell-runtime';

export interface BrokeredShellRuntimeOptions {
  readonly sandboxedRuntime: ShellRuntime;
  readonly escalatedRuntime?: ShellRuntime;
}

export class BrokeredShellRuntime
  implements ShellRuntime, ShellSandboxStateAwareRuntime, ShellBackgroundRuntime
{
  private lastSandboxPolicy?: ShellSandboxPolicy;

  constructor(private readonly options: BrokeredShellRuntimeOptions) {}

  getCapabilities(): ShellRuntimeCapabilities {
    const sandboxedCapabilities = getShellRuntimeCapabilities(this.options.sandboxedRuntime);
    return {
      sandboxing: sandboxedCapabilities.sandboxing,
      escalation: {
        supported:
          Boolean(this.options.escalatedRuntime) ||
          sandboxedCapabilities.escalation?.supported === true,
      },
    };
  }

  async updateSandboxPolicy(policy: ShellSandboxPolicy): Promise<void> {
    this.lastSandboxPolicy = policy;
    await syncShellRuntimeSandboxPolicy(this.options.sandboxedRuntime, policy);
  }

  async execute(request: ShellRuntimeRequest): Promise<ShellRuntimeResult> {
    if (request.sandboxPolicy) {
      await this.updateSandboxPolicy(request.sandboxPolicy);
    } else if (this.lastSandboxPolicy) {
      await syncShellRuntimeSandboxPolicy(this.options.sandboxedRuntime, this.lastSandboxPolicy);
    }

    if (request.executionMode === 'escalated' && this.options.escalatedRuntime) {
      return this.options.escalatedRuntime.execute(request);
    }

    return this.options.sandboxedRuntime.execute(request);
  }

  async startBackground(request: ShellRuntimeRequest): Promise<ShellBackgroundExecutionRecord> {
    const runtime = this.resolveRuntime(request.executionMode) as Partial<ShellBackgroundRuntime>;
    if (typeof runtime.startBackground !== 'function') {
      throw new ToolV2ExecutionError(
        'Selected shell runtime does not support background execution'
      );
    }
    return runtime.startBackground(request);
  }

  async pollBackground(
    record: ShellBackgroundExecutionRecord
  ): Promise<ShellBackgroundExecutionRecord> {
    const runtime = this.resolveRuntime(record.executionMode) as Partial<ShellBackgroundRuntime>;
    if (typeof runtime.pollBackground !== 'function') {
      throw new ToolV2ExecutionError(
        'Selected shell runtime does not support background execution'
      );
    }
    return runtime.pollBackground(record);
  }

  async cancelBackground(
    record: ShellBackgroundExecutionRecord,
    reason?: string
  ): Promise<ShellBackgroundExecutionRecord> {
    const runtime = this.resolveRuntime(record.executionMode) as Partial<ShellBackgroundRuntime>;
    if (typeof runtime.cancelBackground !== 'function') {
      throw new ToolV2ExecutionError(
        'Selected shell runtime does not support background execution'
      );
    }
    return runtime.cancelBackground(record, reason);
  }

  private resolveRuntime(executionMode?: ShellRuntimeRequest['executionMode']): ShellRuntime {
    if (executionMode === 'escalated' && this.options.escalatedRuntime) {
      return this.options.escalatedRuntime;
    }
    return this.options.sandboxedRuntime;
  }
}
