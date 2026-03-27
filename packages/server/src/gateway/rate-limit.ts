import type { IncomingMessage } from 'node:http';

import type { ServerRateLimitConfig } from '../config/schema';

interface RateLimitState {
  count: number;
  resetAt: number;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
}

export class InMemoryRateLimiter {
  private readonly buckets = new Map<string, RateLimitState>();

  constructor(private readonly config: ServerRateLimitConfig) {}

  consume(request: IncomingMessage): RateLimitResult {
    const now = Date.now();
    const key = this.resolveKey(request);
    const current = this.buckets.get(key);

    if (!current || current.resetAt <= now) {
      this.buckets.set(key, {
        count: 1,
        resetAt: now + this.config.windowMs,
      });
      this.cleanup(now);
      return { allowed: true };
    }

    if (current.count >= this.config.maxRequests) {
      this.cleanup(now);
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
      };
    }

    current.count += 1;
    this.cleanup(now);
    return { allowed: true };
  }

  private resolveKey(request: IncomingMessage): string {
    const forwardedFor = readHeader(request, 'x-forwarded-for');
    if (forwardedFor) {
      return forwardedFor.split(',')[0]?.trim() || 'unknown';
    }
    return request.socket.remoteAddress || 'unknown';
  }

  private cleanup(now: number): void {
    for (const [key, value] of this.buckets.entries()) {
      if (value.resetAt <= now) {
        this.buckets.delete(key);
      }
    }
  }
}

function readHeader(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value[0];
  }
  return typeof value === 'string' ? value : undefined;
}
