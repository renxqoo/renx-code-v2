import type { Tool, ToolCall } from '../../providers';
import type { AgentToolExecutionContext, AgentToolExecutor } from '../agent/tool-executor';
import type { PrincipalContext, ToolAuthorizationService } from '../auth/contracts';
import { createConfiguredAuthorizationService } from '../auth/authorization-service';
import { createSystemPrincipal } from '../auth/principal';
import type {
  ToolApprovalPolicy,
  ToolCallResult,
  ToolConcurrencyPolicy,
  ToolFileSystemPolicy,
  ToolNetworkPolicy,
  ToolTrustLevel,
} from './contracts';
import { ToolSessionState } from './context';
import { createDefaultToolExecutionBaseline } from './default-permissions';
import {
  OrganizationPolicyAuthorizationService,
  type OrganizationPolicyConfig,
} from './organization-policy';
import { EnterpriseToolSystem } from './tool-system';
import { parseWriteFileProtocolOutput } from './write-file-protocol';

export interface EnterpriseToolExecutorOptions {
  readonly system: EnterpriseToolSystem;
  readonly workingDirectory?: string;
  readonly fileSystemPolicy?: ToolFileSystemPolicy;
  readonly networkPolicy?: ToolNetworkPolicy;
  readonly approvalPolicy?: ToolApprovalPolicy;
  readonly trustLevel?: ToolTrustLevel;
  readonly authorizationService?: ToolAuthorizationService;
  readonly authorizationBaseDir?: string;
  readonly authorizationPolicyVersion?: string;
  readonly organizationPolicy?: OrganizationPolicyConfig;
  readonly principal?: PrincipalContext;
  readonly concurrencyPolicyResolver?: (toolCall: ToolCall) => ToolConcurrencyPolicy;
}

export class EnterpriseToolExecutor implements AgentToolExecutor {
  private readonly system: EnterpriseToolSystem;
  private readonly workingDirectory: string;
  private readonly fileSystemPolicy: ToolFileSystemPolicy;
  private readonly networkPolicy: ToolNetworkPolicy;
  private readonly approvalPolicy: ToolApprovalPolicy;
  private readonly trustLevel: ToolTrustLevel;
  private readonly authorizationService: ToolAuthorizationService;
  private readonly principal: PrincipalContext;
  private readonly concurrencyPolicyResolver?: (toolCall: ToolCall) => ToolConcurrencyPolicy;

  constructor(options: EnterpriseToolExecutorOptions) {
    this.system = options.system;
    this.workingDirectory = options.workingDirectory || process.cwd();
    const defaults = createDefaultToolExecutionBaseline({
      workingDirectory: this.workingDirectory,
      trustLevel: options.trustLevel,
    });
    this.fileSystemPolicy = options.fileSystemPolicy || defaults.fileSystemPolicy;
    this.networkPolicy = options.networkPolicy || defaults.networkPolicy;
    this.approvalPolicy = options.approvalPolicy || defaults.approvalPolicy;
    this.trustLevel = defaults.trustLevel;
    const baseAuthorizationService =
      options.authorizationService ||
      createConfiguredAuthorizationService({
        baseDir: options.authorizationBaseDir,
        policyVersion: options.authorizationPolicyVersion || options.organizationPolicy?.version,
      });
    this.authorizationService = options.organizationPolicy
      ? new OrganizationPolicyAuthorizationService(
          baseAuthorizationService,
          options.organizationPolicy
        )
      : baseAuthorizationService;
    this.principal = options.principal || createSystemPrincipal('enterprise-tool-executor');
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
        authorization: this.createAuthorizationContext({
          principal: this.principal,
        }),
        fileSystemPolicy: this.fileSystemPolicy,
        networkPolicy: this.networkPolicy,
        approvalPolicy: this.approvalPolicy,
        trustLevel: this.trustLevel,
      });
      const concurrency = plan.concurrency;
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
    const result = await this.system.execute(
      {
        toolCallId: toolCall.id,
        toolName: toolCall.function.name,
        arguments: toolCall.function.arguments,
      },
      this.createExecutionContext(context)
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
        toolCallId: `${toolCall.id}__finalize`,
        toolName: 'write_file',
        arguments: JSON.stringify(protocol.nextArgs),
      },
      this.createExecutionContext(context)
    );

    return {
      ...finalizeResult,
      toolCallId: toolCall.id,
      toolName: toolCall.function.name,
      metadata: {
        ...(finalizeResult.metadata || {}),
        autoFinalized: true,
        bufferId: protocol.buffer?.bufferId || protocol.nextArgs.bufferId,
      },
    };
  }

  private createExecutionContext(context: AgentToolExecutionContext) {
    return {
      workingDirectory: context.workingDirectory || this.workingDirectory,
      sessionState: context.sessionState,
      authorization: this.createAuthorizationContext(context),
      fileSystemPolicy: context.fileSystemPolicy || this.fileSystemPolicy,
      networkPolicy: context.networkPolicy || this.networkPolicy,
      approvalPolicy: context.approvalPolicy || this.approvalPolicy,
      trustLevel: context.trustLevel || this.trustLevel,
      signal: context.abortSignal,
      emit: context.onStreamEvent,
      onEvent: context.onExecutionEvent,
    } as const;
  }

  private createAuthorizationContext(
    context: Pick<
      AgentToolExecutionContext,
      'executionId' | 'principal' | 'onPolicyCheck' | 'onPermissionRequest' | 'onApproval'
    >
  ) {
    return {
      service: this.authorizationService,
      principal: context.principal || this.principal,
      sessionId: context.executionId,
      evaluatePolicy: context.onPolicyCheck,
      requestPermissions: context.onPermissionRequest,
      requestApproval: context.onApproval,
    } as const;
  }
}
