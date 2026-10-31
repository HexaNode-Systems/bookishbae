import { getCategories } from '@/lib/author-commerce';
import { badRequest, notFound } from '@/lib/api/errors';
import { createHandler } from '@/lib/api/handler';
import { deleteProduct, getProductByIdOrSlug, updateProduct } from '@/lib/db/repository';
import { productUpdateSchema } from '@/lib/validation/schemas';

export const GET = createHandler(
  {
    auth: 'admin',
  },
  async ({ params }) => {
    const id = params?.id;
    if (!id) throw badRequest('Product ID is required.');

    const product = await getProductByIdOrSlug(id, false);
    if (!product) throw notFound('Product not found.');

    return { product };
  },
);

export const PATCH = createHandler(
  {
    auth: 'admin',
    body: productUpdateSchema,
    rateLimit: { name: 'adminWrite', by: 'user' },
  },
  async ({ params, body, log }) => {
    const id = params?.id;
    if (!id) throw badRequest('Product ID is required.');

    const existing = await getProductByIdOrSlug(id, false);
    if (!existing) throw notFound('Product not found.');

    const sampleKey = body.samplePdfKey === undefined ? existing.sample_pdf_key : body.samplePdfKey;
    const mainKey = body.mainPdfKey === undefined ? existing.main_pdf_key : body.mainPdfKey;
    if (sampleKey && sampleKey === mainKey) throw badRequest('The free sample must be a separate PDF from the full e-book.');

    if (body.categoryId && !(await getCategories()).some(category => category.id === body.categoryId)) throw badRequest('The selected category no longer exists.');
    const updated = await updateProduct(existing.id, {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.slug !== undefined ? { slug: body.slug } : {}),
      ...(body.subtitle !== undefined ? { subtitle: body.subtitle } : {}),
      ...(body.excerpt !== undefined ? { excerpt: body.excerpt } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.authorName !== undefined ? { author_name: body.authorName } : {}),
      ...(body.categoryId !== undefined ? { category_id: body.categoryId } : {}),
      ...(body.samplePreview !== undefined ? { sample_preview: body.samplePreview } : {}),
      ...(body.pricePaise !== undefined ? { price_paise: body.pricePaise } : {}),
      ...(body.discountPricePaise !== undefined ? { discount_price_paise: body.discountPricePaise } : {}),
      ...(body.coverKey !== undefined ? { cover_key: body.coverKey } : {}),
      ...(body.coverWidth !== undefined ? { cover_width: body.coverWidth } : {}),
      ...(body.coverHeight !== undefined ? { cover_height: body.coverHeight } : {}),
      ...(body.coverAlt !== undefined ? { cover_alt: body.coverAlt } : {}),
      ...(body.samplePdfKey !== undefined ? { sample_pdf_key: body.samplePdfKey } : {}),
      ...(body.mainPdfKey !== undefined ? { main_pdf_key: body.mainPdfKey } : {}),
      ...(body.mainPdfBytes !== undefined ? { main_pdf_bytes: body.mainPdfBytes } : {}),
      ...(body.pageCount !== undefined ? { page_count: body.pageCount } : {}),
      ...(body.language !== undefined ? { language: body.language } : {}),
      ...(body.isbn !== undefined ? { isbn: body.isbn } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.isFeatured !== undefined ? { is_featured: body.isFeatured } : {}),
      ...(body.watermarkEnabled !== undefined ? { watermark_enabled: body.watermarkEnabled } : {}),
      ...(body.downloadLimit !== undefined ? { download_limit: body.downloadLimit } : {}),
      ...(body.metaTitle !== undefined ? { meta_title: body.metaTitle } : {}),
      ...(body.metaDescription !== undefined ? { meta_description: body.metaDescription } : {}),
    });

    log.info('Product updated', { id: existing.id, updates: Object.keys(body) });
    return { ok: true, product: updated };
  },
);

export const DELETE = createHandler(
  {
    auth: 'admin',
    rateLimit: { name: 'adminWrite', by: 'user' },
  },
  async ({ params, log }) => {
    const id = params?.id;
    if (!id) throw badRequest('Product ID is required.');

    const existing = await getProductByIdOrSlug(id, false);
    if (!existing) throw notFound('Product not found.');

    const result = await deleteProduct(existing.id);
    if (!result.success) {
      throw badRequest(result.error ?? 'Cannot delete product.');
    }

    log.info('Product deleted', { id: existing.id });
    return { ok: true, deletedId: existing.id };
  },
);
