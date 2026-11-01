/**
 * Edge middleware. Three jobs, in this order:
 *
 *   1. Mint a per-request CSP nonce and attach the policy.
 *   2. Refresh the Supabase session, because Server Components cannot write
 *      cookies and an unrefreshed token means a buyer gets signed out mid-visit.
 *   3. Bounce anonymous visitors away from /account and /admin before any page
 *      code runs.
 *
 * Step 3 is a convenience, not the security boundary. The real checks live next
 * to the data: `requireAdmin()` on the page and `auth: 'admin'` on the route
 * handler, both of which read the role from Postgres. Middleware can be
 * bypassed by a misconfigured matcher; RLS cannot.
 *
 * API routes are excluded from the matcher — they manage their own cookies and
 * send their own headers, and payment webhooks must reach the handler with
 * their body untouched.
 */

import { type NextRequest, NextResponse } from 'next/server';

import { contentSecurityPolicy } from '@/lib/content-security-policy';
import { updateSession } from '@/lib/supabase/middleware';

const PROTECTED_PREFIXES = ['/account', '/admin', '/library'];

export async function middleware(request: NextRequest) {
  const isDev = process.env.NODE_ENV === 'development';
  const nonce = crypto.randomUUID().replace(/-/g, '');
  const csp = contentSecurityPolicy(nonce, isDev);

  // Next reads this header and stamps the nonce onto the scripts it renders.
  request.headers.set('x-nonce', nonce);
  request.headers.set('Content-Security-Policy', csp);

  const { response, user } = await updateSession(request);

  const { pathname, search } = request.nextUrl;

  if (!user && !isDev && PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    const signIn = request.nextUrl.clone();
    signIn.pathname = '/sign-in';
    signIn.search = '';
    signIn.searchParams.set('next', `${pathname}${search}`);
    return NextResponse.redirect(signIn);
  }

  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('x-nonce', nonce);

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except:
     *   api/*        — route handlers set their own headers and cookies
     *   _next/*      — build output, already immutable and cached
     *   static media — no session or policy needed
     */
    '/((?!api/|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|gif|webp|avif|svg|ico|woff|woff2|ttf|otf|pdf)$).*)',
  ],
};
