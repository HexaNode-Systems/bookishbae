/**
 * Unified data access repository for BookishBae.
 *
 * Implements the exact Postgres schema defined in `supabase/migrations/*.sql`
 * and `src/types/database.ts`.
 *
 * Interacts with Supabase tables and RPC functions first. When Supabase tables
 * are not yet migrated or running in local/test staging, gracefully falls back
 * to safe, deterministic staging data so that storefront and admin operations
 * never crash.
 */

import { randomUUID } from 'node:crypto';
import { ApiError } from '@/lib/api/errors';
import { getCategories, databaseError } from '@/lib/author-commerce';
import { withProductAssets } from '@/lib/product-assets';
import { claimOrderDownload, releaseDatabaseDownload, type DownloadClaim } from '@/lib/download-entitlement';

import { BOOKS } from '@/lib/books';
import { createCashfreeOrder, fetchCashfreeOrder, refundCashfreePayment } from '@/lib/cashfree';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { createAdminClient } from '@/lib/supabase/admin';
import type {
  DownloadKind,
  Json,
  Order,
  OrderItem,
  OrderStatus,
  Payment,
  PaymentStatus,
  Product,
  ProductStatus,
} from '@/types/database';

export interface StagingProduct extends Product {
  cover_url?: string;
  sample_pdf_url?: string;
  category?: string | null;
  category_slug?: string | null;
}

async function hydrateCategories<T extends { category_id?: string | null }>(products: T[]) {
  if (!products.some(p => p.category_id)) return products.map(p => ({ ...p, category: '', category_slug: null }));
  const categories = await getCategories();
  return products.map(p => { const category = categories.find(c => c.id === p.category_id); return { ...p, category: category?.name ?? '', category_slug: category?.slug ?? null }; });
}

// Deterministic UUIDs for the 3 foundation books
export const SEED_BOOK_IDS: Record<string, string> = {
  'the-long-afternoon': '11111111-1111-4111-a111-111111111111',
  'letters-i-never-sent': '22222222-2222-4222-a222-222222222222',
  'everything-we-didnt-say': '33333333-3333-4333-a333-333333333333',
};

// In-memory staging store initialized from BOOKS
const stagingProducts = new Map<string, StagingProduct>();
const stagingOrders = new Map<string, Order>();
const stagingOrderItems = new Map<string, OrderItem[]>();
const stagingPayments = new Map<string, Payment[]>();
const stagingWebhookEvents = new Map<
  string,
  { eventId: string; provider: string; processedAt: string | null }
>();
const stagingDownloads = new Map<string, unknown[]>();

function initStagingProducts() {
  if (stagingProducts.size > 0) return;

  for (const b of BOOKS) {
    const id = SEED_BOOK_IDS[b.slug] || randomUUID();
    stagingProducts.set(id, {
      id,
      slug: b.slug,
      title: b.title,
      subtitle: b.subtitle,
      description: b.description,
      excerpt: b.excerpt,
      author_name: 'Annu',
      category_id: null,
      sample_preview: [],
      category: b.category,
      category_slug: b.categorySlug,
      price_paise: b.pricePaise,
      discount_price_paise: b.originalPriceRupees ? b.pricePaise : null,
      currency: 'INR',
      cover_key: `covers/${b.slug}-cover.png`,
      cover_url: b.coverImage,
      cover_width: 1200,
      cover_height: 1800,
      cover_alt: `${b.title} by Annu cover`,
      sample_pdf_key: `samples/${b.slug}-sample.pdf`,
      sample_pdf_url: b.samplePdfUrl,
      main_pdf_key: `books/${b.slug}.pdf`,
      main_pdf_bytes: 1024 * 1024 * 2,
      main_pdf_sha256: null,
      page_count: b.pageCount,
      language: 'en',
      isbn: null,
      status: 'published',
      is_featured: b.isFeatured ?? false,
      watermark_enabled: false,
      download_limit: 5,
      meta_title: `${b.title} by Annu`,
      meta_description: b.excerpt,
      published_at: '2026-09-01T00:00:00Z',
      sales_count: b.reviewCount * 4,
      rating_count: b.reviewCount,
      rating_avg: b.rating,
      created_at: '2026-09-01T00:00:00Z',
      updated_at: '2026-09-01T00:00:00Z',
    });
  }
}

initStagingProducts();

/** The in-memory catalogue/order maps are fixtures for local work and tests.
 * Falling back to them in production can lose orders or grant access against
 * state that disappears on restart, so fail closed instead. */
function assertStagingFallbackAllowed(operation: string): void {
  if (env.NODE_ENV !== 'test') {
    throw new Error(`Production database operation failed (${operation}); staging fallback is disabled.`);
  }
}

function assertProductWriteFallbackAllowed(): void {
  if (env.NODE_ENV !== 'test') {
    throw new ApiError('upstream_error', 'The book could not be saved to the database. Check the database connection and apply the catalogue migrations, then retry.');
  }
}

// ---------------------------------------------------------------------------
// Product Catalogue Operations
// ---------------------------------------------------------------------------

