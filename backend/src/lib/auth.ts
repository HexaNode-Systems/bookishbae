import { getProfile } from './db/profiles';
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

/** Current viewer. Database/backend errors fail closed. */
export async function getAuth(): Promise<AuthState> {
  const supabase = createReadOnlyClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { user: null, profile: null, isAdmin: false };

  const stored = await getProfile(user.id);
  const { is_admin, ...profile } = stored ?? { is_admin: false };
  return { user: { id: user.id, email: user.email ?? null }, profile: stored ? profile as Profile : null, isAdmin: is_admin };
}

/**
 * Requires a signed-in user, else redirects to sign-in with a return path.
 */
export async function requireUser(
  returnTo?: string,
): Promise<{ user: SessionUser; profile: Profile | null }> {
  const { user, profile } = await getAuth();

  if (!user) {
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

  if (!user) redirect('/sign-in?next=%2Fadmin');
  if (!isAdmin || !profile) notFound();

  return { user, profile };
}

/** Normalises an email the way the database expects it. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}
