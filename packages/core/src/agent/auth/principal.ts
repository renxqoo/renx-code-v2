import type { PrincipalContext, PrincipalSource, PrincipalType } from './contracts';

export function createPrincipalContext(input?: Partial<PrincipalContext>): PrincipalContext {
  return {
    principalId: input?.principalId?.trim() || 'system',
    principalType: input?.principalType || 'system',
    tenantId: input?.tenantId,
    workspaceId: input?.workspaceId,
    source: input?.source || 'internal',
    roles: [...(input?.roles || [])],
    attributes: input?.attributes ? { ...input.attributes } : undefined,
  };
}

export function createSystemPrincipal(
  principalId = 'system',
  source: PrincipalSource = 'internal'
): PrincipalContext {
  return createPrincipalContext({
    principalId,
    principalType: 'system',
    source,
    roles: ['system'],
  });
}

export function createDefaultUserPrincipal(
  principalId: string,
  source: PrincipalSource = 'cli',
  roles: string[] = ['developer']
): PrincipalContext {
  return createPrincipalContext({
    principalId,
    principalType: 'user',
    source,
    roles,
  });
}

export function isPrivilegedPrincipalType(type: PrincipalType): boolean {
  return type === 'service' || type === 'system';
}
