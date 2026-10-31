import { createHandler } from '@/lib/api/handler';
import { getDashboardStats } from '@/lib/db/repository';

export const GET = createHandler(
  {
    auth: 'admin',
  },
  async () => {
    const stats = await getDashboardStats();
    return stats;
  },
);
