import type { AuthorizationExecutionRequest } from './contracts';
import { mergeUniqueValues } from './decision-merger';

export interface AuthorizationPolicyEvaluation {
  readonly denied: boolean;
  readonly reason: string;
  readonly rulesMatched: string[];
  readonly tags: string[];
  readonly metadata?: Record<string, unknown>;
}

export interface AuthorizationPolicyEngine {
  evaluate(request: AuthorizationExecutionRequest): Promise<AuthorizationPolicyEvaluation>;
}

export class DefaultAuthorizationPolicyEngine implements AuthorizationPolicyEngine {
  async evaluate(request: AuthorizationExecutionRequest): Promise<AuthorizationPolicyEvaluation> {
    const tags = [
      request.plan.mutating ? 'mutating' : 'read-only',
      request.runtime.principal.principalType,
      request.runtime.principal.source,
    ];
    const rulesMatched = ['default-policy'];

    if (request.plan.approval?.required) {
      tags.push('requires-approval');
    }
    if ((request.plan.networkTargets || []).length > 0) {
      tags.push('network');
    }
    if ((request.plan.writePaths || []).length > 0) {
      tags.push('filesystem-write');
    }
    if ((request.plan.readPaths || []).length > 0) {
      tags.push('filesystem-read');
    }

    const externalDecision = await request.runtime.evaluatePolicy?.({
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      arguments: request.rawArguments,
      parsedArguments: request.parsedArguments,
    });

    if (externalDecision && !externalDecision.allowed) {
      return {
        denied: true,
        reason: externalDecision.message || 'Blocked by authorization policy',
        rulesMatched: mergeUniqueValues(rulesMatched, ['external-policy-deny']),
        tags: mergeUniqueValues(tags, ['external-policy']),
        metadata: {
          reasonCode: externalDecision.code,
          audit: externalDecision.audit,
        },
      };
    }

    if (externalDecision?.allowed) {
      return {
        denied: false,
        reason: 'Allowed by authorization policy',
        rulesMatched: mergeUniqueValues(rulesMatched, ['external-policy-allow']),
        tags: mergeUniqueValues(tags, ['external-policy']),
      };
    }

    return {
      denied: false,
      reason: 'Allowed by default authorization policy',
      rulesMatched,
      tags,
    };
  }
}