export async function getProducts(
  options: {
    status?: ProductStatus | 'all';
    category?: string;
    query?: string;
    sort?: string;
    page?: number;
    limit?: number;
    publicView?: boolean;
  } = {},
): Promise<{ products: Partial<StagingProduct>[]; total: number }> {
  const page = Math.max(1, options.page ?? 1);
  const limit = Math.min(100, Math.max(1, options.limit ?? 20));

  try {
    const admin = createAdminClient();
    let query = admin.from('products').select('*', { count: 'exact' });

    if (options.status && options.status !== 'all') {
      query = query.eq('status', options.status);
    } else if (options.publicView) {
      query = query.eq('status', 'published');
    }

    if (options.category && options.category !== 'all') {
      const categories = await getCategories();
      const selected = categories.find(c => c.slug === options.category || c.id === options.category);
      if (!selected) return { products: [], total: 0 };
      query = query.eq('category_id', selected.id);
    }
    if (options.query) {
      query = query.ilike('title', `%${options.query}%`);
    }

    const from = (page - 1) * limit;
    const to = from + limit - 1;
    query = query.range(from, to).order('created_at', { ascending: false });

    const { data, count, error } = await query;
    if (!error && data) {
      const hydrated = await hydrateCategories(data);
      const sanitized = hydrated.map((p) => {
        if (options.publicView) {
          const { main_pdf_key: _, ...safe } = p;
          return withProductAssets(safe);
        }
        return withProductAssets(p);
      });
      return { products: sanitized as Partial<StagingProduct>[], total: count ?? data.length };
    }
  } catch (err) {
    logger.warn('Supabase products fetch failed, using staging data', { err });
  }

  assertStagingFallbackAllowed('read products');
  // Staging fallback
  initStagingProducts();
  let list = Array.from(stagingProducts.values());

  if (options.status && options.status !== 'all') {
    list = list.filter((p) => p.status === options.status);
  } else if (options.publicView) {
    list = list.filter((p) => p.status === 'published');
  }

  if (options.category && options.category !== 'all') {
    list = list.filter((p) => p.category_slug === options.category);
  }

  if (options.query) {
    const q = options.query.toLowerCase();
    list = list.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.slug.toLowerCase().includes(q) ||
        (p.category && p.category.toLowerCase().includes(q)),
    );
  }

  if (options.sort === 'bestselling') {
    list.sort((a, b) => (b.sales_count ?? 0) - (a.sales_count ?? 0));
  } else if (options.sort === 'price-asc') {
    list.sort((a, b) => a.price_paise - b.price_paise);
  } else if (options.sort === 'price-desc') {
    list.sort((a, b) => b.price_paise - a.price_paise);
  } else if (options.sort === 'rating') {
    list.sort((a, b) => (b.rating_avg ?? 0) - (a.rating_avg ?? 0));
  } else {
    list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }

  const total = list.length;
  const paged = list.slice((page - 1) * limit, page * limit).map((p) => {
    if (options.publicView) {
      const { main_pdf_key: _, ...safe } = p;
      return withProductAssets(safe);
    }
    return withProductAssets(p);
  });

  return { products: paged, total };
}

export async function getProductByIdOrSlug(
  idOrSlug: string,
  publicView: boolean = false,
  requirePersisted: boolean = false,
): Promise<StagingProduct | null> {
  try {
    const admin = createAdminClient();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
    const query = admin
      .from('products')
      .select('*')
      .eq(isUuid ? 'id' : 'slug', idOrSlug)
      .single();

    const { data, error } = await query;
    if (error?.code === 'PGRST116') return null;
    if (!error && data) {
      const [hydrated] = await hydrateCategories([data]);
      Object.assign(data, hydrated);
      if (publicView) {
        const { main_pdf_key: _, ...safe } = data;
        return withProductAssets(safe) as StagingProduct;
      }
      return withProductAssets((await hydrateCategories([data]))[0]!) as StagingProduct;
    }
  } catch (err) {
    logger.warn('Supabase getProductByIdOrSlug failed, checking staging store', { idOrSlug });
  }

  if (requirePersisted && env.NODE_ENV !== 'test') {
    throw new ApiError('upstream_error', 'Checkout is temporarily unavailable. Please try again shortly.');
  }
  assertStagingFallbackAllowed('read product');
  initStagingProducts();
  for (const p of stagingProducts.values()) {
    if (p.id === idOrSlug || p.slug === idOrSlug) {
      if (publicView) {
        const { main_pdf_key: _, ...safe } = p;
        return withProductAssets(safe) as StagingProduct;
      }
      return withProductAssets(p);
    }
  }

  return null;
}

