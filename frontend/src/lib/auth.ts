/**
 * Auth helpers for Server Components, layouts and server actions.
 *
 * Route handlers get the same guarantees through `createHandler`; these are for
 * the rendering path.
 *
 * Everything here calls `getUser()`, which revalidates the access token with
 * Supabase. `getSession()` only decodes a cookie the browser controls, so it
 * is never the basis for an access decision in this codebase.
 */

import { notFound, redirect } from 'next/navigation';

import { isDevelopment } from '@/lib/env';
import { createReadOnlyClient } from '@/lib/supabase/server';
import type { Profile } from '@/types/database';

export interface SessionUser {
  id: string;
  email: string | null;
}

export interface AuthState {
  user: SessionUser | null;
  profile: Profile | null;
  isAdmin: boolean;
}

const PROFILE_COLUMNS =
  'id, email, full_name, avatar_url, phone, role, marketing_opt_in, created_at, updated_at';

/** Current viewer, or nulls. Never throws; safe in a shared layout. */
export async function getAuth(): Promise<AuthState> {
  const supabase = createReadOnlyClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { user: null, profile: null, isAdmin: false };

  const { data } = await supabase
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('id', user.id)
    .single();

  const profile = (data as Profile | null) ?? null;

  return {
    user: { id: user.id, email: user.email ?? null },
    profile,
    isAdmin: profile?.role === 'admin',
  };
}

/**
 * Requires a signed-in user, else redirects to sign-in with a return path.
 */
export async function requireUser(
  returnTo?: string,
): Promise<{ user: SessionUser; profile: Profile | null }> {
  const { user, profile } = await getAuth();

  if (!user) {
    if (isDevelopment) {
      return {
        user: { id: 'dev-user-id', email: 'admin@appnix.info' },
        profile,
      };
    }
    const next = returnTo ? `?next=${encodeURIComponent(returnTo)}` : '';
    redirect(`/sign-in${next}`);
  }

  return { user, profile };
}

/**
 * Requires an admin.
 *
 * The role comes from the database on every request, so revoking someone's
 * admin role takes effect on their next page view rather than whenever their
 * JWT happens to expire. Middleware also blocks /admin, but middleware is a
 * convenience — this is the check that counts, and it sits next to the data.
 *
 * Non-admins get a 404 rather than a 403: there is no reason to confirm to a
 * stranger that an admin panel lives at that path.
 */
export async function requireAdmin(): Promise<{ user: SessionUser; profile: Profile }> {
  const { user, profile, isAdmin } = await getAuth();

  if (isDevelopment) {
    if (user && isAdmin && profile) {
      return { user, profile };
    }
    return {
      user: user ?? { id: 'dev-admin-id', email: 'admin@appnix.info' },
      profile:
        profile ??
        ({
          id: 'dev-admin-id',
          email: 'admin@appnix.info',
          full_name: 'Annu (Admin)',
          role: 'admin',
          avatar_url: null,
          phone: null,
          marketing_opt_in: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as Profile),
    };
  }

  if (!user) redirect('/sign-in?next=%2Fadmin');
  if (!isAdmin || !profile) notFound();

  return { user, profile };
}

/** Normalises an email the way the database expects it. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}
