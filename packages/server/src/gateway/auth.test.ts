import { describe, it, expect } from 'vitest';
import { createBearerAuth } from './auth';

describe('createBearerAuth', () => {
  it('should allow anonymous access when no secret configured', () => {
    const auth = createBearerAuth(undefined);
    const result = auth({ headers: {} });
    expect(result.authenticated).toBe(true);
    expect(result.principal?.role).toBe('admin');
  });

  it('should authenticate valid bearer token', () => {
    const auth = createBearerAuth('my-secret');
    const result = auth({ headers: { authorization: 'Bearer my-secret' } });
    expect(result.authenticated).toBe(true);
    expect(result.principal?.id).toBe('bearer-user');
  });

  it('should reject missing authorization header', () => {
    const auth = createBearerAuth('my-secret');
    const result = auth({ headers: {} });
    expect(result.authenticated).toBe(false);
    expect(result.error).toContain('Missing');
  });

  it('should reject invalid format', () => {
    const auth = createBearerAuth('my-secret');
    const result = auth({ headers: { authorization: 'Basic abc' } });
    expect(result.authenticated).toBe(false);
    expect(result.error).toContain('format');
  });

  it('should reject wrong token', () => {
    const auth = createBearerAuth('my-secret');
    const result = auth({ headers: { authorization: 'Bearer wrong' } });
    expect(result.authenticated).toBe(false);
    expect(result.error).toContain('Invalid token');
  });
});
