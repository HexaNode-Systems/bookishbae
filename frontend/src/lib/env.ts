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

/** Comma-separated list -> trimmed, lowercased, de-duplicated array. */
const csvLower = z
  .string()
  .optional()
  .transform((value) =>
    Array.from(
      new Set(
        (value ?? '')
          .split(',')
          .map((part) => part.trim().toLowerCase())
          .filter(Boolean),
      ),
    ),
  );

/** "true"/"1"/"yes" -> true, with a default. */
const boolish = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined || value.trim() === '') return fallback;
      return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
    });

const intIn = (min: number, max: number, fallback: number) =>
  z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined || value.trim() === '') return fallback;
      const n = Number.parseInt(value, 10);
      return Number.isFinite(n) ? n : fallback;
    })
    .pipe(z.number().int().min(min).max(max));

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
  /**
   * Bypasses every RLS policy in the database. It must only ever be read in
   * route handlers, server actions and scripts. If this value ever appears in
   * a client bundle, rotate it immediately.
   */
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),

  // --- Cloudinary ---------------------------------------------------------
  CLOUDINARY_CLOUD_NAME: z.string().min(1),
  CLOUDINARY_API_KEY: z.string().min(1),
  CLOUDINARY_API_SECRET: z.string().min(1),

  // Cashfree credentials and mode belong to the standalone backend only.

  // --- Brevo --------------------------------------------------------------
  BREVO_API_KEY: z.string().min(1),
  /** Must be a verified sender email in Brevo. */
  EMAIL_FROM: z.string().min(3),
  EMAIL_REPLY_TO: z.string().email().optional(),

  // --- Operational knobs --------------------------------------------------
  /** Emails that become admin on first sign-in. Also settable in site_settings. */
  ADMIN_BOOTSTRAP_EMAILS: csvLower,
  /**
   * Lifetime of a presigned download URL. Short on purpose: long enough to
   * survive a slow mobile connection, short enough that a leaked link is dead
   * before it can be shared.
   */
  DOWNLOAD_URL_TTL_SECONDS: intIn(30, 300, 90),
  /** Lifetime of a presigned admin upload URL. */
  UPLOAD_URL_TTL_SECONDS: intIn(60, 3600, 600),
  /** Default downloads allowed per purchase. Per-product and per-order overrides exist. */
  DOWNLOAD_LIMIT_DEFAULT: intIn(1, 100, 5),
  /**
   * Hard ceiling on watermarking. Above this we stream the original rather
   * than load the file into a serverless function's heap. See
   * docs/DECISIONS.md #2.
   */
  WATERMARK_MAX_BYTES: intIn(1_048_576, 41_943_040, 20_971_520),
  RATE_LIMIT_ENABLED: boolish(true),
  /**
   * Salt for hashing client IPs in audit logs. Any long random string.
   * Changing it makes old rows uncomparable with new ones.
   */
  IP_HASH_SALT: z.string().min(16, 'IP_HASH_SALT should be at least 16 characters of randomness'),
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
