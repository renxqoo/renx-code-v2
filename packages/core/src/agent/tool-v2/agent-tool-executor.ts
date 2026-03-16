import type { Tool, ToolCall } from '../../providers';
import { ContractError, type ErrorContract } from '../error-contract';
import type { AgentToolExecutionContext, AgentToolExecutor } from '../agent/tool-executor';
import type { ToolConcurrencyPolicy } from '../tool/types';
import type {
  ToolApprovalPolicy,
  ToolConcurrencyPolicy as ToolV2ConcurrencyPolicy,
  ToolCallFailure,
  ToolCallResult,
  ToolFileSystemPolicy,
  ToolNetworkPolicy,
  ToolTrustLevel,
} from './contracts';
import { ToolSessionState } from './context';
import { createWorkspaceFileSystemPolicy, createRestrictedNetworkPolicy } from './permissions';
import { EnterpriseToolSystem } from './tool-system';
import { parseWriteFileProtocolOutput } from './write-file-protocol';

export interface EnterpriseToolExecutorOptions {
  readonly system: EnterpriseToolSystem;
  readonly workingDirectory?: string;
  readonly fileSystemPolicy?: ToolFileSystemPolicy;
  readonly networkPolicy?: ToolNetworkPolicy;
  readonly approvalPolicy?: ToolApprovalPolicy;
  readonly trustLevel?: ToolTrustLevel;
  readonly concurrencyPolicyResolver?: (toolCall: ToolCall) => ToolConcurrencyPolicy;
}

export class EnterpriseToolExecutor implements AgentToolExecutor {
  private readonly system: EnterpriseToolSystem;
  private readonly workingDirectory: string;
  private readonly fileSystemPolicy: ToolFileSystemPolicy;
  private readonly networkPolicy: ToolNetworkPolicy;
  private readonly approvalPolicy: ToolApprovalPolicy;
  private readonly trustLevel: ToolTrustLevel;
  private readonly concurrencyPolicyResolver?: (toolCall: ToolCall) => ToolConcurrencyPolicy;

  constructor(options: EnterpriseToolExecutorOptions) {
    this.system = options.system;
    this.workingDirectory = options.workingDirectory || process.cwd();
    this.fileSystemPolicy =
      options.fileSystemPolicy || createWorkspaceFileSystemPolicy(this.workingDirectory);
    this.networkPolicy = options.networkPolicy || createRestrictedNetworkPolicy();
    this.approvalPolicy = options.approvalPolicy || 'on-request';
    this.trustLevel = options.trustLevel || 'untrusted';
    this.concurrencyPolicyResolver = options.concurrencyPolicyResolver;
  }

  getToolSchemas(): Tool[] {
    return this.system.specs().map((spec) => ({
      type: 'function',
      function: {
        name: spec.name,
        description: spec.description,
        parameters: spec.inputSchema,
      },
    }));
  }

  getConcurrencyPolicy(toolCall: ToolCall): ToolConcurrencyPolicy {
    if (this.concurrencyPolicyResolver) {
      return this.concurrencyPolicyResolver(toolCall);
    }

    try {
      const handler = this.system.registry.get(toolCall.function.name);
      const parsedArgs = handler.parseArguments(toolCall.function.arguments);
      const plan = handler.plan(parsedArgs, {
        workingDirectory: this.workingDirectory,
        sessionState: new ToolSessionState(),
        fileSystemPolicy: this.fileSystemPolicy,
        networkPolicy: this.networkPolicy,
        approvalPolicy: this.approvalPolicy,
        trustLevel: this.trustLevel,
      });
      const concurrency = plan.concurrency as ToolV2ConcurrencyPolicy | undefined;
      if (concurrency) {
        return {
          mode: concurrency.mode,
          lockKey: concurrency.lockKey,
        };
      }
      return {
        mode: handler.spec.supportsParallel ? 'parallel-safe' : 'exclusive',
      };
    } catch {
      return { mode: 'exclusive' };
    }
  }