export async function createProduct(input: Partial<StagingProduct>): Promise<StagingProduct> {
  const id = randomUUID();
  const now = new Date().toISOString();
  const categorySlug = input.category_slug ?? null;
  const category = input.category ?? null;
  const product: StagingProduct = {
    id,
    slug: input.slug ?? `book-${Date.now()}`,
    title: input.title ?? 'Untitled Book',
    subtitle: input.subtitle ?? null,
    excerpt: input.excerpt ?? null,
    description: input.description ?? '',
    author_name: input.author_name ?? 'Annu',
    category_id: input.category_id ?? null,
    sample_preview: input.sample_preview ?? [],
    category,
    category_slug: categorySlug,
    price_paise: input.price_paise ?? 29900,
    discount_price_paise: input.discount_price_paise ?? null,
    currency: 'INR',
    cover_key: input.cover_key ?? null,
    cover_width: input.cover_width ?? 1200,
    cover_height: input.cover_height ?? 1800,
    cover_alt: input.cover_alt ?? `${input.title} cover`,
    sample_pdf_key: input.sample_pdf_key ?? null,
    main_pdf_key: input.main_pdf_key ?? null,
    main_pdf_bytes: input.main_pdf_bytes ?? null,
    main_pdf_sha256: null,
    page_count: input.page_count ?? 100,
    language: input.language ?? 'en',
    isbn: input.isbn ?? null,
    status: input.status ?? 'draft',
    is_featured: input.is_featured ?? false,
    watermark_enabled: input.watermark_enabled ?? false,
    download_limit: input.download_limit ?? 5,
    meta_title: input.meta_title ?? `${input.title} by Annu`,
    meta_description: input.meta_description ?? input.excerpt ?? null,
    published_at: input.status === 'published' ? now : null,
    sales_count: 0,
    rating_count: 0,
    rating_avg: null,
    created_at: now,
    updated_at: now,
  };

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('products')
      .insert({
        id: product.id,
        slug: product.slug,
        title: product.title,
        subtitle: product.subtitle,
        description: product.description,
        excerpt: product.excerpt,
        author_name: product.author_name,
        category_id: product.category_id,
        sample_preview: product.sample_preview,
        price_paise: product.price_paise,
        discount_price_paise: product.discount_price_paise,
        currency: product.currency,
        cover_key: product.cover_key,
        cover_width: product.cover_width,
        cover_height: product.cover_height,
        cover_alt: product.cover_alt,
        sample_pdf_key: product.sample_pdf_key,
        main_pdf_key: product.main_pdf_key,
        main_pdf_bytes: product.main_pdf_bytes,
        page_count: product.page_count,
        language: product.language,
        isbn: product.isbn,
        status: product.status,
        is_featured: product.is_featured,
        watermark_enabled: product.watermark_enabled,
        download_limit: product.download_limit,
        meta_title: product.meta_title,
        meta_description: product.meta_description,
        published_at: product.published_at,
      })
      .select()
      .single();

    if (!error && data) {
      stagingProducts.set(data.id, data as StagingProduct);
      return withProductAssets(data) as StagingProduct;
    }
    throw error || new Error('Database did not return the saved product.');
  } catch (err) {
    logger.error('Supabase product insert failed', { err });
  }

  assertProductWriteFallbackAllowed();
  stagingProducts.set(id, product);
  return withProductAssets(product);
}

export async function updateProduct(
  id: string,
  input: Partial<Product>,
): Promise<StagingProduct | null> {
  const now = new Date().toISOString();

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('products')
      .update({
        ...(input.slug !== undefined ? { slug: input.slug } : {}),
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.subtitle !== undefined ? { subtitle: input.subtitle } : {}),
        ...(input.excerpt !== undefined ? { excerpt: input.excerpt } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.author_name !== undefined ? { author_name: input.author_name } : {}),
        ...(input.category_id !== undefined ? { category_id: input.category_id } : {}),
        ...(input.sample_preview !== undefined ? { sample_preview: input.sample_preview } : {}),
        ...(input.price_paise !== undefined ? { price_paise: input.price_paise } : {}),
        ...(input.discount_price_paise !== undefined
          ? { discount_price_paise: input.discount_price_paise }
          : {}),
        ...(input.cover_key !== undefined ? { cover_key: input.cover_key } : {}),
        ...(input.cover_width !== undefined ? { cover_width: input.cover_width } : {}),
        ...(input.cover_height !== undefined ? { cover_height: input.cover_height } : {}),
        ...(input.cover_alt !== undefined ? { cover_alt: input.cover_alt } : {}),
        ...(input.sample_pdf_key !== undefined ? { sample_pdf_key: input.sample_pdf_key } : {}),
        ...(input.main_pdf_key !== undefined ? { main_pdf_key: input.main_pdf_key } : {}),
        ...(input.main_pdf_bytes !== undefined ? { main_pdf_bytes: input.main_pdf_bytes } : {}),
        ...(input.page_count !== undefined ? { page_count: input.page_count } : {}),
        ...(input.language !== undefined ? { language: input.language } : {}),
        ...(input.isbn !== undefined ? { isbn: input.isbn } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.is_featured !== undefined ? { is_featured: input.is_featured } : {}),
        ...(input.watermark_enabled !== undefined
          ? { watermark_enabled: input.watermark_enabled }
          : {}),
        ...(input.download_limit !== undefined ? { download_limit: input.download_limit } : {}),
        ...(input.meta_title !== undefined ? { meta_title: input.meta_title } : {}),
        ...(input.meta_description !== undefined
          ? { meta_description: input.meta_description }
          : {}),
      })
      .eq('id', id)
      .select()
      .single();

    if (!error && data) {
      stagingProducts.set(id, data as StagingProduct);
      return withProductAssets(data) as StagingProduct;
    }
    throw error || new Error('Database did not return the saved product.');
  } catch (err) {
    logger.error('Supabase product update failed', { id, err });
  }

  assertProductWriteFallbackAllowed();
  initStagingProducts();
  const existing = stagingProducts.get(id);
  if (!existing) return null;

  const updated: StagingProduct = {
    ...existing,
    ...input,
    category_slug: (input as StagingProduct).category_slug ?? existing.category_slug,
    category: (input as StagingProduct).category ?? existing.category,
    published_at: input.status === 'published' ? (existing.published_at || now) : input.status === 'draft' || input.status === 'archived' ? null : existing.published_at,
    updated_at: now,
  };
  stagingProducts.set(id, updated);
  return withProductAssets(updated);
}

