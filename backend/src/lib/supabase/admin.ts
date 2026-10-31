/**
 * Service-role Supabase client. BYPASSES EVERY RLS POLICY.
 *
 * Only four kinds of code should import this:
 *
 *   1. Route handlers that must act across users — /api/checkout (creating an
 *      order), /api/webhooks/razorpay (fulfilling one), /api/download
 *      (reading a private object key).
 *   2. Admin route handlers that need columns withheld from browsers.
 *   3. Server actions doing the same.
 *   4. `scripts/`.
 *
 * It must never be imported, directly or transitively, by a Client Component.
 * The guard below and the ESLint rule in .eslintrc.json both exist to catch
 * that before it ships, because the failure mode is a full database compromise
 * rather than a bug.
 */

import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';

import { env } from '@/lib/env';
import type { Database } from '@/types/database';

if (typeof window !== 'undefined') {
  throw new Error(
    'The Supabase service-role client was imported into browser code. Stop, remove the import, ' +
      'and rotate SUPABASE_SERVICE_ROLE_KEY if this ever reached production.',
  );
}

let cached: SupabaseClient<Database> | null = null;

export function createAdminClient(): SupabaseClient<Database> {
  cached ??= createSupabaseClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        // There is no user here and never will be. Persisting or refreshing a
        // session with this key would be meaningless and risky.
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
      global: {
        headers: { 'x-application-name': 'bookishbae-server' },
      },
    },
  );

  return cached;
}

export type AdminClient = SupabaseClient<Database>;
