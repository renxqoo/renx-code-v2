import type { IncomingMessage } from 'node:http';
import type { PrincipalContext } from '@renx-code/core';

export interface GatewayRequestContext {
  principal: PrincipalContext;
  requestId: string;
  remoteAddress?: string;
}

export function createGatewayRequestContext(
  request: IncomingMessage,
  principal: PrincipalContext
): GatewayRequestContext {
  return {
    principal,
    requestId: readHeader(request, 'x-request-id') || `req_${Date.now()}`,
    remoteAddress: request.socket.remoteAddress,
  };
}

function readHeader(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value[0];
  }
  return typeof value === 'string' ? value : undefined;
}