export async function deleteProduct(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    const admin = createAdminClient();
    // Check if product has sales
    const { count } = await admin
      .from('order_items')
      .select('*', { count: 'exact', head: true })
      .eq('product_id', id);

    if (count && count > 0) {
      return {
        success: false,
        error: 'Product cannot be deleted because orders exist for it. Archive it instead.',
      };
    }

    const { error } = await admin.from('products').delete().eq('id', id);
    if (!error) {
      stagingProducts.delete(id);
      return { success: true };
    }
  } catch (err) {
    logger.warn('Supabase deleteProduct failed, removing from staging store', { id });
  }

  assertProductWriteFallbackAllowed();
  initStagingProducts();
  if (stagingProducts.has(id)) {
    stagingProducts.delete(id);
    return { success: true };
  }

  return { success: false, error: 'Product not found' };
}

// ---------------------------------------------------------------------------
// Order & Payment Operations
// ---------------------------------------------------------------------------

export async function createOrder(params: {
  productId: string;
  email: string;
  fullName: string;
  phone?: string;
  couponCode?: string;
  marketingOptIn?: boolean;
  metadata?: Record<string, unknown>;
  ipHash?: string | null;
  userAgent?: string | null;
  userId?: string | null;
}): Promise<{
  order: Order;
  orderItem: OrderItem;
  paymentSessionId?: string;
  cfOrderId?: string;
}> {
  const product = await getProductByIdOrSlug(params.productId);
  if (!product) {
    throw new Error('Product not found.');
  }

  // Enforce server-side pricing! Never client-supplied.
  const unitPricePaise = product.discount_price_paise ?? product.price_paise;
  let discountPaise = 0;
  let couponId: string | null = null;

  if (params.couponCode) {
    const couponValidation = await validateCoupon(params.couponCode, product.id, params.email, params.userId ?? undefined);
    if (!couponValidation.valid) throw new ApiError('bad_request', couponValidation.message || 'This coupon cannot be applied.');
    if (couponValidation.valid && couponValidation.discountPaise != null) {
      discountPaise = couponValidation.discountPaise;
      couponId = couponValidation.couponId ?? null;
    }
  }

  const subtotalPaise = unitPricePaise;
  const totalPaise = Math.max(0, subtotalPaise - discountPaise);
  let orderId: string = randomUUID();
  let orderItemId: string = randomUUID();
  const now = new Date().toISOString();
  let orderNumber = `BB-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`;

  let orderRecord: Order = {
    id: orderId,
    order_number: orderNumber,
    user_id: params.userId ?? null,
    email: params.email.trim().toLowerCase(),
    full_name: params.fullName.trim(),
    status: 'pending',
    currency: 'INR',
    subtotal_paise: subtotalPaise,
    discount_paise: discountPaise,
    total_paise: totalPaise,
    coupon_id: couponId,
    coupon_code: params.couponCode ?? null,
    razorpay_order_id: null,
    ip_hash: params.ipHash ?? null,
    user_agent: params.userAgent ?? null,
    metadata: (params.metadata as Json) ?? {},
    paid_at: null,
    failed_at: null,
    refunded_at: null,
    created_at: now,
    updated_at: now,
  };

  let orderItemRecord: OrderItem = {
    id: orderItemId,
    order_id: orderId,
    product_id: product.id,
    title_snapshot: product.title,
    slug_snapshot: product.slug,
    unit_price_paise: unitPricePaise,
    quantity: 1,
    total_paise: totalPaise,
    download_limit: product.download_limit ?? 5,
    download_limit_override: null,
    downloads_used: 0,
    last_downloaded_at: null,
    created_at: now,
  };

  // Price, coupon eligibility/reservation, order and item are one DB transaction.
  const admin = createAdminClient();
  const persisted = await admin.rpc('create_checkout_order', {
    p_product_id: product.id, p_email: params.email, p_full_name: params.fullName,
    p_coupon_code: params.couponCode ?? null, p_user_id: params.userId ?? null,
    p_metadata: (params.metadata as Json) ?? {}, p_ip_hash: params.ipHash ?? null, p_user_agent: params.userAgent ?? null,
  });
  if (persisted.error || !persisted.data) {
    if (env.NODE_ENV !== 'test') databaseError(persisted.error);
  } else {
    const result = persisted.data as unknown as { order: Order; orderItem: OrderItem };
    if (!result.order?.id || !result.orderItem?.id) throw new ApiError('upstream_error', 'The database did not confirm this order.');
    orderRecord = result.order; orderItemRecord = result.orderItem;
    orderId = orderRecord.id; orderItemId = orderItemRecord.id; orderNumber = orderRecord.order_number;
  }
  if (orderRecord.total_paise < 100) throw new ApiError('bad_request', 'Cashfree payments must total at least ?1. Adjust the coupon.');
  let paymentSessionId: string | undefined;
  let cfOrderId: string | undefined;
  try {
    const cfResult = await createCashfreeOrder({
      orderId: orderNumber,
      returnUrl: `${env.NEXT_PUBLIC_SITE_URL}/checkout/return?order_id={order_id}&book=${encodeURIComponent(product.slug)}`,
      amountPaise: orderRecord.total_paise,
      customer: { id: params.userId ?? `guest_${orderId.slice(0, 12)}`, email: params.email, name: params.fullName, phone: params.phone },
      note: `BookishBae: ${product.title}`, tags: { orderId, productId: product.id },
    });
    orderRecord.razorpay_order_id = cfResult.id;
    paymentSessionId = cfResult.paymentSessionId; cfOrderId = cfResult.cfOrderId;
    const update = await admin.from('orders').update({ razorpay_order_id: cfResult.id }).eq('id', orderId);
    if (update.error && env.NODE_ENV !== 'test') throw new ApiError('upstream_error', 'The payment session could not be saved. Please contact support before retrying.');
  } catch (gatewayError: any) {
    logger.error('Cashfree session creation failed', { orderId, status: gatewayError.response?.status, code: gatewayError.response?.data?.code, message: gatewayError.message });
    const failed = await admin.from('orders').update({ status: 'failed', failed_at: new Date().toISOString() }).eq('id', orderId);
    if (failed.error) logger.error('Could not persist failed checkout', { orderId, code: failed.error.code });
    if (gatewayError instanceof ApiError) throw gatewayError;
    const authError = gatewayError.response?.status === 401 || gatewayError.response?.status === 403;
    throw new ApiError('upstream_error', authError ? 'Cashfree rejected the configured credentials or website. The store administrator must check the selected payment environment and Cashfree domain configuration.' : 'Cashfree could not start payment. Please retry shortly.');
  }

  stagingOrders.set(orderId, orderRecord);
  stagingOrderItems.set(orderId, [orderItemRecord]);

  return {
    order: orderRecord,
    orderItem: orderItemRecord,
    paymentSessionId,
    cfOrderId,
  };
}

