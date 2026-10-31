/**
 * Request-origin helpers: client IP, IP hashing and same-origin checks.
 */

import { createHash, timingSafeEqual } from 'node:crypto';

import { env } from './env';

/**
 * Best-effort client IP.
 *
 * On Vercel, `x-forwarded-for` is set by the platform and its FIRST entry is
 * the real client. We deliberately do not trust a client-supplied
 * `x-real-ip`-style header on its own, because anyone can send one; behind a
 * proxy you cannot do better than this, which is also why the IP is only ever
 * used for rate limiting and audit, never for authorisation.
 */
export function clientIp(headers: Headers): string | null {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return headers.get('x-real-ip')?.trim() || headers.get('cf-connecting-ip')?.trim() || null;
}

/** Salted SHA-256 of an IP. Mirrors public.hash_ip() in SQL. */
export function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  return createHash('sha256').update(`${env.IP_HASH_SALT}:${ip}`).digest('hex');
}

/** The user agent, truncated — some bots send kilobytes of it. */
export function userAgent(headers: Headers): string | null {
  const value = headers.get('user-agent');
  return value ? value.slice(0, 400) : null;
}

/** Origins allowed to make state-changing requests to our API. */
export function allowedOrigins(): string[] {
  const origins = new Set<string>([env.NEXT_PUBLIC_SITE_URL]);

  // Vercel preview deployments get their own hostname.
  if (process.env.VERCEL_URL) origins.add(`https://${process.env.VERCEL_URL}`);
  if (process.env.VERCEL_BRANCH_URL) origins.add(`https://${process.env.VERCEL_BRANCH_URL}`);

  if (env.NODE_ENV === 'development' || (env.NODE_ENV as string) === 'test') {
    origins.add('http://localhost:3000');
    origins.add('http://127.0.0.1:3000');
  }

  return Array.from(origins);
}

/**
 * CSRF defence for mutating requests.
 *
 * Supabase keeps the session in cookies, which means a cross-site form post
 * would otherwise carry the user's credentials. Two things make that safe:
 *
 *   1. Our API only accepts `application/json`, which a plain cross-site HTML
 *      form cannot produce — so the browser must preflight, and CORS blocks it.
 *   2. We additionally require that, when the browser tells us where the
 *      request came from, it came from us.
 *
 * A same-origin `fetch` sends `Origin` on POST, so the header is normally
 * present. Server-to-server callers (the Cashfree webhook) send none, which is
 * why a missing `Origin` is tolerated — those routes verify a signature
 * instead, and that is a stronger check than any header.
 */
export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get('origin');
  const site = request.headers.get('sec-fetch-site');

  if (site && !['same-origin', 'same-site', 'none'].includes(site)) return false;
  if (!origin) return true;

  return allowedOrigins().includes(origin);
}

/** Constant-time string comparison for signatures and tokens. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  // timingSafeEqual throws on a length mismatch, and the length itself is not
  // a secret for the values we compare here.
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Short, non-guessable id for correlating a log line with a response. */
export function requestId(): string {
  return crypto.randomUUID().slice(0, 8);
}
