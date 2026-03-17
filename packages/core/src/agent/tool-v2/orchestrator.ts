import type { ToolExecutionContext } from './context';
import type { ToolCallRequest, ToolCallResult, ToolExecutionEventStage } from './contracts';
import { toToolErrorContract } from './errors';
import {
  applyPermissionProfile,
  assertNetworkAccess,
  assertReadAccess,
  assertWriteAccess,
} from './permissions';
import { ToolRouter } from './router';

export class ToolOrchestrator {
  constructor(private readonly router: ToolRouter) {}

  async execute(call: ToolCallRequest, context: ToolExecutionContext): Promise<ToolCallResult> {
    const startedAt = this.now(context);
    let toolName = call.toolName;
    try {
      await this.emitEvent(context, call, 'received');
      const routed = this.router.route(call);
      toolName = routed.toolName;
      const effectivePermissions = applyPermissionProfile(
        {
          fileSystem: context.fileSystemPolicy,
          network: context.networkPolicy,
        },
        context.sessionState.effectivePermissions()
      );
      const effectiveContext: ToolExecutionContext = {
        ...context,
        activeCall: call,
        fileSystemPolicy: effectivePermissions.fileSystem,
        networkPolicy: effectivePermissions.network,
      };
      const args = routed.handler.parseArguments(routed.arguments);
      await this.emitEvent(context, call, 'parsed', {
        toolName: routed.toolName,
      });
      const plan = routed.handler.plan(args, effectiveContext);
      await this.emitEvent(context, call, 'planned', {
        toolName: routed.toolName,
        mutating: plan.mutating,
        readPathCount: plan.readPaths?.length || 0,
        writePathCount: plan.writePaths?.length || 0,
        networkTargetCount: plan.networkTargets?.length || 0,
        preferredSandbox: plan.preferredSandbox,
        approvalRequired: plan.approval?.required || false,
      });

      const authorizationResult = await effectiveContext.authorization.service.authorizeExecution({
        runtime: effectiveContext.authorization,
        sessionState: effectiveContext.sessionState,
        toolCallId: call.toolCallId,
        toolName: routed.toolName,
        rawArguments: routed.arguments,
        parsedArguments:
          args && typeof args === 'object' && !Array.isArray(args)
            ? (args as Record<string, unknown>)
            : {},
        plan,
        workingDirectory: effectiveContext.workingDirectory,
        fileSystemPolicy: effectiveContext.fileSystemPolicy,
        networkPolicy: effectiveContext.networkPolicy,
        approvalPolicy: effectiveContext.approvalPolicy,
        trustLevel: effectiveContext.trustLevel,
        onStage: async (stage, metadata) => {
          await this.emitEvent(effectiveContext, call, stage, metadata);
        },
      });
      const executableContext: ToolExecutionContext = {
        ...effectiveContext,
        fileSystemPolicy: authorizationResult.fileSystemPolicy,
        networkPolicy: authorizationResult.networkPolicy,
      };
      this.assertPlanPermissions(plan, executableContext);

      await this.emitEvent(context, call, 'executing', {
        toolName: routed.toolName,
        authorizationOutcome: authorizationResult.decision.outcome,
        authorizationReason: authorizationResult.decision.reason,
        policyVersion: authorizationResult.decision.policyVersion,
      });
      const result = await routed.handler.execute(args, executableContext);
      await this.emitEvent(context, call, 'succeeded', {
        toolName: routed.toolName,
        durationMs: this.now(context) - startedAt,
        hasStructured: result.structured !== undefined,
      });
      return {
        toolCallId: call.toolCallId,
        toolName: routed.toolName,
        success: true,
        output: result.output,
        structured: result.structured,
        metadata: result.metadata,
      };
    } catch (error) {
      const contract = toToolErrorContract(error);
      await this.emitEvent(context, call, 'failed', {
        toolName,
        durationMs: this.now(context) - startedAt,
        errorCode: contract.errorCode,
        category: contract.category,
      });
      return {
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        success: false,
        output: contract.message,
        error: contract,
        metadata: contract.details,
      };
    }
  }

  private assertPlanPermissions(
    plan: {
      readPaths?: string[];
      writePaths?: string[];
      networkTargets?: string[];
    },
    context: ToolExecutionContext
  ): void {
    for (const readPath of plan.readPaths || []) {
      assertReadAccess(readPath, context.workingDirectory, context.fileSystemPolicy);
    }

    for (const writePath of plan.writePaths || []) {
      assertWriteAccess(writePath, context.workingDirectory, context.fileSystemPolicy);
    }

    for (const networkTarget of plan.networkTargets || []) {
      assertNetworkAccess(networkTarget, context.networkPolicy);
    }
  }

  private now(context: ToolExecutionContext): number {
    return context.now?.() || Date.now();
  }

  private async emitEvent(
    context: ToolExecutionContext,
    call: ToolCallRequest,
    stage: ToolExecutionEventStage,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    if (!context.onEvent) {
      return;
    }

    try {
      await context.onEvent({
        stage,
        toolName: typeof metadata?.toolName === 'string' ? metadata.toolName : call.toolName,
        toolCallId: call.toolCallId,
        toolNamespace: call.toolNamespace,
        timestamp: this.now(context),
        metadata,
      });
    } catch {
      // Observability hooks must never break the tool execution path.
    }
  }
}