export async function getOrders(
  options: {
    status?: string;
    query?: string;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
  } = {},
): Promise<{ orders: Array<Order & { items: OrderItem[] }>; total: number }> {
  const page = Math.max(1, options.page ?? 1);
  const limit = Math.min(100, Math.max(1, options.limit ?? 25));

  try {
    const admin = createAdminClient();
    let query = admin.from('orders').select('*, items:order_items(*)', { count: 'exact' });

    if (options.status && options.status !== 'all') {
      query = query.eq('status', options.status as OrderStatus);
    }
    if (options.query) {
      query = query.or(
        `order_number.ilike.%${options.query}%,email.ilike.%${options.query}%,full_name.ilike.%${options.query}%`,
      );
    }
    if (options.from) query = query.gte('created_at', options.from);
    if (options.to) query = query.lte('created_at', options.to);

    const from = (page - 1) * limit;
    const to = from + limit - 1;
    query = query.range(from, to).order('created_at', { ascending: false });

    const { data, count, error } = await query;
    if (!error && data) {
      return {
        orders: data as unknown as Array<Order & { items: OrderItem[] }>,
        total: count ?? data.length,
      };
    }
  } catch (err) {
    logger.warn('Supabase getOrders failed, checking staging store', { err });
  }

  assertStagingFallbackAllowed('read orders');
  // Staging orders
  let list = Array.from(stagingOrders.values());
  if (options.status && options.status !== 'all') {
    list = list.filter((o) => o.status === options.status);
  }
  if (options.query) {
    const q = options.query.toLowerCase();
    list = list.filter(
      (o) =>
        o.order_number.toLowerCase().includes(q) ||
        o.email.toLowerCase().includes(q) ||
        (o.full_name && o.full_name.toLowerCase().includes(q)),
    );
  }

  list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const total = list.length;
  const paged = list.slice((page - 1) * limit, page * limit).map((order) => ({
    ...order,
    items: stagingOrderItems.get(order.id) ?? [],
  }));

  return { orders: paged, total };
}

export async function getOrderById(
  orderId: string,
): Promise<(Order & { items: OrderItem[] }) | null> {
  try {
    const admin = createAdminClient();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId);
    const { data, error } = await admin
      .from('orders')
      .select('*, items:order_items(*)')
      .eq(isUuid ? 'id' : 'order_number', orderId)
      .single();

    if (error?.code === 'PGRST116') return null;
    if (!error && data) return data as unknown as Order & { items: OrderItem[] };
  } catch (err) {
    logger.warn('Supabase getOrderById failed, checking staging store', { orderId });
  }

  assertStagingFallbackAllowed('read order');
  for (const o of stagingOrders.values()) {
    if (o.id === orderId || o.order_number === orderId || o.razorpay_order_id === orderId) {
      return {
        ...o,
        items: stagingOrderItems.get(o.id) ?? [],
      };
    }
  }

  return null;
}

