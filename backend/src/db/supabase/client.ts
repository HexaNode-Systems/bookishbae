'use client';

/**
 * Browser Supabase client.
 *
 * Carries the anon key and the user's session cookie, so every query it makes
 * is subject to RLS. That is the point: nothing this client can reach is
 * anything the user should not see.
 */

import { createBrowserClient } from '@supabase/ssr';

import { publicEnv } from '@/lib/env.public';
import type { Database } from '@/types/database';

let cached: ReturnType<typeof createBrowserClient<Database>> | null = null;

export function createClient() {
  // One instance per tab. A fresh client per render would re-subscribe to auth
  // state changes on every mount and leak listeners.
  cached ??= createBrowserClient<Database>(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey);
  return cached;
}
