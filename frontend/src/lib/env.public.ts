/**
 * The handful of values a browser is allowed to know.
 *
 * Next.js inlines `NEXT_PUBLIC_*` at build time, so these must be referenced as
 * literal `process.env.NEXT_PUBLIC_X` expressions — a dynamic lookup like
 * `process.env[name]` would come back undefined in the client bundle.
 *
 * Nothing secret belongs in this file. If you are tempted to add a key here,
 * the work you are doing belongs on the server.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `${name} is not set. Add it to .env.local and restart the dev server — ` +
        'NEXT_PUBLIC_* variables are inlined at build time, so a hot reload will not pick it up.',
    );
  }
  return value;
}

export const publicEnv = {
  siteUrl: required(
    'NEXT_PUBLIC_SITE_URL',
    process.env.NEXT_PUBLIC_SITE_URL,
  ).replace(/\/+$/, ''),

  supabaseUrl: required('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL),

  supabaseAnonKey: required(
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  ),

  /** Cashfree environment for Web Checkout ('SANDBOX' | 'PRODUCTION') */
  cashfreeMode: process.env.NEXT_PUBLIC_CASHFREE_MODE ?? 'SANDBOX',
} as const;
