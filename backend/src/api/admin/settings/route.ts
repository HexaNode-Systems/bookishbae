import { badRequest } from '@/lib/api/errors';
import { createHandler } from '@/lib/api/handler';
import { settingsUpdateSchema } from '@/lib/validation/schemas';
import { db } from '@/lib/db/postgres';
export const GET = createHandler({ auth: 'admin' }, async () => ({
  settings: await db.query("SELECT key,value,is_public,updated_at FROM public.site_settings WHERE key<>'admin_bootstrap_emails'"),
}));
export const PATCH = createHandler({ auth: 'admin', body: settingsUpdateSchema, rateLimit: { name: 'adminWrite', by: 'user' } }, async ({ body }) => {
  if (body.key === 'admin_bootstrap_emails')
    throw badRequest('That setting is not editable here.');
  const [setting] = await db.query(`INSERT INTO public.site_settings(key,value) VALUES($1,$2::jsonb) ON CONFLICT(key) DO UPDATE SET value=excluded.value RETURNING key,value,is_public,updated_at`, [body.key, JSON.stringify(body.value)]);
  return { ok: true, setting };
});
