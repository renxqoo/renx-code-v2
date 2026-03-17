import type {
  AuthorizationExecutionRequest,
  ExplicitPermissionGrantRequest,
  PermissionGrantRecord,
} from './contracts';
import { AuthorizationGrantStore, InMemoryAuthorizationGrantStore } from './grant-store';
import {
  applyPermissionProfile,
  collectMissingPermissionProfile,
  isPermissionProfileSatisfied,
  mergePermissionProfiles,
} from '../tool-v2/permissions';
import { ToolV2PermissionError } from '../tool-v2/errors';

export interface AuthorizationPermissionResolution {
  readonly fileSystemPolicy: AuthorizationExecutionRequest['fileSystemPolicy'];
  readonly networkPolicy: AuthorizationExecutionRequest['networkPolicy'];
  readonly grantRecord?: PermissionGrantRecord;
  readonly rulesMatched: string[];
  readonly tags: string[];
}

export class AuthorizationPermissionService {
  constructor(
    private readonly grantStore: AuthorizationGrantStore = new InMemoryAuthorizationGrantStore()
  ) {}

  async ensurePermissions(
    request: AuthorizationExecutionRequest
  ): Promise<AuthorizationPermissionResolution> {
    await this.restoreSessionGrants(request);

    const basePermissions = applyPermissionProfile(
      {
        fileSystem: request.fileSystemPolicy,
        network: request.networkPolicy,
      },
      request.sessionState.effectivePermissions()
    );
    const requestedPermissions = mergePermissionProfiles(
      collectMissingPermissionProfile(request.plan, request.workingDirectory, basePermissions),
      request.plan.requestedPermissions
    );

    if (!requestedPermissions) {
      return {
        fileSystemPolicy: request.fileSystemPolicy,
        networkPolicy: request.networkPolicy,
        rulesMatched: ['permissions-satisfied'],
        tags: ['permissions'],
      };
    }

    if (!request.runtime.requestPermissions) {
      throw new ToolV2PermissionError(
        buildPermissionDeniedMessage(request.toolName, requestedPermissions),
        {
          toolName: request.toolName,
          requestedPermissions,
        }
      );
    }

    await request.onStage?.('permission_requested', {
      toolName: request.toolName,
      requestedScope: 'turn',
      permissions: requestedPermissions,
    });

    const grant = await this.normalizeGrant({
      runtimeRequest: {
        toolName: request.toolName,
        toolCallId: request.toolCallId,
        requestedScope: 'turn',
        reason: buildPermissionReason(request.toolName, requestedPermissions),
        permissions: requestedPermissions,
      },
      requestedScope: 'turn',
      runtime: request.runtime,
    });

    request.sessionState.grantPermissions(grant);
    const effectivePermissions = applyPermissionProfile(
      basePermissions,
      request.sessionState.effectivePermissions()
    );
    if (!isPermissionProfileSatisfied(effectivePermissions, requestedPermissions)) {
      throw new ToolV2PermissionError(`Permission request denied for ${request.toolName}`, {
        toolName: request.toolName,
        requestedPermissions,
      });
    }

    const record: PermissionGrantRecord = {
      grantId: createRecordId('grant'),
      principalId: request.runtime.principal.principalId,
      sessionId: request.runtime.sessionId,
      tenantId: request.runtime.principal.tenantId,
      workspaceId: request.runtime.principal.workspaceId,
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      scope: grant.scope,
      granted: grant.granted,
      grantedBy: grant.grantedBy || request.runtime.principal.principalId,
      createdAt: Date.now(),
      reason: buildPermissionReason(request.toolName, requestedPermissions),
    };
    await this.grantStore.record(record);

    await request.onStage?.('permission_resolved', {
      toolName: request.toolName,
      granted: grant.granted,
      scope: grant.scope,
    });

    return {
      fileSystemPolicy: effectivePermissions.fileSystem,
      networkPolicy: effectivePermissions.network,
      grantRecord: record,
      rulesMatched: ['permissions-granted'],
      tags: ['permissions', grant.scope === 'session' ? 'scope-session' : 'scope-turn'],
    };
  }