  async execute(toolCall: ToolCall, context: AgentToolExecutionContext): Promise<ToolCallResult> {
    const policyResult = await this.applyExternalPolicy(toolCall, context);
    if (policyResult) {
      return policyResult;
    }

    const result = await this.system.execute(
      {
        callId: toolCall.id,
        toolName: toolCall.function.name,
        arguments: toolCall.function.arguments,
      },
      {
        workingDirectory: context.workingDirectory || this.workingDirectory,
        sessionState: context.sessionState,
        fileSystemPolicy: context.fileSystemPolicy || this.fileSystemPolicy,
        networkPolicy: context.networkPolicy || this.networkPolicy,
        approvalPolicy: context.approvalPolicy || this.approvalPolicy,
        trustLevel: context.trustLevel || this.trustLevel,
        signal: context.abortSignal,
        emit: context.onStreamEvent,
        onEvent: context.onExecutionEvent,
        approve: context.onApproval,
        requestPermissions: context.onPermissionRequest,
      }
    );

    return this.maybeAutoFinalizeWriteFile(toolCall, context, result);
  }

  private async maybeAutoFinalizeWriteFile(
    toolCall: ToolCall,
    context: AgentToolExecutionContext,
    result: ToolCallResult
  ): Promise<ToolCallResult> {
    if (toolCall.function.name !== 'write_file') {
      return result;
    }

    const protocol = parseWriteFileProtocolOutput(result.output);
    if (!protocol || protocol.nextAction !== 'finalize' || !protocol.nextArgs) {
      return result;
    }

    const finalizeResult = await this.system.execute(
      {
        callId: `${toolCall.id}__finalize`,
        toolName: 'write_file',
        arguments: JSON.stringify(protocol.nextArgs),
      },
      {
        workingDirectory: context.workingDirectory || this.workingDirectory,
        sessionState: context.sessionState,
        fileSystemPolicy: context.fileSystemPolicy || this.fileSystemPolicy,
        networkPolicy: context.networkPolicy || this.networkPolicy,
        approvalPolicy: context.approvalPolicy || this.approvalPolicy,
        trustLevel: context.trustLevel || this.trustLevel,
        signal: context.abortSignal,
        emit: context.onStreamEvent,
        onEvent: context.onExecutionEvent,
        approve: context.onApproval,
        requestPermissions: context.onPermissionRequest,
      }
    );

    return {
      ...finalizeResult,
      callId: toolCall.id,
      toolName: toolCall.function.name,
      metadata: {
        ...(finalizeResult.metadata || {}),
        autoFinalized: true,
        bufferId: protocol.buffer?.bufferId || protocol.nextArgs.bufferId,
      },
    };
  }

  private async applyExternalPolicy(
    toolCall: ToolCall,
    context: AgentToolExecutionContext
  ): Promise<ToolCallFailure | undefined> {
    if (!context.onPolicyCheck) {
      return undefined;
    }

    let parsedArguments: Record<string, unknown>;
    try {
      const handler = this.system.registry.get(toolCall.function.name);
      const parsed = handler.parseArguments(toolCall.function.arguments);
      parsedArguments =
        parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {};
    } catch {
      return undefined;
    }

    const decision = await context.onPolicyCheck({
      toolCallId: toolCall.id,
      toolName: toolCall.function.name,
      arguments: toolCall.function.arguments,
      parsedArguments,
    });
    if (decision.allowed) {
      return undefined;
    }

    return {
      callId: toolCall.id,
      toolName: toolCall.function.name,
      success: false,
      output: this.formatPolicyDeniedMessage(toolCall.function.name, decision),
      error: this.buildPolicyDeniedError(toolCall.function.name, decision),
      metadata: decision.audit ? { policyAudit: decision.audit } : undefined,
    };
  }

  private formatPolicyDeniedMessage(
    toolName: string,
    decision: { code?: string; message?: string }
  ): string {
    const code = decision.code ? ` [${decision.code}]` : '';
    const reason = decision.message ? `: ${decision.message}` : '';
    return `Tool ${toolName} blocked by policy${code}${reason}`;
  }

  private buildPolicyDeniedError(
    toolName: string,
    decision: { code?: string; message?: string; audit?: Record<string, unknown> }
  ): ErrorContract {
    return new ContractError(this.formatPolicyDeniedMessage(toolName, decision), {
      module: 'tool',
      name: 'ToolPolicyDeniedError',
      code: 3006,
      errorCode: 'TOOL_POLICY_DENIED',
      category: 'permission',
      retryable: false,
      httpStatus: 403,
      details: {
        toolName,
        reasonCode: decision.code,
        audit: decision.audit,
      },
    }).toJSON();
  }
}
