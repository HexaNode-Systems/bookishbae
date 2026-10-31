import { badRequest, notFound } from '@/lib/api/errors';
import { createHandler } from '@/lib/api/handler';
import { getOrderById } from '@/lib/db/repository';

export const GET = createHandler(
  {
    auth: 'admin',
  },
  async ({ params }) => {
    const id = params?.id;
    if (!id) throw badRequest('Order ID is required.');

    const order = await getOrderById(id);
    if (!order) throw notFound('Order not found.');

    return { order };
  },
);