  async requestExplicitGrant(request: ExplicitPermissionGrantRequest) {
    const grant = await this.normalizeGrant({
      runtimeRequest: {
        toolName: request.toolName,
        toolCallId: request.toolCallId,
        requestedScope: request.requestedScope,
        reason: request.reason,
        permissions: request.permissions,
      },
      requestedScope: request.requestedScope,
      runtime: request.runtime,
    });
    request.sessionState.grantPermissions(grant);
    const record: PermissionGrantRecord = {
      grantId: createRecordId('grant'),
      principalId: request.runtime.principal.principalId,
      sessionId: request.runtime.sessionId,
      tenantId: request.runtime.principal.tenantId,
      workspaceId: request.runtime.principal.workspaceId,
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      scope: grant.scope,
      granted: grant.granted,
      grantedBy: grant.grantedBy || request.runtime.principal.principalId,
      createdAt: Date.now(),
      reason: request.reason,
    };
    await this.grantStore.record(record);
    return grant;
  }

  private async normalizeGrant(input: {
    runtimeRequest: {
      toolName: string;
      toolCallId: string;
      requestedScope: 'turn' | 'session';
      reason?: string;
      permissions: ExplicitPermissionGrantRequest['permissions'];
    };
    requestedScope: 'turn' | 'session';
    runtime: AuthorizationExecutionRequest['runtime'];
  }) {
    if (!input.runtime.requestPermissions) {
      throw new ToolV2PermissionError(
        `Permission request resolver is not configured for ${input.runtimeRequest.toolName}`,
        {
          toolName: input.runtimeRequest.toolName,
          requestedPermissions: input.runtimeRequest.permissions,
        }
      );
    }
    const grant = await input.runtime.requestPermissions(input.runtimeRequest);
    return {
      granted: grant.granted,
      grantedBy: grant.grantedBy,
      scope: input.requestedScope === 'session' && grant.scope === 'session' ? 'session' : 'turn',
    } as const;
  }

  private async restoreSessionGrants(request: AuthorizationExecutionRequest): Promise<void> {
    if (!request.runtime.sessionId) {
      return;
    }

    const records = await this.grantStore.findActiveSessionGrants({
      principalId: request.runtime.principal.principalId,
      sessionId: request.runtime.sessionId,
      activeAt: Date.now(),
    });

    for (const record of records) {
      request.sessionState.grantPermissions({
        granted: record.granted,
        scope: 'session',
        grantedBy: record.grantedBy,
      });
    }
  }
}

function buildPermissionReason(
  toolName: string,
  permissions: ExplicitPermissionGrantRequest['permissions']
): string {
  const read = permissions.fileSystem?.read || [];
  const write = permissions.fileSystem?.write || [];
  const hosts = permissions.network?.allowedHosts || [];
  const segments: string[] = [];

  if (read.length > 0) {
    segments.push(`read ${read.join(', ')}`);
  }
  if (write.length > 0) {
    segments.push(`write ${write.join(', ')}`);
  }
  if (hosts.length > 0) {
    segments.push(`connect ${hosts.join(', ')}`);
  }

  return segments.length > 0
    ? `Additional permissions required to ${segments.join('; ')}`
    : `Additional permissions required before running ${toolName}`;
}

function buildPermissionDeniedMessage(
  toolName: string,
  permissions: ExplicitPermissionGrantRequest['permissions']
): string {
  const read = permissions.fileSystem?.read || [];
  const write = permissions.fileSystem?.write || [];
  const hosts = permissions.network?.allowedHosts || [];

  if (hosts.length > 0 || permissions.network?.enabled) {
    return hosts.length > 0
      ? `Network access denied: ${hosts.join(', ')}`
      : `Network access denied for ${toolName}`;
  }
  if (write.length > 0) {
    return `Write access denied: ${write.join(', ')}`;
  }
  if (read.length > 0) {
    return `Read access denied: ${read.join(', ')}`;
  }

  return `Permission denied for ${toolName}`;
}

function createRecordId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
