import { badRequest } from '@/lib/api/errors';
import { createHandler } from '@/lib/api/handler';
import { updateDownloadOverride } from '@/lib/db/repository';
import { downloadOverrideSchema } from '@/lib/validation/schemas';

export const PATCH = createHandler(
  {
    auth: 'admin',
    body: downloadOverrideSchema,
    rateLimit: { name: 'adminWrite', by: 'user' },
  },
  async ({ body, log }) => {
    const success = await updateDownloadOverride(body.orderItemId, body.downloadLimitOverride);
    if (!success) {
      throw badRequest('Could not update download limit override.');
    }

    log.info('Updated download limit override', {
      orderItemId: body.orderItemId,
      override: body.downloadLimitOverride,
    });

    return { ok: true, orderItemId: body.orderItemId, override: body.downloadLimitOverride };
  },
);
