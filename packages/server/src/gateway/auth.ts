export interface AuthResult {
  readonly authenticated: boolean;
  readonly principal?: {
    readonly id: string;
    readonly role: 'admin' | 'user' | 'guest';
  };
  readonly error?: string;
}

export function createBearerAuth(secret: string | undefined) {
  return function authenticate(request: { headers: Record<string, string | undefined> }): AuthResult {
    if (!secret) {
      return { authenticated: true, principal: { id: 'anonymous', role: 'admin' } };
    }
    const authHeader = request.headers['authorization'];
    if (!authHeader) {
      return { authenticated: false, error: 'Missing Authorization header' };
    }
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      return { authenticated: false, error: 'Invalid Authorization header format' };
    }
    if (parts[1] !== secret) {
      return { authenticated: false, error: 'Invalid token' };
    }
    return { authenticated: true, principal: { id: 'bearer-user', role: 'admin' } };
  };
}
