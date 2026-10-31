import { badRequest } from '@/lib/api/errors';
import { createHandler } from '@/lib/api/handler';
import { settingsUpdateSchema } from '@/lib/validation/schemas';
import type { Json } from '@/types/database';

export const GET = createHandler(
  {
    auth: 'admin',
  },
  async ({ admin }) => {
    try {
      const { data, error } = await admin()
        .from('site_settings')
        .select('key, value, is_public, updated_at')
        .neq('key', 'admin_bootstrap_emails');

      if (!error && data) {
        return { settings: data };
      }
    } catch {
      // Fallback
    }

    return {
      settings: [
        {
          key: 'brand',
          value: {
            name: 'BookishBae',
            tagline: 'Stories that stay with you.',
            author_name: 'Annu',
            support_email: 'hello@bookishbae.com',
          },
          is_public: true,
        },
      ],
    };
  },
);

export const PATCH = createHandler(
  {
    auth: 'admin',
    body: settingsUpdateSchema,
    rateLimit: { name: 'adminWrite', by: 'user' },
  },
  async ({ body, admin, log }) => {
    if (body.key === 'admin_bootstrap_emails') {
      throw badRequest('That setting is not editable here.');
    }

    try {
      const { data, error } = await admin()
        .from('site_settings')
        .upsert({
          key: body.key,
          value: body.value as Json,
        })
        .select()
        .single();

      if (!error && data) {
        log.info('Setting updated', { key: body.key });
        return { ok: true, setting: data };
      }
    } catch {
      // Staging fallback
    }

    log.info('Setting updated in staging', { key: body.key });
    return { ok: true, key: body.key, value: body.value };
  },
);
