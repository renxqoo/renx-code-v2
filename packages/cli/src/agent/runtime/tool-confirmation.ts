import type {
  AgentEventHandlers,
  AgentToolConfirmDecision,
  AgentToolConfirmEvent,
  AgentToolPermissionEvent,
  AgentToolPermissionGrant,
} from './types';

const DEFAULT_FALLBACK_DECISION: AgentToolConfirmDecision = {
  approved: false,
  message: 'Tool confirmation handler is not available.',
};
const DEFAULT_FALLBACK_PERMISSION_GRANT: AgentToolPermissionGrant = {
  granted: {},
  scope: 'turn',
};

export const resolveToolConfirmDecision = async (
  event: AgentToolConfirmEvent,
  handlers: AgentEventHandlers
): Promise<AgentToolConfirmDecision> => {
  if (!handlers.onToolConfirmRequest) {
    return DEFAULT_FALLBACK_DECISION;
  }

  const decision = await handlers.onToolConfirmRequest(event);
  return decision ?? { approved: false, message: 'Tool confirmation was not resolved.' };
};

export const resolveToolPermissionGrant = async (
  event: AgentToolPermissionEvent,
  handlers: AgentEventHandlers
): Promise<AgentToolPermissionGrant> => {
  if (!handlers.onToolPermissionRequest) {
    return {
      ...DEFAULT_FALLBACK_PERMISSION_GRANT,
      scope: event.requestedScope,
    };
  }

  return (await handlers.onToolPermissionRequest(event)) ?? DEFAULT_FALLBACK_PERMISSION_GRANT;
};
