import { db, transaction, type Sql } from './db/postgres';
export interface DownloadClaim {
  allowed: boolean;
  orderItemId?: string;
  orderId?: string;
  downloadsUsed?: number;
  downloadLimit?: number;
  reason?: string;
}
export async function releaseDatabaseDownload(id: string): Promise<void> { await db.query('SELECT public.release_download($1)', [id]); }
/** Called only for verified Auth identity or an exact, unguessable guest order capability. */
export async function claimOrderDownload(identity: string, productId: string, orderId: string, sql?: Sql): Promise<DownloadClaim> {
  if (!sql)
    return transaction(connection => claimOrderDownload(identity, productId, orderId, connection));
  // Lock order before item, matching refunds. Status and counters stay stable until commit.
  const [order] = await sql.query<{
    id: string;
    email: string;
    user_id: string | null;
    status: string;
  }>('SELECT id,email,user_id,status FROM public.orders WHERE id=$1 FOR UPDATE', [orderId]);
  if (!order || !(order.user_id === identity || order.email.toLowerCase() === identity.toLowerCase()))
    return { allowed: false, reason: 'not_purchased' };
  if (order.status !== 'paid')
    return { allowed: false, reason: order.status === 'refunded' ? 'order_refunded' : 'not_purchased' };
  const [item] = await sql.query<{
    id: string;
    downloads_used: number;
    download_limit: number;
    download_limit_override: number | null;
  }>('SELECT id,downloads_used,download_limit,download_limit_override FROM public.order_items WHERE order_id=$1 AND product_id=$2 FOR UPDATE', [orderId, productId]);
  if (!item)
    return { allowed: false, reason: 'not_purchased' };
  const limit = item.download_limit_override ?? item.download_limit;
  const result = { orderId, orderItemId: item.id, downloadsUsed: item.downloads_used, downloadLimit: limit };
  if (item.downloads_used >= limit)
    return { ...result, allowed: false, reason: 'download_limit_reached' };
  await sql.query('UPDATE public.order_items SET downloads_used=downloads_used+1,last_downloaded_at=now() WHERE id=$1', [item.id]);
  return { ...result, allowed: true, downloadsUsed: item.downloads_used + 1 };
}
