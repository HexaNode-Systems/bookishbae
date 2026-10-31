import { badRequest, notFound } from '@/lib/api/errors';
import { createHandler } from '@/lib/api/handler';
import { getProductByIdOrSlug } from '@/lib/db/repository';

export const GET = createHandler(
  {
    auth: 'public',
  },
  async ({ params }) => {
    const slug = params?.slug;
    if (!slug) throw badRequest('Book slug is required.');

    const product = await getProductByIdOrSlug(slug, true);
    if (!product || product.status !== 'published') {
      throw notFound('Book not found.');
    }

    return { product };
  },
);
