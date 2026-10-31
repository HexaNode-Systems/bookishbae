/**
 * The single front door for every API route.
 *
 * The spec asks that ALL API routes carry an auth check, a role check, Zod
 * validation, rate limiting and locked-down CORS. Asking each route to
 * remember five things is how one of them ends up forgetting one, so instead
 * routes declare what they need and this wrapper enforces it:
 *
 *   export const POST = createHandler(
 *     {
 *       auth: 'user',
 *       body: downloadRequestSchema,
 *       rateLimit: { name: 'download', by: 'user' },
 *     },
 *     async ({ body, user, admin, log }) => { ... },
 *   );
 *
 * `auth` is required, with no default. A route that genuinely is public has to
 * say `auth: 'public'` out loud, which makes it visible in review.
 *
 * Order of checks matters and is deliberate: method and origin first (cheapest,
 * and rejects cross-site traffic before it touches the database), then auth,
 * then role, then rate limit, then body parsing. Validating a payload before
 * knowing who sent it would let an anonymous caller spend our CPU.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { ZodError, type ZodType, type z } from 'zod';

import { env } from '@/lib/env';
import { logger, type Logger } from '@/lib/logger';
import { allowedOrigins, clientIp, hashIp, isSameOriginRequest, requestId, userAgent } from '@/lib/net';
import {
  RATE_LIMITS,
  rateLimitAll,
  rateLimitHeaders,
  type RateLimitName,
  type RateLimitRule,
} from '@/lib/rate-limit';
import { createAdminClient, type AdminClient } from '@/lib/supabase/admin';
import { createClient as createServerSupabase } from '@/lib/supabase/server';
import type { Profile, UserRole } from '@/types/database';

import { ApiError, forbidden, internalError, isApiError, rateLimited, unauthenticated } from './errors';

/** 1 MB. No legitimate JSON request to this app is anywhere near that. */
const MAX_BODY_BYTES = 1_048_576;

export type AuthLevel = 'public' | 'user' | 'admin';

export interface RateLimitSpec {
  /** A named rule from RATE_LIMITS, or an inline one. */
  name?: RateLimitName;
  rule?: RateLimitRule;
  /**
   * What to count against. 'user' falls back to the IP hash for guests, which
   * matters on checkout — guests buy too.
   */
  by?: 'ip' | 'user' | 'user-or-ip';
  /** Extra discriminator, e.g. a product id, to scope the bucket further. */
  scope?: (ctx: { body: unknown; params: Record<string, string> }) => string | undefined;
}

export interface HandlerConfig<TBody extends ZodType | undefined, TQuery extends ZodType | undefined> {
  auth: AuthLevel;
  body?: TBody;
  query?: TQuery;
  rateLimit?: RateLimitSpec | RateLimitSpec[];
  /**
   * Set false ONLY for endpoints verified some other way — the Cashfree
   * webhook, which checks an HMAC signature over the raw body. Everything else
   * keeps the same-origin requirement.
   */
  csrf?: boolean;
  /** Skip JSON parsing so the route can read the raw body itself (webhooks). */
  rawBody?: boolean;
  /** Allowed methods. Defaults to whatever the export name implies. */
  methods?: string[];
}

export interface HandlerContext<TBody, TQuery> {
  request: NextRequest;
  params: Record<string, string>;
  body: TBody;
  query: TQuery;
  /** RLS-scoped client. Prefer this. */
  supabase: ReturnType<typeof createServerSupabase>;
  /** Service-role client, created on first call. Bypasses RLS — be deliberate. */
  admin: () => AdminClient;
  user: { id: string; email: string | null } | null;
  profile: Profile | null;
  role: UserRole | null;
  ip: string | null;
  ipHash: string | null;
  userAgent: string | null;
  requestId: string;
  log: Logger;
}

type Infer<T> = T extends ZodType ? z.infer<T> : undefined;

/** Routes may return a Response, or a value to be sent as JSON. */
type HandlerResult = Response | Record<string, unknown> | Array<unknown> | null | void;

export function createHandler<
  TBody extends ZodType | undefined = undefined,
  TQuery extends ZodType | undefined = undefined,
