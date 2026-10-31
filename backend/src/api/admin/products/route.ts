import { getCategories } from '@/lib/author-commerce';
import { createHandler } from '@/lib/api/handler';
import { badRequest, notFound } from '@/lib/api/errors';
import { createProduct, getProducts } from '@/lib/db/repository';
import { productCreateSchema } from '@/lib/validation/schemas';
import { z } from 'zod';

const adminProductsQuerySchema = z.object({
  status: z.enum(['draft', 'published', 'archived', 'all']).optional(),
  q: z.string().trim().max(100).optional(),
  page: z.string().optional().transform((v) => (v ? Number.parseInt(v, 10) : 1)),
  limit: z.string().optional().transform((v) => (v ? Number.parseInt(v, 10) : 50)),
});

export const GET = createHandler(
  {
    auth: 'admin',
    query: adminProductsQuerySchema,
  },
  async ({ query }) => {
    const { products, total } = await getProducts({
      status: query?.status ?? 'all',
      query: query?.q,
      page: query?.page ?? 1,
      limit: query?.limit ?? 50,
      publicView: false,
    });

    return { products, total };
  },
);

export const POST = createHandler(
  {
    auth: 'admin',
    body: productCreateSchema,
    rateLimit: { name: 'adminWrite', by: 'user' },
  },
  async ({ body, log }) => {
    if (body.categoryId && !(await getCategories()).some(category => category.id === body.categoryId)) throw badRequest('The selected category no longer exists.');
    const created = await createProduct({
      slug: body.slug,
      title: body.title,
      subtitle: body.subtitle ?? null,
      excerpt: body.excerpt ?? null,
      description: body.description,
      author_name: body.authorName,
      category_id: body.categoryId ?? null,
      sample_preview: body.samplePreview,
      price_paise: body.pricePaise,
      discount_price_paise: body.discountPricePaise ?? null,
      currency: 'INR',
      cover_key: body.coverKey ?? null,
      cover_width: body.coverWidth ?? null,
      cover_height: body.coverHeight ?? null,
      cover_alt: body.coverAlt ?? null,
      sample_pdf_key: body.samplePdfKey ?? null,
      main_pdf_key: body.mainPdfKey ?? null,
      main_pdf_bytes: body.mainPdfBytes ?? null,
      page_count: body.pageCount ?? null,
      language: body.language,
      isbn: body.isbn ?? null,
      status: body.status,
      is_featured: body.isFeatured,
      watermark_enabled: body.watermarkEnabled,
      download_limit: body.downloadLimit,
      meta_title: body.metaTitle ?? null,
      meta_description: body.metaDescription ?? null,
    });

    log.info('Product created', { id: created.id, slug: created.slug });
    return { ok: true, product: created };
  },
);