export async function markOrderPaid(
  orderId: string,
  paymentDetails?: {
    paymentId: string;
    method?: string;
    amountPaise?: number;
    gatewaySnapshot?: Record<string, unknown>;
  },
): Promise<{ ok: boolean; order: Order | null; alreadyPaid?: boolean }> {
  const now = new Date().toISOString();

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc('mark_order_paid', {
      p_order_id: orderId,
      p_paid_at: now,
    });

    if (!error && data) {
      const res = data as Record<string, unknown>;
      if (res.ok === false) {
        return { ok: false, order: null };
      }
      if (res.ok === true) {
        if (paymentDetails) {
          const { error: paymentError } = await admin.from('payments').upsert(
            {
              order_id: orderId,
              razorpay_payment_id: paymentDetails.paymentId,
              razorpay_order_id: (await getOrderById(orderId))?.razorpay_order_id ?? null,
              status: 'captured',
              method: paymentDetails.method ?? 'UPI',
              amount_paise: paymentDetails.amountPaise ?? (res.total_paise as number),
              currency: 'INR',
              gateway_snapshot: (paymentDetails.gatewaySnapshot as Json) ?? {},
            },
            { onConflict: 'razorpay_payment_id' },
          );
          if (paymentError) throw paymentError;
        }
        return {
          ok: true,
          order: await getOrderById(orderId),
          alreadyPaid: res.already_paid === true,
        };
      }
    }
  } catch (err) {
    logger.warn('Supabase mark_order_paid RPC failed, updating in staging store', { orderId });
  }

  assertStagingFallbackAllowed('mark order paid');
  // Update in memory/staging
  const order = await getOrderById(orderId);
  if (!order) return { ok: false, order: null };

  if (order.status === 'paid') {
    return { ok: true, order, alreadyPaid: true };
  }

  order.status = 'paid';
  order.paid_at = now;
  order.updated_at = now;
  stagingOrders.set(order.id, order);

  // Record payment row
  if (paymentDetails) {
    const paymentId = randomUUID();
    const paymentRecord: Payment = {
      id: paymentId,
      order_id: order.id,
      razorpay_payment_id: paymentDetails.paymentId,
      razorpay_order_id: order.razorpay_order_id,
      status: 'captured',
      method: paymentDetails.method ?? 'UPI',
      amount_paise: paymentDetails.amountPaise ?? order.total_paise,
      currency: 'INR',
      fee_paise: null,
      tax_paise: null,
      error_code: null,
      error_description: null,
      refund_id: null,
      refunded_amount_paise: null,
      gateway_snapshot: (paymentDetails.gatewaySnapshot as Json) ?? {},
      created_at: now,
      updated_at: now,
    };

    try {
      const admin = createAdminClient();
      await admin.from('payments').insert({
        id: paymentRecord.id,
        order_id: paymentRecord.order_id,
        razorpay_payment_id: paymentRecord.razorpay_payment_id,
        razorpay_order_id: paymentRecord.razorpay_order_id,
        status: paymentRecord.status,
        method: paymentRecord.method,
        amount_paise: paymentRecord.amount_paise,
        currency: paymentRecord.currency,
        gateway_snapshot: paymentRecord.gateway_snapshot,
      });
    } catch {
      // Staging fallback
    }

    const existingPayments = stagingPayments.get(order.id) ?? [];
    stagingPayments.set(order.id, [...existingPayments, paymentRecord]);
  }

  return { ok: true, order };
}

export async function refundOrder(
  orderId: string,
  amountPaise?: number,
  reason?: string,
): Promise<{ ok: boolean; error?: string }> {
  const order = await getOrderById(orderId);
  if (!order) return { ok: false, error: 'Order not found' };

  // 1. Attempt gateway refund via Cashfree
  if (order.razorpay_order_id) {
    try {
      await refundCashfreePayment({
        orderId: order.order_number || order.razorpay_order_id,
        amountPaise: amountPaise ?? order.total_paise,
        refundId: `bb_ref_${order.id.replace(/-/g, '').slice(0, 16)}_${amountPaise ?? order.total_paise}`,
        note: reason ?? 'Refund requested from admin',
      });
    } catch (gatewayErr) {
      logger.warn('Cashfree refund failed or simulated', { gatewayErr });
      assertStagingFallbackAllowed('refund payment');
    }
  }

  // 2. Call Postgres refund_order RPC
  const now = new Date().toISOString();
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc('refund_order', {
      p_order_id: order.id,
      p_refunded_at: now,
    });
    if (error) throw error;
    if (!error && data) {
      const result = data as Record<string, unknown>;
      if (result.ok === true) return { ok: true };
      return { ok: false, error: 'The refund could not be recorded for this order.' };
    }
  } catch (err) {
    logger.warn('Supabase refund_order RPC failed, updating staging store', { orderId });
    assertStagingFallbackAllowed('persist refund');
  }

  assertStagingFallbackAllowed('update refund');
  // 3. Update local staging state
  order.status = 'refunded';
  order.refunded_at = now;
  order.updated_at = now;
  stagingOrders.set(order.id, order);

  return { ok: true };
}

