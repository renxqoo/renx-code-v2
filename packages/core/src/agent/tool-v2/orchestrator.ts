import type { ToolExecutionContext } from './context';
import type {
  ToolCallRequest,
  ToolCallResult,
  ToolExecutionEventStage,
  ToolExecutionPlan,
} from './contracts';
import { toToolErrorContract, ToolV2ApprovalDeniedError, ToolV2PolicyDeniedError } from './errors';
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
      await this.assertPolicy(call, routed.toolName, routed.arguments, args, effectiveContext);
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

      this.assertPlanPermissions(plan, effectiveContext);
      await this.ensureApproval(routed.toolName, call, plan, effectiveContext);

      await this.emitEvent(context, call, 'executing', {
        toolName: routed.toolName,
      });
      const result = await routed.handler.execute(args, effectiveContext);
      await this.emitEvent(context, call, 'succeeded', {
        toolName: routed.toolName,
        durationMs: this.now(context) - startedAt,
        hasStructured: result.structured !== undefined,
      });
      return {
        callId: call.callId,
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
        callId: call.callId,
        toolName: call.toolName,
        success: false,
        output: contract.message,
        error: contract,
        metadata: contract.details,
      };
    }
  }

  private async assertPolicy(
    call: ToolCallRequest,
    toolName: string,
    rawArguments: string,
    parsedArguments: unknown,
    context: ToolExecutionContext
  ): Promise<void> {
    if (!context.onPolicyCheck) {
      return;
    }

    const decision = await context.onPolicyCheck({
      callId: call.callId,
      toolName,
      arguments: rawArguments,
      parsedArguments:
        parsedArguments && typeof parsedArguments === 'object' && !Array.isArray(parsedArguments)
          ? (parsedArguments as Record<string, unknown>)
          : {},
    });

    if (!decision.allowed) {
      throw new ToolV2PolicyDeniedError(toolName, decision);
    }
  }

  private assertPlanPermissions(plan: ToolExecutionPlan, context: ToolExecutionContext): void {
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

  private async ensureApproval(
    toolName: string,
    call: ToolCallRequest,
    plan: ToolExecutionPlan,
    context: ToolExecutionContext
  ): Promise<void> {
    const approval = plan.approval;
    if (!approval?.required) {
      return;
    }

    if (
      context.approvalPolicy === 'unless-trusted' &&
      (context.trustLevel || 'untrusted') === 'trusted'
    ) {
      return;
    }

    const cacheKey = approval.key || `${toolName}:${approval.reason}`;
    if (context.sessionState.hasApproval(cacheKey)) {
      await this.emitEvent(context, call, 'approval_resolved', {
        toolName,
        approved: true,
        cached: true,
        scope: 'cached',
        key: cacheKey,
      });
      return;
    }

    if (!context.approve) {
      throw new ToolV2ApprovalDeniedError(toolName, 'approval resolver is not configured');
    }

    if (context.approvalPolicy === 'never') {
      throw new ToolV2ApprovalDeniedError(toolName, 'approval policy is set to never');
    }

    if (context.approvalPolicy === 'on-failure') {
      throw new ToolV2ApprovalDeniedError(
        toolName,
        'on-failure policy requires a retry-capable runtime and is not supported by tool-v2 yet'
      );
    }

    await this.emitEvent(context, call, 'approval_requested', {
      toolName,
      key: cacheKey,
      reason: approval.reason,
    });
    const decision = await context.approve({
      toolName,
      callId: call.callId,
      reason: approval.reason,
      key: cacheKey,
      commandPreview: approval.commandPreview,
      readPaths: plan.readPaths,
      writePaths: plan.writePaths,
    });
    await this.emitEvent(context, call, 'approval_resolved', {
      toolName,
      approved: decision.approved,
      scope: decision.scope,
      key: cacheKey,
      reason: decision.reason,
    });

    if (!decision.approved) {
      throw new ToolV2ApprovalDeniedError(toolName, decision.reason);
    }

    if (decision.scope === 'turn' || decision.scope === 'session') {
      context.sessionState.grantApproval(cacheKey, decision.scope);
      return;
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
        callId: call.callId,
        toolNamespace: call.toolNamespace,
        timestamp: this.now(context),
        metadata,
      });
    } catch {
      // Observability hooks must never break the tool execution path.
    }
  }
}
