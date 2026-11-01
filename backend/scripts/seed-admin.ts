import { createClient } from '@supabase/supabase-js';
import { seedAdmin, type AdminSeedStage } from '../src/lib/db/seed-admin';
import { closeDatabase, poolConfig } from '../src/lib/db/postgres';

type SeedStage = AdminSeedStage | 'configuration';

/** Only allowlisted error fields reach output; never serialize errors, headers or stacks. */
export function logSeedFailure(stage: SeedStage, error: unknown, source: NodeJS.ProcessEnv = process.env) {
  const secrets = new Set<string>();
  for (const name of ['DATABASE_URL', 'DATABASE_PASSWORD', 'PGPASSWORD', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'ADMIN_BOOTSTRAP_PASSWORD']) {
    if (source[name]) secrets.add(source[name]);
  }
  try {
    const password = new URL(source.DATABASE_URL || '').password;
    if (password) {
      secrets.add(password);
      secrets.add(decodeURIComponent(password));
    }
  } catch { /* A malformed connection string is still redacted as an exact secret. */ }
  // SDKs and connection errors can echo URL-encoded or JSON-escaped inputs.
  for (const value of [...secrets]) {
    secrets.add(encodeURIComponent(value));
    secrets.add(JSON.stringify(value).slice(1, -1));
  }
  const sensitiveValues = [...secrets].filter(Boolean).sort((a, b) => b.length - a.length);
  const redact = (value: string) => {
    for (const secret of sensitiveValues) value = value.split(secret).join('[redacted]');
    return value
      .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[redacted-database-url]')
      .replace(/(["']?authorization["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\r\n,;}]+)/gi, '$1[redacted]')
      .replace(/\b(?:Bearer|Basic)\s+[^\s"',;}]+/gi, '[redacted-authorization]');
  };
  let detail = error;
  // Auth failures retain their original SDK error as a cause. Bound traversal
  // also handles nested network errors without risking cyclic error objects.
  for (let depth = 0; depth < 4 && detail instanceof Error && detail.cause; depth++) detail = detail.cause;
  const fields = detail && typeof detail === 'object' ? detail as { code?: unknown; status?: unknown; message?: unknown } : {};
  const message = typeof fields.message === 'string' ? fields.message : typeof detail === 'string' ? detail : 'No additional error details available.';
  console.error('Admin seed failed:', JSON.stringify({
    stage,
    ...(typeof fields.code === 'string' ? { code: redact(fields.code).slice(0, 120) } : {}),
    ...(typeof fields.status === 'number' && Number.isInteger(fields.status) && fields.status >= 100 && fields.status <= 599 ? { status: fields.status } : {}),
    message: redact(message).slice(0, 2000),
  }));
}

async function main(onFailure: (stage: AdminSeedStage, error: unknown) => void, setStage: (stage: SeedStage) => void) {
  setStage('database connection');
  poolConfig(); // Validate URL/TLS without printing credentials.
  setStage('configuration');
  const email = process.env.ADMIN_BOOTSTRAP_EMAIL;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!email || !url || !key)
    throw new Error('Set ADMIN_BOOTSTRAP_EMAIL, NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the backend.');
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const result = await seedAdmin(client.auth.admin, { email, password: process.env.ADMIN_BOOTSTRAP_PASSWORD || undefined, resetPassword: process.env.ADMIN_BOOTSTRAP_RESET_PASSWORD === 'true' }, onFailure);
  console.log(result.existed ? `Admin configured. Existing password ${result.passwordChanged ? 'explicitly reset' : 'preserved'}.` : 'Admin created and email confirmed. Sign in with the configured email and password.');
}
export async function runSeedAdmin() {
  let stage: SeedStage = 'configuration';
  let originalError: unknown;
  try {
    await main((failedStage, error) => { stage = failedStage; originalError = error; }, current => { stage = current; });
  } catch (error) {
    logSeedFailure(stage, originalError ?? error);
    process.exitCode = 1;
  } finally {
    try { await closeDatabase(); } catch (error) {
      logSeedFailure('database connection', error);
      process.exitCode = 1;
    }
  }
}

if (require.main === module) void runSeedAdmin();
