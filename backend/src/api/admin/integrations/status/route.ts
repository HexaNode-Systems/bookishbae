import { createHandler } from '@/lib/api/handler';
import { getIntegrationsStatus } from '@/lib/db/repository';

export const GET = createHandler(
  {
    auth: 'admin',
  },
  async ({ log }) => {
    log.info('Checking integration status');
    const status = getIntegrationsStatus();
    // Guarantee: No secrets or credentials are ever returned
    return { integrations: status };
  },
);