export async function updateDownloadOverride(
  orderItemId: string,
  override: number | null,
): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { error } = await admin
      .from('order_items')
      .update({ download_limit_override: override })
      .eq('id', orderItemId);

    if (!error) return true;
  } catch (err) {
    logger.warn('Supabase updateDownloadOverride failed', { err });
  }

  assertStagingFallbackAllowed('update download limit');
  // Staging fallback
  for (const items of stagingOrderItems.values()) {
    const found = items.find((item) => item.id === orderItemId);
    if (found) {
      found.download_limit_override = override;
      return true;
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// Downloads & Entitlement
// ---------------------------------------------------------------------------

export async function claimDownload(
  userIdOrEmail: string,
  productId: string,
  orderId?: string,
): Promise<DownloadClaim> {
  // Guest checkout orders have no auth UUID. Use their verified, exact order
  // instead of passing an email to the user-only claim_download RPC.
  if (orderId && !(env.NODE_ENV === 'test' && stagingOrders.has(orderId))) {
    return claimOrderDownload(userIdOrEmail, productId, orderId);
  }
  // 1. Try Supabase atomic claim_download RPC
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userIdOrEmail);
  if (isUuid) {
    try {
      const admin = createAdminClient();
      const { data, error } = await admin.rpc('claim_download', {
        p_user_id: userIdOrEmail,
        p_product_id: productId,
      });

      if (error && !(env.NODE_ENV === 'test' && error.code === 'TEST_NETWORK_DISABLED')) {
        logger.error('Supabase claim_download RPC failed', { code: error.code, message: error.message });
        throw new ApiError('upstream_error', 'Could not check download access. Please try again shortly.');
      }

      if (!error && data && typeof data === 'object') {
        const res = data as Record<string, unknown>;
        return {
          allowed: res.allowed === true,
          orderItemId: res.order_item_id as string,
          orderId: res.order_id as string,
          downloadsUsed: res.downloads_used as number,
          downloadLimit: res.download_limit as number,
          reason: res.reason === 'limit_reached' ? 'download_limit_reached' : res.reason as string,
        };
      }
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error('Supabase claim_download RPC failed', { err });
      throw new ApiError('upstream_error', 'Could not check download access. Please try again shortly.');
    }
  }

  assertStagingFallbackAllowed('claim download entitlement');
  // 2. Entitlement check in staging store
  for (const order of stagingOrders.values()) {
    if (orderId && order.id !== orderId) continue;
    const matchesUser =
      (order.user_id && order.user_id === userIdOrEmail) ||
      order.email.toLowerCase() === userIdOrEmail.toLowerCase() ||
      (orderId && order.id === orderId);

    if (matchesUser) {
      if (order.status === 'refunded') {
        return { allowed: false, reason: 'order_refunded' };
      }
      if (order.status !== 'paid') {
        continue;
      }

      const items = stagingOrderItems.get(order.id) ?? [];
      const item = items.find((i) => i.product_id === productId);

      if (item) {
        const limit = item.download_limit_override ?? item.download_limit;
        if (item.downloads_used >= limit) {
          return {
            allowed: false,
            orderItemId: item.id,
            orderId: order.id,
            downloadsUsed: item.downloads_used,
            downloadLimit: limit,
            reason: 'download_limit_reached',
          };
        }

        item.downloads_used += 1;
        item.last_downloaded_at = new Date().toISOString();

        return {
          allowed: true,
          orderItemId: item.id,
          orderId: order.id,
          downloadsUsed: item.downloads_used,
          downloadLimit: limit,
        };
      }
    }
  }

  return { allowed: false, reason: 'not_purchased' };
}

export async function releaseDownload(orderItemId: string): Promise<void> {
  if (env.NODE_ENV === 'test') {
    for (const items of stagingOrderItems.values()) {
      const item = items.find((i) => i.id === orderItemId);
      if (item) {
        item.downloads_used = Math.max(0, item.downloads_used - 1);
        return;
      }
    }
  }
  await releaseDatabaseDownload(orderItemId);
}

export async function recordDownloadAudit(params: {
  userId?: string | null;
  orderId?: string | null;
  orderItemId?: string | null;
  productId: string;
  kind: DownloadKind;
  objectKey: string;
  ipHash?: string | null;
  userAgent?: string | null;
  succeeded: boolean;
  refusalReason?: string | null;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from('downloads').insert({
      id: randomUUID(),
      user_id: params.userId ?? null,
      order_id: params.orderId ?? null,
      order_item_id: params.orderItemId ?? null,
      product_id: params.productId,
      kind: params.kind,
      object_key: params.objectKey,
      ip_hash: params.ipHash ?? null,
      user_agent: params.userAgent ?? null,
      succeeded: params.succeeded,
      refusal_reason: params.refusalReason ?? null,
    });
  } catch (err) {
    logger.warn('Supabase downloads audit log write failed', { err });
    assertStagingFallbackAllowed('write download audit');
  }

  const existing = stagingDownloads.get(params.productId) ?? [];
  stagingDownloads.set(params.productId, [...existing, params]);
}

// ---------------------------------------------------------------------------
// Webhook Events
// ---------------------------------------------------------------------------

export async function isWebhookProcessed(provider: string, eventId: string): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from('webhook_events')
      .select('processed_at')
      .eq('provider', provider)
      .eq('event_id', eventId)
      .single();

    if (data?.processed_at) return true;
  } catch {
    // Check staging
  }

  assertStagingFallbackAllowed('check webhook idempotency');
  const existing = stagingWebhookEvents.get(`${provider}:${eventId}`);
  return !!existing?.processedAt;
}