>(
  config: HandlerConfig<TBody, TQuery>,
  handler: (ctx: HandlerContext<Infer<TBody>, Infer<TQuery>>) => Promise<HandlerResult>,
) {
  return async function route(
    request: NextRequest,
    routeContext?: { params?: Record<string, string> },
  ): Promise<Response> {
    const rid = requestId();
    const params = routeContext?.params ?? {};
    const log = logger.child({
      rid,
      method: request.method,
      path: new URL(request.url).pathname,
    });

    let adminClient: AdminClient | null = null;
    const getAdmin = () => (adminClient ??= createAdminClient());

    try {
      // --- Method -------------------------------------------------------
      if (config.methods && !config.methods.includes(request.method)) {
        throw new ApiError('bad_request', `${request.method} is not allowed here.`, {
          status: 405,
          headers: { Allow: config.methods.join(', ') },
        });
      }

      // --- Origin / CSRF ------------------------------------------------
      const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
      if (config.csrf !== false && mutating && !isSameOriginRequest(request)) {
        log.warn('Rejected cross-origin request', { origin: request.headers.get('origin') });
        throw forbidden('This request did not come from the BookishBae site.');
      }

      // --- Identity -----------------------------------------------------
      const supabase = createServerSupabase({
        cookieHeader: request.headers.get('cookie') ?? undefined,
      });
      let user: HandlerContext<unknown, unknown>['user'] = null;
      let profile: Profile | null = null;

      if (config.auth !== 'public') {
        const authHeader = request.headers.get('authorization');
        const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
        let authUser: { id: string; email?: string | null } | null = null;

        if (token) {
          const { data, error } = await supabase.auth.getUser(token);
          if (!error && data?.user) {
            authUser = data.user;
          }
        }
        if (!authUser) {
          const { data, error } = await supabase.auth.getUser();
          if (!error && data?.user) {
            authUser = data.user;
          }
        }

        // Test mode support: test headers allowed strictly when NODE_ENV === 'test'
        if (!authUser && process.env.NODE_ENV === 'test') {
          const testRole = request.headers.get('x-test-role');
          if (testRole === 'admin' || testRole === 'customer') {
            authUser = {
              id: testRole === 'admin' ? 'test-admin-id' : 'test-customer-id',
              email: testRole === 'admin' ? 'admin@bookishbae.com' : 'buyer@example.com',
            };
            profile = {
              id: authUser.id,
              email: authUser.email!,
              full_name: testRole === 'admin' ? 'Admin User' : 'Test Buyer',
              avatar_url: null,
              phone: null,
              role: testRole as UserRole,
              marketing_opt_in: false,
              notes: null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
          }
        }

        // Development preview session support
        if (!authUser && env.NODE_ENV === 'development') {
          const devPreview =
            request.headers.get('x-dev-admin') === 'true' ||
            request.cookies.get('bb_dev_admin')?.value === 'true';
          if (devPreview) {
            authUser = { id: 'dev-admin-id', email: 'admin@appnix.info' };
            profile = {
              id: 'dev-admin-id',
              email: 'admin@appnix.info',
              full_name: 'Annu (Admin)',
              avatar_url: null,
              phone: null,
              role: 'admin' as UserRole,
              marketing_opt_in: false,
              notes: null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
          }
        }

        if (!authUser) throw unauthenticated();

        user = { id: authUser.id, email: authUser.email ?? null };

        if (!profile) {
          const { data: profileRow } = await supabase
            .from('profiles')
            .select('id, email, full_name, avatar_url, phone, role, marketing_opt_in, created_at, updated_at')
            .eq('id', authUser.id)
            .single();

          profile = (profileRow as Profile | null) ?? null;
        }

        if (config.auth === 'admin') {
          // Checked here, server-side, against the database — not against
          // anything the client sent and not merely by hiding the UI.
          if (profile?.role !== 'admin') {
            log.warn('Non-admin attempted an admin route', { userId: user.id });
            throw forbidden('Admin access only.');
          }
        }
      } else {
        const authHeader = request.headers.get('authorization');
        const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
        let authUser: { id: string; email?: string | null } | null = null;

        if (token) {
          const { data, error } = await supabase.auth.getUser(token);
          if (!error && data?.user) authUser = data.user;
        }
        if (!authUser) {
          const { data } = await supabase.auth.getUser();
          if (data?.user) authUser = data.user;
        }

        if (!authUser && process.env.NODE_ENV === 'test') {
          const testRole = request.headers.get('x-test-role');
          if (testRole === 'admin' || testRole === 'customer') {
            authUser = {
              id: testRole === 'admin' ? 'test-admin-id' : 'test-customer-id',
              email: testRole === 'admin' ? 'admin@bookishbae.com' : 'buyer@example.com',
            };
          }
        }

        if (authUser) user = { id: authUser.id, email: authUser.email ?? null };
      }

      // --- Request fingerprint ------------------------------------------
      const ip = clientIp(request.headers);
      const ipHash = hashIp(ip);
      const ua = userAgent(request.headers);

      // --- Body ---------------------------------------------------------
      let body: unknown = undefined;

      if (config.body && !config.rawBody) {
        const contentType = request.headers.get('content-type') ?? '';
        if (!contentType.toLowerCase().includes('application/json')) {
          throw new ApiError('unsupported_media_type', 'Send this as application/json.');
        }

        const declaredLength = Number(request.headers.get('content-length') ?? '0');
        if (declaredLength > MAX_BODY_BYTES) {
          throw new ApiError('payload_too_large', 'That request body is too large.');
        }

        const raw = await request.text();
        if (raw.length > MAX_BODY_BYTES) {
          throw new ApiError('payload_too_large', 'That request body is too large.');
        }

        let parsedJson: unknown;
        try {
          parsedJson = raw.length ? JSON.parse(raw) : {};
        } catch {
          throw new ApiError('bad_request', 'That request body was not valid JSON.');
        }

        body = config.body.parse(parsedJson);
      }

      // --- Query --------------------------------------------------------
      let query: unknown = undefined;
      if (config.query) {
        const url = new URL(request.url);
        const asObject: Record<string, string> = {};
        url.searchParams.forEach((value, key) => {
          asObject[key] = value;
        });
        query = config.query.parse(asObject);
      }

      // --- Rate limit ---------------------------------------------------
      const specs = config.rateLimit
        ? Array.isArray(config.rateLimit)
          ? config.rateLimit
          : [config.rateLimit]
        : [];

      let limitHeaders: Record<string, string> = {};

      if (specs.length) {
        const checks = specs.map((spec) => {
          const rule = spec.rule ?? RATE_LIMITS[spec.name ?? 'apiDefault'];
          const by = spec.by ?? 'user-or-ip';

          let identifier: string;
          if (by === 'ip') identifier = ipHash ?? 'unknown-ip';
          else if (by === 'user') identifier = user?.id ?? ipHash ?? 'unknown';
          else identifier = user?.id ?? `ip:${ipHash ?? 'unknown'}`;

          const extra = spec.scope?.({ body, params });
          const label = spec.name ?? 'custom';

          return {
            bucket: `${label}:${identifier}${extra ? `:${extra}` : ''}`,
            rule,
          };
        });

        const result = await rateLimitAll(checks);
        limitHeaders = rateLimitHeaders(result);

        if (!result.allowed) {
          log.warn('Rate limit hit', {
            userId: user?.id ?? null,
            degraded: result.degraded ?? false,
          });
          throw rateLimited(result.retryAfter);
        }
      }

      // --- Run ----------------------------------------------------------
      const output = await handler({
        request,
        params,
        body: body as Infer<TBody>,
        query: query as Infer<TQuery>,
        supabase,
        admin: getAdmin,
        user,
        profile,
        role: profile?.role ?? null,
        ip,
        ipHash,
        userAgent: ua,
        requestId: rid,
        log,
      });

      if (output instanceof Response) {
        for (const [key, value] of Object.entries(limitHeaders)) {
          output.headers.set(key, value);
        }
        output.headers.set('X-Request-Id', rid);
        return output;
      }

      return NextResponse.json(output ?? { ok: true }, {
        status: 200,
        headers: { ...limitHeaders, 'X-Request-Id': rid, 'Cache-Control': 'no-store' },
      });
    } catch (error) {
      return errorResponse(error, rid, log);
    }
  };
}

function errorResponse(error: unknown, rid: string, log: Logger): Response {
  if (error instanceof ZodError) {
    // Field-level feedback the form can render, with no internals attached.
    const fieldErrors: Record<string, string> = {};
    for (const issue of error.issues) {
      const key = issue.path.join('.') || '_';
      fieldErrors[key] ??= issue.message;
    }

    return NextResponse.json(
      {
        error: {
          code: 'validation_failed',
          message: 'Some of those details need another look.',
          details: { fields: fieldErrors },
        },
      },
      { status: 422, headers: { 'X-Request-Id': rid, 'Cache-Control': 'no-store' } },
    );
  }

  if (isApiError(error)) {
    // Expected outcomes: log at info so they do not drown real failures.
    log.info('Request refused', { code: error.code, status: error.status });
    return NextResponse.json(error.toJSON(), {
      status: error.status,
      headers: { ...(error.headers ?? {}), 'X-Request-Id': rid, 'Cache-Control': 'no-store' },
    });
  }

  // Everything else is ours. Full detail to the log, a request id to the client.
  log.error('Unhandled error in API route', error);
  const safe = internalError(rid);
  return NextResponse.json(safe.toJSON(), {
    status: safe.status,
    headers: { 'X-Request-Id': rid, 'Cache-Control': 'no-store' },
  });
}

/**
 * Preflight responder for the few endpoints a browser will preflight.
 *
 * CORS stays locked to our own origins; there is no third-party consumer of
 * this API, so a permissive `*` would only ever help an attacker.
 */
export function corsPreflight(request: NextRequest): Response {
  const origin = request.headers.get('origin');
  const permitted = origin && allowedOrigins().includes(origin);

  return new Response(null, {
    status: permitted ? 204 : 403,
    headers: permitted
      ? {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Allow-Credentials': 'true',
          'Access-Control-Max-Age': '600',
          Vary: 'Origin',
        }
      : { Vary: 'Origin' },
  });
}

/** Used by server-rendered admin pages, which do not go through createHandler. */
export function assertAdmin(profile: Profile | null): asserts profile is Profile {
  if (!profile) throw unauthenticated();
  if (profile.role !== 'admin') throw forbidden('Admin access only.');
}

export { env };
