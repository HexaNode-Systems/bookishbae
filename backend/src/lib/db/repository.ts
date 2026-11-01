/** Direct PostgreSQL repositories. Privileged calls require API authorization. */
import { ApiError } from '../api/errors';
import { withProductAssets } from '../product-assets';
import { createCashfreeOrder, refundCashfreePayment } from '../cashfree';
import { env } from '../env';
import { db, transaction, type Sql } from './postgres';
import { claimOrderDownload, releaseDatabaseDownload, type DownloadClaim } from '../download-entitlement';
import type { DownloadKind, Order, OrderItem, Product, ProductStatus } from '../../types/database';
export { getIntegrationsStatus } from './integrations';
export interface StagingProduct extends Product {
  cover_url?: string;
  sample_pdf_url?: string;
  category?: string | null;
  category_slug?: string | null;
}
// Stable fixture IDs, without a runtime fixture store or database fallback.
export const SEED_BOOK_IDS: Record<string, string> = {
  'the-long-afternoon': '11111111-1111-4111-a111-111111111111',
  'letters-i-never-sent': '22222222-2222-4222-a222-222222222222',
  'everything-we-didnt-say': '33333333-3333-4333-a333-333333333333',
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Explicit projection prevents new internal columns from becoming public.
const publicColumns = `id,slug,title,subtitle,description,excerpt,author_name,category_id,price_paise,discount_price_paise,currency,cover_key,cover_width,cover_height,cover_alt,page_count,language,isbn,status,is_featured,sales_count,rating_avg,rating_count,meta_title,meta_description,published_at,created_at,updated_at,sample_preview`;
function hydrate(products: StagingProduct[], publicView = false): StagingProduct[] {
  return products.map(product => {
    const result = withProductAssets({
      ...product, rating_avg: product.rating_avg == null ? null : Number(product.rating_avg),
      ...(!publicView ? { main_pdf_bytes: product.main_pdf_bytes == null ? null : Number(product.main_pdf_bytes) } : {})
    });
    if (publicView)
      result.sample_pdf_url = undefined;
    return result;
  });
}
const productJoin = ' FROM public.products p LEFT JOIN public.categories c ON c.id=p.category_id';
function productSelect(publicView: boolean) {
  return `SELECT ${publicView ? publicColumns.split(',').map(c => `p.${c}`).join(',') : 'p.*'},c.name AS category,c.slug AS category_slug`;
}
export async function getProducts(options: {
  status?: ProductStatus | 'all';
  category?: string;
  query?: string;
  sort?: string;
  page?: number;
  limit?: number;
  publicView?: boolean;
} = {}): Promise<{
  products: Partial<StagingProduct>[];
  total: number;
}> {
  const page = Math.max(1, options.page ?? 1), limit = Math.min(100, Math.max(1, options.limit ?? 20));
  const values: unknown[] = [], where: string[] = [];
  const bind = (value: unknown) => { values.push(value); return `$${values.length}`; };
  if (options.publicView)
    where.push("p.status='published'");
  else if (options.status && options.status !== 'all')
    where.push(`p.status=${bind(options.status)}`);
  if (options.category && options.category !== 'all') {
    const p = bind(options.category);
    where.push(`(c.slug=${p} OR c.id::text=${p})`);
  }
  if (options.query) {
    const p = bind(`%${options.query}%`);
    where.push(`(p.title ILIKE ${p} OR p.slug ILIKE ${p})`);
  }
  const predicate = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const sorts: Record<string, string> = { bestselling: 'p.sales_count DESC', 'price-asc': 'coalesce(p.discount_price_paise,p.price_paise) ASC', 'price-desc': 'coalesce(p.discount_price_paise,p.price_paise) DESC', rating: 'p.rating_avg DESC NULLS LAST' };
  const [count] = await db.query<{
    total: string;
  }>('SELECT count(*) AS total' + productJoin + predicate, values);
  const rows = await db.query<StagingProduct>(productSelect(!!options.publicView) + productJoin + predicate + ` ORDER BY ${sorts[options.sort || ''] || 'p.created_at DESC'},p.id LIMIT ${bind(limit)} OFFSET ${bind((page - 1) * limit)}`, values);
  return { products: hydrate(rows, options.publicView), total: Number(count?.total || 0) };
}
export async function getProductByIdOrSlug(idOrSlug: string, publicView = false, _requirePersisted = false): Promise<StagingProduct | null> {
  const rows = await db.query<StagingProduct>(productSelect(publicView) + productJoin + ` WHERE p.${uuid.test(idOrSlug) ? 'id' : 'slug'}=$1` + (publicView ? " AND p.status='published'" : ''), [idOrSlug]);
  return hydrate(rows, publicView)[0] ?? null;
}
const writableProductColumns = new Set(`slug,title,subtitle,description,excerpt,author_name,category_id,sample_preview,price_paise,discount_price_paise,currency,cover_key,cover_width,cover_height,cover_alt,sample_pdf_key,main_pdf_key,main_pdf_bytes,main_pdf_sha256,page_count,language,isbn,status,is_featured,watermark_enabled,download_limit,meta_title,meta_description,published_at`.split(','));
function productValues(input: Partial<StagingProduct>) {
  return Object.entries(input).filter(([key, value]) => writableProductColumns.has(key) && value !== undefined).map(([key, value]) => [key, key === 'sample_preview' ? JSON.stringify(value) : value] as const);
}
export async function createProduct(input: Partial<StagingProduct>): Promise<StagingProduct> {
  const entries = productValues({ ...input, published_at: input.status === 'published' ? new Date().toISOString() : null });
  const [row] = await db.query<StagingProduct>(`INSERT INTO public.products (${entries.map(([k]) => k).join(',')}) VALUES (${entries.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, entries.map(([, v]) => v));
  return hydrate([row!])[0]!;
}
export async function updateProduct(id: string, input: Partial<Product>): Promise<StagingProduct | null> {
  const entries = productValues(input);
  if (!entries.length)
    return getProductByIdOrSlug(id);
  const assignments = entries.map(([k], i) => `${k}=$${i + 2}`);
  if (input.status && !entries.some(([k]) => k === 'published_at'))
    assignments.push(input.status === 'published' ? 'published_at=coalesce(published_at,now())' : 'published_at=NULL');
  const [row] = await db.query<StagingProduct>(`UPDATE public.products SET ${assignments.join(',')} WHERE id=$1 RETURNING *`, [id, ...entries.map(([, v]) => v)]);
  return row ? hydrate([row])[0]! : null;
}
export async function deleteProduct(id: string): Promise<{
  success: boolean;
  error?: string;
}> {
  return transaction(async (sql) => {
    await sql.query('SELECT id FROM public.products WHERE id=$1 FOR UPDATE', [id]);
    if ((await sql.query('SELECT id FROM public.order_items WHERE product_id=$1 LIMIT 1', [id])).length)
      return { success: false, error: 'Product cannot be deleted because orders exist for it. Archive it instead.' };
    return (await sql.query('DELETE FROM public.products WHERE id=$1 RETURNING id', [id])).length ? { success: true } : { success: false, error: 'Product not found' };
  });
}
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
  // Schema-defined pricing, coupon reservation and item snapshots are atomic.
  const [row] = await db.query<{
    result: {
      order: Order;
      orderItem: OrderItem;
    };
  }>('SELECT public.create_checkout_order($1,$2,$3,$4,$5,$6::jsonb,$7,$8) AS result', [params.productId, params.email, params.fullName, params.couponCode ?? null, params.userId ?? null, JSON.stringify(params.metadata ?? {}), params.ipHash ?? null, params.userAgent ?? null]);
  if (!row?.result.order?.id || !row.result.orderItem?.id)
    throw new ApiError('upstream_error', 'The database did not confirm this order.');
  const { order, orderItem } = row.result;
  const product = await getProductByIdOrSlug(params.productId);
  try {
    const remote = await createCashfreeOrder({
      orderId: order.order_number, amountPaise: order.total_paise,
      // Random UUID is the guest capability. Never use sequential order numbers.
      returnUrl: `${env.NEXT_PUBLIC_SITE_URL}/checkout/return?order_id=${order.id}&book=${encodeURIComponent(product?.slug || '')}`,
      customer: { id: params.userId ?? `guest_${order.id.slice(0, 12)}`, email: params.email, name: params.fullName, phone: params.phone },
      note: `BookishBae: ${product?.title || 'E-book'}`, tags: { orderId: order.id, productId: params.productId }
    });
    await db.query('UPDATE public.orders SET razorpay_order_id=$2 WHERE id=$1', [order.id, remote.id]);
    order.razorpay_order_id = remote.id;
    return { order, orderItem, paymentSessionId: remote.paymentSessionId, cfOrderId: remote.cfOrderId };
  }
  catch (error) {
    await db.query("UPDATE public.orders SET status='failed',failed_at=now() WHERE id=$1 AND status='pending'", [order.id]);
    if (error instanceof ApiError)
      throw error;
    const status = (error as {
      response?: {
        status?: number;
      };
    })?.response?.status;
    throw new ApiError('upstream_error', status === 401 || status === 403 ? 'Cashfree rejected the configured credentials or website. Check the selected payment environment and domain configuration.' : 'Cashfree could not start payment. Please retry shortly.');
  }
}
const orderSelect = `SELECT o.*,coalesce((SELECT jsonb_agg(oi ORDER BY oi.created_at,oi.id) FROM public.order_items oi WHERE oi.order_id=o.id),'[]'::jsonb) AS items FROM public.orders o`;
export async function getOrders(options: {
  status?: string;
  query?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
} = {}): Promise<{
  orders: Array<Order & {
    items: OrderItem[];
  }>;
  total: number;
}> {
  const values: unknown[] = [], where: string[] = [];
  const bind = (v: unknown) => { values.push(v); return `$${values.length}`; };
  if (options.status && options.status !== 'all')
    where.push(`o.status=${bind(options.status)}`);
  if (options.query) {
    const p = bind(`%${options.query}%`);
    where.push(`(o.order_number ILIKE ${p} OR o.email ILIKE ${p} OR o.full_name ILIKE ${p})`);
  }
  if (options.from)
    where.push(`o.created_at>=${bind(options.from)}::timestamptz`);
  if (options.to)
    where.push(`o.created_at<=${bind(options.to)}::timestamptz`);
  const predicate = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const [count] = await db.query<{
    total: string;
  }>('SELECT count(*) AS total FROM public.orders o' + predicate, values);
  const limit = Math.min(100, Math.max(1, options.limit ?? 25)), page = Math.max(1, options.page ?? 1);
  const orders = await db.query<Order & {
    items: OrderItem[];
  }>(orderSelect + predicate + ` ORDER BY o.created_at DESC,o.id LIMIT ${bind(limit)} OFFSET ${bind((page - 1) * limit)}`, values);
  return { orders, total: Number(count?.total || 0) };
}
async function readOrder(sql: Sql, id: string) {
  const [order] = await sql.query<Order & {
    items: OrderItem[];
  }>(orderSelect + ` WHERE o.${uuid.test(id) ? 'id' : 'order_number'}=$1`, [id]);
  return order ?? null;
}
export async function getOrderById(id: string): Promise<(Order & {
  items: OrderItem[];
}) | null> { return readOrder(db, id); }
export async function markOrderPaid(orderId: string, paymentDetails?: {
  paymentId: string;
  method?: string;
  amountPaise?: number;
  gatewaySnapshot?: Record<string, unknown>;
}): Promise<{
  ok: boolean;
  order: Order | null;
  alreadyPaid?: boolean;
}> {
  return transaction(async (sql) => {
    const [row] = await sql.query<{
      result: {
        ok: boolean;
        already_paid?: boolean;
      };
    }>('SELECT public.mark_order_paid($1) AS result', [orderId]);
    if (!row?.result.ok)
      return { ok: false, order: null };
    const order = await readOrder(sql, orderId);
    if (!order)
      throw new ApiError('upstream_error', 'The database did not confirm this payment.');
    if (paymentDetails) {
      if (paymentDetails.amountPaise !== undefined && paymentDetails.amountPaise !== order.total_paise)
        throw new ApiError('bad_request', 'The payment amount does not match the order.');
      const [payment] = await sql.query(`INSERT INTO public.payments(order_id,razorpay_payment_id,razorpay_order_id,status,method,amount_paise,currency,gateway_snapshot) VALUES($1,$2,$3,'captured',$4,$5,'INR',$6::jsonb)
        ON CONFLICT(razorpay_payment_id) DO UPDATE SET status='captured',updated_at=now() WHERE payments.order_id=excluded.order_id AND payments.amount_paise=excluded.amount_paise RETURNING id`, [orderId, paymentDetails.paymentId, order.razorpay_order_id, paymentDetails.method ?? 'UPI', order.total_paise, JSON.stringify(paymentDetails.gatewaySnapshot ?? {})]);
      if (!payment)
        throw new ApiError('conflict', 'This payment is already associated with a different order.');
    }
    return { ok: true, order, alreadyPaid: row.result.already_paid === true };
  });
}
export async function refundOrder(orderId: string, amountPaise?: number, reason?: string): Promise<{
  ok: boolean;
  error?: string;
}> {
  const order = await getOrderById(orderId);
  if (!order)
    return { ok: false, error: 'Order not found' };
  if (order.status === 'refunded')
    return { ok: true };
  if (order.status !== 'paid')
    return { ok: false, error: 'Only paid orders can be refunded.' };
  if (order.razorpay_order_id)
    await refundCashfreePayment({ orderId: order.order_number, amountPaise: amountPaise ?? order.total_paise, refundId: `bb_ref_${order.id.replace(/-/g, '').slice(0, 16)}_${amountPaise ?? order.total_paise}`, note: reason ?? 'Refund requested from admin' });
  const [row] = await db.query<{
    result: {
      ok: boolean;
    };
  }>('SELECT public.refund_order($1) AS result', [order.id]);
  return { ok: row?.result.ok === true };
}
export async function updateDownloadOverride(orderItemId: string, override: number | null): Promise<boolean> {
  return (await db.query('UPDATE public.order_items SET download_limit_override=$2 WHERE id=$1 RETURNING id', [orderItemId, override])).length > 0;
}
export async function claimDownload(identity: string, productId: string, orderId?: string): Promise<DownloadClaim> {
  if (orderId)
    return claimOrderDownload(identity, productId, orderId);
  if (!uuid.test(identity))
    return { allowed: false, reason: 'not_purchased' };
  return transaction(async (sql) => {
    const orders = await sql.query<{
      id: string;
    }>(`SELECT o.id FROM public.orders o JOIN public.order_items oi ON oi.order_id=o.id WHERE o.user_id=$1 AND oi.product_id=$2 AND o.status='paid' ORDER BY (coalesce(oi.download_limit_override,oi.download_limit)-oi.downloads_used) DESC,o.paid_at DESC`, [identity, productId]);
    if (!orders[0])
      return { allowed: false, reason: 'not_purchased' };
    return claimOrderDownload(identity, productId, orders[0].id, sql);
  });
}
export async function releaseDownload(id: string): Promise<void> { await releaseDatabaseDownload(id); }
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
  await db.query(`INSERT INTO public.downloads(user_id,order_id,order_item_id,product_id,kind,object_key,ip_hash,user_agent,succeeded,refusal_reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [params.userId ?? null, params.orderId ?? null, params.orderItemId ?? null, params.productId, params.kind, params.objectKey, params.ipHash ?? null, params.userAgent ?? null, params.succeeded, params.refusalReason ?? null]);
}
export async function isWebhookProcessed(provider: string, eventId: string): Promise<boolean> {
  const [row] = await db.query('SELECT processed_at FROM public.webhook_events WHERE provider=$1 AND event_id=$2', [provider, eventId]);
  return !!row?.processed_at;
}
export async function recordWebhookEvent(params: {
  provider: string;
  eventId: string;
  eventType: string;
  payload: unknown;
  processedAt?: string;
  error?: string;
}): Promise<void> {
  await db.query(`INSERT INTO public.webhook_events(provider,event_id,event_type,payload,processed_at,error) VALUES($1,$2,$3,$4::jsonb,$5,$6) ON CONFLICT(provider,event_id) DO UPDATE SET processed_at=excluded.processed_at,error=excluded.error`, [params.provider, params.eventId, params.eventType, JSON.stringify(params.payload ?? {}), params.processedAt ?? new Date().toISOString(), params.error ?? null]);
}
export async function validateCoupon(code: string, productId: string, email?: string, userId?: string): Promise<{
  valid: boolean;
  couponId?: string;
  discountType?: 'percent' | 'flat';
  discountValue?: number;
  discountPaise?: number;
  message?: string;
}> {
  const product = await getProductByIdOrSlug(productId, false, true);
  if (!product || product.status !== 'published')
    return { valid: false, message: 'This book is unavailable.' };
  const [row] = await db.query<{
    result: {
      valid: boolean;
      coupon_id?: string;
      discount_type?: 'percent' | 'flat';
      discount_value?: number;
      discount_paise?: number;
      reason?: string;
    };
  }>('SELECT public.validate_coupon($1,$2,$3,$4,$5) AS result', [code.trim().toLowerCase(), product.discount_price_paise ?? product.price_paise, product.id, email?.toLowerCase() ?? null, userId ?? null]);
  const result = row!.result;
  const messages: Record<string, string> = { not_found: 'This coupon is invalid or disabled.', not_started: 'This coupon is not valid yet.', expired: 'This coupon has expired.', exhausted: 'This coupon has reached its usage limit.', already_used: 'You have reached this coupon’s usage limit.', not_applicable: 'This coupon does not apply to this book.', below_minimum: 'This order does not meet the coupon’s minimum amount.' };
  return { valid: result.valid === true, couponId: result.coupon_id, discountType: result.discount_type, discountValue: result.discount_value, discountPaise: result.discount_paise, message: result.valid ? undefined : messages[result.reason || ''] || 'This coupon cannot be applied.' };
}
export async function getDashboardStats(): Promise<{
  catalogueTitles: number;
  workspaceDrafts: number;
  revenuePaise: number;
  orderCount: number;
  recentOrders: Array<Order & {
    items: OrderItem[];
  }>;
}> {
  const [row] = await db.query<{
    metrics: Record<string, number>;
  }>('SELECT public.admin_dashboard_metrics() AS metrics');
  const metrics = row!.metrics;
  return { catalogueTitles: Number(metrics.catalogue_titles), workspaceDrafts: Number(metrics.workspace_drafts), revenuePaise: Number(metrics.revenue_paise), orderCount: Number(metrics.order_count), recentOrders: (await getOrders({ limit: 10 })).orders };
}
