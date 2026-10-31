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

import { updateSession } from '@/lib/supabase/middleware';

const PROTECTED_PREFIXES = ['/account', '/admin', '/library'];

/**
 * Builds the Content-Security-Policy.
 *
 * `'strict-dynamic'` is the important part: it means a script trusted by its
 * nonce can load further scripts, which is how payment gateways bootstrap
 * themselves, while an injected `<script>` in a review body still gets nothing.
 * Host allowlists are kept alongside it for browsers without strict-dynamic
 * support, where they are honoured instead.
 *
 * `style-src` has to carry `'unsafe-inline'`: both Next and Framer Motion write
 * inline styles, and a nonce cannot cover style attributes. That is a real but
 * narrow concession — it permits styling, not execution.
 */
function contentSecurityPolicy(nonce: string, isDev: boolean): string {
  const supabaseOrigin = (() => {
    try {
      return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').origin;
    } catch {
      return '';
    }
  })();

  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],

    'script-src': [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      'https://sdk.cashfree.com',
      // React Refresh compiles components with eval during development only.
      ...(isDev ? ["'unsafe-eval'"] : []),
    ],

    'style-src': ["'self'", "'unsafe-inline'"],

    // next/font self-hosts Playfair Display and Inter at build time, so no
    // Google Fonts origin is needed at runtime.
    'font-src': ["'self'", 'data:'],

    'img-src': [
      "'self'",
      'data:',
      'blob:',
      'https://res.cloudinary.com',
      ...(supabaseOrigin ? [supabaseOrigin] : []),
      'https://lh3.googleusercontent.com',
    ],

    'connect-src': [
      "'self'",
      ...(supabaseOrigin ? [supabaseOrigin, supabaseOrigin.replace('https://', 'wss://')] : []),
      'https://api.cashfree.com',
      'https://sandbox.cashfree.com',
      'https://*.cashfree.com',
      'https://api.cloudinary.com',
      'https://res.cloudinary.com',
      ...(isDev ? ['ws://localhost:*', 'http://localhost:*'] : []),
    ],

    // Cashfree Checkout renders inside an iframe or modal.
    'frame-src': [
      "'self'",
      'https://sdk.cashfree.com',
      'https://api.cashfree.com',
      'https://sandbox.cashfree.com',
      'https://*.cashfree.com',
    ],

    'worker-src': ["'self'", 'blob:'],
    'media-src': ["'self'", 'blob:', 'https://res.cloudinary.com'],
    'manifest-src': ["'self'"],

    // Nothing may frame us; the modern counterpart to X-Frame-Options: DENY.
    'frame-ancestors': ["'none'"],
    // Stops an injected form from posting our cookies somewhere else.
    'form-action': ["'self'"],
    'base-uri': ["'self'"],
    'object-src': ["'none'"],
  };

  const policy = Object.entries(directives)
    .map(([directive, values]) => `${directive} ${values.join(' ')}`)
    .join('; ');

  return isDev ? policy : `${policy}; upgrade-insecure-requests`;
}

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
