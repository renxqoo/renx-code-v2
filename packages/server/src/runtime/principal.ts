import { createPrincipalContext, type PrincipalContext } from '@renx-code/core';

export type GatewayPrincipalSource = 'gateway-token' | 'trusted-proxy' | 'local';

export interface GatewayPrincipalInput {
  principalId: string;
  tenantId?: string;
  workspaceId?: string;
  displayName?: string;
  source: GatewayPrincipalSource;
}

export function createGatewayPrincipal(input: GatewayPrincipalInput): PrincipalContext {
  return createPrincipalContext({
    principalId: input.principalId,
    principalType: 'user',
    tenantId: input.tenantId || 'default',
    workspaceId: input.workspaceId || 'default',
    source: 'api',
    roles: ['operator'],
    attributes: {
      gatewaySource: input.source,
      displayName: input.displayName,
    },
  });
}
