/**
 * Server-side environment, validated once at module load.
 *
 * Importing this file from a Client Component is a bug — it would mean secrets
 * were about to be bundled into the browser. The guard below turns that bug
 * into a loud crash during development instead of a silent key leak in
 * production.
 *
 * Public values (anything a browser legitimately needs) live in `env.public.ts`.
 */

import { z } from 'zod';

if (typeof window !== 'undefined') {
  throw new Error(
    '@/lib/env was imported into browser code. Secrets must never cross that line — use @/lib/env.public instead.',
  );
}

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // --- Site ---------------------------------------------------------------
  NEXT_PUBLIC_SITE_URL: z
    .string()
    .url('NEXT_PUBLIC_SITE_URL must be an absolute URL, e.g. https://bookishbae.com')
    // A trailing slash here produces "//shop" links everywhere downstream.
    .transform((value) => value.replace(/\/+$/, '')),

  // --- Supabase -----------------------------------------------------------
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),

});

export type ServerEnv = z.infer<typeof schema>;

function load(): ServerEnv {
  // Vercel builds that have not yet had their env wired up still need to
  // produce a bundle, and `next build` imports server modules. This escape
  // hatch keeps CI unblocked without weakening runtime validation.
  if (process.env.SKIP_ENV_VALIDATION === 'true') {
    return schema.partial().parse(process.env) as ServerEnv;
  }

  const parsed = schema.safeParse(process.env);

  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  • ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');

    throw new Error(
      `Invalid or missing environment variables:\n${problems}\n\n` +
        'Copy .env.example to .env.local and fill it in. See docs/SETUP.md.',
    );
  }

  return parsed.data;
}

export const env: ServerEnv = load();

export const isProduction = env.NODE_ENV === 'production';
export const isDevelopment = env.NODE_ENV === 'development';
