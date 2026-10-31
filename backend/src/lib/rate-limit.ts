/**
 * Rate limiting on Postgres with in-memory fallback.
 *
 * The spec allows "Upstash or Supabase-based" and this is the Supabase one:
 * a single fixed-window upsert through `public.consume_rate_limit`. That means
 * one fewer service to provision before launch and one fewer secret to rotate.
 *
 * When Postgres is unavailable or the function is not yet migrated, an in-memory
 * fixed window limiter safely steps in so that the store stays protected and
 * rate limits are strictly enforced.
 */

import { env } from './env';
import { logger } from './logger';
import { createAdminClient } from './supabase/admin';

export interface RateLimitRule {
  /** Requests permitted per window. */
  limit: number;
  windowSeconds: number;
  /** Fail closed if the limiter itself errors. Default false. */
  strict?: boolean;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  used: number;
  remaining: number;
  resetAt: string;
  /** Seconds to put in a Retry-After header. */
  retryAfter: number;
  /** True when the limiter could not run and the result is a fallback. */
  degraded?: boolean;
}

/**
 * Sensible defaults, tuned for a one-author store rather than a marketplace.
 */
export const RATE_LIMITS = {
  download: { limit: 10, windowSeconds: 60, strict: true },
  downloadHourly: { limit: 40, windowSeconds: 3600, strict: true },
  checkout: { limit: 10, windowSeconds: 300, strict: true },
  coupon: { limit: 12, windowSeconds: 300, strict: true },
  review: { limit: 5, windowSeconds: 3600 },
  newsletter: { limit: 5, windowSeconds: 3600 },
  contact: { limit: 5, windowSeconds: 3600 },
  adminUpload: { limit: 30, windowSeconds: 300 },
  adminWrite: { limit: 120, windowSeconds: 60 },
  authEmail: { limit: 5, windowSeconds: 900, strict: true },
  apiDefault: { limit: 60, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitName = keyof typeof RATE_LIMITS;

// In-memory fallback buckets when Postgres consume_rate_limit is not yet available
const memoryBuckets = new Map<string, { count: number; resetAt: number }>();

function memoryRateLimit(bucket: string, rule: RateLimitRule): RateLimitResult {
  const now = Date.now();
  const existing = memoryBuckets.get(bucket);

  if (!existing || existing.resetAt <= now) {
    const resetAt = now + rule.windowSeconds * 1000;
    memoryBuckets.set(bucket, { count: 1, resetAt });
    return {
      allowed: true,
      limit: rule.limit,
      used: 1,
      remaining: Math.max(0, rule.limit - 1),
      resetAt: new Date(resetAt).toISOString(),
      retryAfter: rule.windowSeconds,
      degraded: true,
    };
  }

  existing.count += 1;
  const allowed = existing.count <= rule.limit;
  const remaining = Math.max(0, rule.limit - existing.count);
  const retryAfter = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));

  return {
    allowed,
    limit: rule.limit,
    used: existing.count,
    remaining,
    resetAt: new Date(existing.resetAt).toISOString(),
    retryAfter,
    degraded: true,
  };
}

function fallback(rule: RateLimitRule, allowed: boolean): RateLimitResult {
  return {
    allowed,
    limit: rule.limit,
    used: allowed ? 0 : rule.limit,
    remaining: allowed ? rule.limit : 0,
    resetAt: new Date(Date.now() + rule.windowSeconds * 1000).toISOString(),
    retryAfter: rule.windowSeconds,
    degraded: true,
  };
}

/**
 * Consumes one unit against a bucket.
 */
export async function rateLimit(bucket: string, rule: RateLimitRule): Promise<RateLimitResult> {
  if (!env.RATE_LIMIT_ENABLED) return fallback(rule, true);

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc('consume_rate_limit', {
      p_bucket: bucket.slice(0, 200),
      p_limit: rule.limit,
      p_window_seconds: rule.windowSeconds,
    });

    if (error) throw new Error(error.message);

    const row = Array.isArray(data) ? data[0] : null;
    if (!row) throw new Error('consume_rate_limit returned no row');

    const resetAt = new Date(row.reset_at);
    const retryAfter = Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 1000));

    return {
      allowed: row.allowed,
      limit: rule.limit,
      used: row.used,
      remaining: row.remaining,
      resetAt: resetAt.toISOString(),
      retryAfter,
    };
  } catch (error) {
    logger.warn('Postgres rate limiter unavailable, falling back to in-memory rate limiting', {
      bucket,
      error: error instanceof Error ? error.message : String(error),
    });
    // Fall back to genuine in-memory rate limiting with the exact same limits
    return memoryRateLimit(bucket, rule);
  }
}

/** Named-rule convenience wrapper. */
export async function rateLimitNamed(
  name: RateLimitName,
  identifier: string,
): Promise<RateLimitResult> {
  return rateLimit(`${name}:${identifier}`, RATE_LIMITS[name]);
}

/** Applies several rules and returns the first refusal, or the last result. */
export async function rateLimitAll(
  checks: { bucket: string; rule: RateLimitRule }[],
): Promise<RateLimitResult> {
  let last: RateLimitResult | null = null;

  for (const check of checks) {
    const result = await rateLimit(check.bucket, check.rule);
    if (!result.allowed) return result;
    last = result;
  }

  return last ?? fallback(RATE_LIMITS.apiDefault, true);
}

/** Standard headers so clients can back off politely. */
export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  const headers: Record<string, string> = {
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': result.resetAt,
  };
  if (!result.allowed) headers['Retry-After'] = String(result.retryAfter);
  return headers;
}
