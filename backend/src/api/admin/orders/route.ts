import { createHandler } from '@/lib/api/handler';
import { getOrders } from '@/lib/db/repository';
import { orderListQuerySchema } from '@/lib/validation/schemas';

export const GET = createHandler(
  {
    auth: 'admin',
    query: orderListQuerySchema,
  },
  async ({ query }) => {
    const { orders, total } = await getOrders({
      status: query?.status,
      query: query?.q,
      from: query?.from,
      to: query?.to,
      page: query?.page ?? 1,
      limit: query?.limit ?? 25,
    });

    return { orders, total };
  },
);
