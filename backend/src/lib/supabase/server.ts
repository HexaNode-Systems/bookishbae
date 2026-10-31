/**
 * Server Supabase client, scoped to the signed-in user.
 *
 * Use this for anything that should obey RLS — which is almost everything on
 * the read path, including admin screens. Reach for `@/lib/supabase/admin`
 * only when the operation genuinely has to see across users.
 */

import { cookies } from 'next/headers';

import { createServerClient, type CookieOptions } from '@supabase/ssr';

import { env } from '@/lib/env';
import type { Database } from '@/types/database';

/**
 * @param options.readOnly Pass true from a Server Component. Components cannot
 * write cookies, and Next throws if you try; the session refresh happens in
 * middleware instead.
 */
export function createClient(options: { readOnly?: boolean; cookieHeader?: string } = {}) {
  let cookieStore: ReturnType<typeof cookies> | null = null;
  try {
    cookieStore = cookies();
  } catch {
    cookieStore = null;
  }

  const cookieMap = new Map<string, string>();
  if (options.cookieHeader) {
    options.cookieHeader.split(';').forEach((part) => {
      const [key, val] = part.split('=').map((s) => s.trim());
      if (key && val) cookieMap.set(key, val);
    });
  }

  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        get(name: string) {
          if (cookieStore) {
            try {
              return cookieStore.get(name)?.value;
            } catch {
              // Fallback to cookieMap
            }
          }
          return cookieMap.get(name);
        },
        set(name: string, value: string, cookieOptions: CookieOptions) {
          if (options.readOnly) return;
          if (cookieStore) {
            try {
              cookieStore.set({ name, value, ...cookieOptions });
              return;
            } catch {
              // Called from a context that cannot set cookies.
            }
          }
          cookieMap.set(name, value);
        },
        remove(name: string, cookieOptions: CookieOptions) {
          if (options.readOnly) return;
          if (cookieStore) {
            try {
              cookieStore.set({ name, value: '', ...cookieOptions, maxAge: 0 });
              return;
            } catch {
              // As above.
            }
          }
          cookieMap.delete(name);
        },
      },
    },
  );
}

/** Convenience wrapper for Server Components, which must not write cookies. */
export function createReadOnlyClient() {
  return createClient({ readOnly: true });
}
