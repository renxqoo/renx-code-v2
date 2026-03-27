import type { IncomingMessage } from 'node:http';
import type { PrincipalContext } from '@renx-code/core';

import type { ServerConfig } from '../config/schema';
import { createGatewayPrincipal } from '../runtime/principal';

export type GatewayAuthorizationResult =
  | { ok: true; principal: PrincipalContext }
  | { ok: false; statusCode: 401 | 403; error: string };

export function authorizeGatewayRequest(
  request: IncomingMessage,
  config: ServerConfig
): GatewayAuthorizationResult {
  switch (config.authMode) {
    case 'none':
      return {
        ok: true,
        principal: createGatewayPrincipal({
          principalId: 'local-operator',
          source: 'local',
        }),
      };
    case 'token':
      return authorizeBearerToken(request, config);
    case 'trusted-proxy':
      return authorizeTrustedProxy(request, config);
    default:
      return { ok: false, statusCode: 401, error: 'Unsupported auth mode' };
  }
}

function authorizeBearerToken(
  request: IncomingMessage,
  config: ServerConfig
): GatewayAuthorizationResult {
  const authorization = readHeader(request, 'authorization');
  if (!authorization?.toLowerCase().startsWith('bearer ')) {
    return { ok: false, statusCode: 401, error: 'Missing bearer token' };
  }

  const token = authorization.slice('Bearer '.length).trim();
  if (!config.token || token !== config.token) {
    return { ok: false, statusCode: 401, error: 'Invalid bearer token' };
  }

  return {
    ok: true,
    principal: createGatewayPrincipal({
      principalId: 'operator',
      source: 'gateway-token',
    }),
  };
}

function authorizeTrustedProxy(
  request: IncomingMessage,
  config: ServerConfig
): GatewayAuthorizationResult {
  const remoteAddress = request.socket.remoteAddress || '';
  if (!config.trustedProxyIps.includes(remoteAddress)) {
    return { ok: false, statusCode: 403, error: 'Untrusted proxy' };
  }

  const user = readHeader(request, config.trustedProxyUserHeader);
  if (!user) {
    return { ok: false, statusCode: 401, error: 'Missing trusted proxy user header' };
  }

  return {
    ok: true,
    principal: createGatewayPrincipal({
      principalId: user,
      displayName: user,
      source: 'trusted-proxy',
    }),
  };
}

function readHeader(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value[0];
  }
  return typeof value === 'string' ? value : undefined;
}