export async function recordWebhookEvent(params: {
  provider: string;
  eventId: string;
  eventType: string;
  payload: unknown;
  processedAt?: string;
  error?: string;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    const { error } = await admin.from('webhook_events').upsert({
      provider: params.provider,
      event_id: params.eventId,
      event_type: params.eventType,
      payload: (params.payload as Json) ?? {},
      processed_at: params.processedAt ?? new Date().toISOString(),
      error: params.error ?? null,
    });
    if (error) throw error;
  } catch {
    // Staging
    assertStagingFallbackAllowed('persist webhook event');
  }

  stagingWebhookEvents.set(`${params.provider}:${params.eventId}`, {
    eventId: params.eventId,
    provider: params.provider,
    processedAt: params.processedAt ?? new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Coupons
// ---------------------------------------------------------------------------

export async function validateCoupon(code: string, productId: string, email?: string, userId?: string): Promise<{
  valid: boolean; couponId?: string; discountType?: 'percent' | 'flat'; discountValue?: number; discountPaise?: number; message?: string;
}> {
  const product = await getProductByIdOrSlug(productId, false, true);
  if (!product || product.status !== 'published') return { valid: false, message: 'This book is unavailable.' };
  const { data, error } = await createAdminClient().rpc('validate_coupon', {
    p_code: code.trim().toLowerCase(), p_subtotal_paise: product.discount_price_paise ?? product.price_paise,
    p_product_id: productId, p_email: email?.toLowerCase() ?? null, p_user_id: userId ?? null,
  });
  if (error || !data) databaseError(error);
  const result = data as Record<string, any>;
  const messages: Record<string, string> = { not_found: 'This coupon is invalid or disabled.', not_started: 'This coupon is not valid yet.', expired: 'This coupon has expired.', exhausted: 'This coupon has reached its usage limit.', already_used: 'You have reached this coupon?s usage limit.', not_applicable: 'This coupon does not apply to this book.', below_minimum: 'This order does not meet the coupon?s minimum amount.' };
  return { valid: result.valid === true, couponId: result.coupon_id, discountType: result.discount_type,
    discountValue: result.discount_value, discountPaise: result.discount_paise,
    message: messages[result.reason] || 'This coupon cannot be applied.' };
}

// ---------------------------------------------------------------------------
// Dashboard Metrics
// ---------------------------------------------------------------------------

export async function getDashboardStats(): Promise<{
  catalogueTitles: number;
  workspaceDrafts: number;
  revenuePaise: number;
  orderCount: number;
  recentOrders: Array<Order & { items: OrderItem[] }>;
}> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc('admin_dashboard_metrics', {});
    if (error) throw error;
    const metrics = data as unknown as Record<string, number>;
    const { orders } = await getOrders({ limit: 10 });
    return {
      catalogueTitles: Number(metrics.catalogue_titles ?? 0),
      workspaceDrafts: Number(metrics.workspace_drafts ?? 0),
      revenuePaise: Number(metrics.revenue_paise ?? 0),
      orderCount: Number(metrics.order_count ?? 0),
      recentOrders: orders,
    };
  } catch (err) {
    logger.warn('Dashboard metrics query failed', { err });
    assertStagingFallbackAllowed('read dashboard metrics');
  }

  const { products } = await getProducts({ status: 'all' });
  const drafts = products.filter((p) => p.status === 'draft').length;
  const { orders } = await getOrders({ limit: 10 });

  let revenue = 0;
  for (const o of stagingOrders.values()) {
    if (o.status === 'paid') revenue += o.total_paise;
  }

  return {
    catalogueTitles: products.length,
    workspaceDrafts: drafts,
    revenuePaise: revenue,
    orderCount: stagingOrders.size,
    recentOrders: orders,
  };
}

// ---------------------------------------------------------------------------
// Integration Status (Safe metadata only, never secrets)
// ---------------------------------------------------------------------------

export function getIntegrationsStatus(): Record<
  string,
  { configured: boolean; setting: string; status: 'ready' | 'incomplete' }
> {
  const hasCashfree = Boolean(env.CASHFREE_APP_ID && env.CASHFREE_SECRET_KEY);
  const hasBrevo = Boolean(env.BREVO_API_KEY && env.EMAIL_FROM);
  const hasCloudinary = Boolean(
    env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET,
  );
  const hasSupabase = Boolean(
    env.NEXT_PUBLIC_SUPABASE_URL &&
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
      env.SUPABASE_SERVICE_ROLE_KEY,
  );

  return {
    cashfree: {
      configured: hasCashfree,
      setting: env.CASHFREE_ENVIRONMENT || 'TEST',
      status: hasCashfree ? 'ready' : 'incomplete',
    },
    brevo: {
      configured: hasBrevo,
      setting: env.EMAIL_FROM || 'Not configured',
      status: hasBrevo ? 'ready' : 'incomplete',
    },
    cloudinary: {
      configured: hasCloudinary,
      setting: env.CLOUDINARY_CLOUD_NAME || 'Not configured',
      status: hasCloudinary ? 'ready' : 'incomplete',
    },
    supabase: {
      configured: hasSupabase,
      setting: 'Connected',
      status: hasSupabase ? 'ready' : 'incomplete',
    },
  };
}
