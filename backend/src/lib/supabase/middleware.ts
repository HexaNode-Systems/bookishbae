/**
 * Session refresh for Next.js middleware.
 *
 * Supabase access tokens are short-lived. Server Components cannot write
 * cookies, so if the refresh did not happen here, a user would be silently
 * signed out the moment their token expired. This runs on every matched
 * request, swaps the refresh token for a new access token when needed, and
 * writes the result onto the response.
 */

import { type NextRequest, NextResponse } from 'next/server';

import { createServerClient, type CookieOptions } from '@supabase/ssr';

import { env } from '@/lib/env';
import type { Database } from '@/types/database';

export async function updateSession(request: NextRequest): Promise<{
  response: NextResponse;
  user: { id: string; email: string | null } | null;
}> {
  let response = NextResponse.next({ request: { headers: request.headers } });

  const supabase = createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          // Write to both: the request so downstream handlers in this same
          // pass see the new token, and the response so the browser keeps it.
          request.cookies.set({ name, value, ...options });
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({ name, value: '', ...options });
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set({ name, value: '', ...options, maxAge: 0 });
        },
      },
    },
  );

  // getUser() revalidates the token against Supabase. getSession() only decodes
  // the cookie, which a client could have tampered with, so it must not be used
  // for an access decision.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return {
    response,
    user: user ? { id: user.id, email: user.email ?? null } : null,
  };
}
