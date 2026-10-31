import { createHandler } from '@/lib/api/handler';
import { getProducts } from '@/lib/db/repository';
import { shopQuerySchema } from '@/lib/validation/schemas';

export const GET = createHandler(
  {
    auth: 'public',
    query: shopQuerySchema,
  },
  async ({ query }) => {
    const { products, total } = await getProducts({
      category: query?.category,
      query: query?.q,
      sort: query?.sort,
      page: query?.page ?? 1,
      limit: query?.limit ?? 20,
      publicView: true, // Never exposes main_pdf_key
    });

    return { products, total };
  },
);
