/** PostgreSQL fixed-window rate limiting. Database failures fail closed. */
import { env } from './env';
import { db } from './db/postgres';

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

// Explicitly disabled limiting is a configuration choice, never an outage fallback.
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

  const [row] = await db.query<{ allowed: boolean; used: number; remaining: number; reset_at: string }>(
    'SELECT * FROM public.consume_rate_limit($1,$2,$3)', [bucket.slice(0, 200), rule.limit, rule.windowSeconds]);
  if (!row) throw new Error('Database did not return the rate limit counter.');
  const resetAt = new Date(row.reset_at);
  return { allowed: row.allowed, limit: rule.limit, used: row.used, remaining: row.remaining,
    resetAt: resetAt.toISOString(), retryAfter: Math.max(1, Math.ceil((resetAt.getTime()-Date.now())/1000)) };
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
