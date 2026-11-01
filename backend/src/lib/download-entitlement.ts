import { ApiError } from './api/errors';
import { logger } from './logger';
import { createAdminClient } from './supabase/admin';
import type { Order, OrderItem } from '@/types/database';

type EntitlementOrder = Pick<Order, 'id' | 'email' | 'user_id' | 'status'> & {
  items: Pick<OrderItem, 'id' | 'product_id' | 'downloads_used' | 'download_limit' | 'download_limit_override'>[];
};

export interface DownloadClaim {
  allowed: boolean;
  orderItemId?: string;
  orderId?: string;
  downloadsUsed?: number;
  downloadLimit?: number;
  reason?: string;
}

function downloadDatabaseError(error: { code?: string; message?: string } | null): never {
  logger.error('Download entitlement database operation failed', { code: error?.code, message: error?.message });
  throw new ApiError('upstream_error', 'Could not check download access. Please try again shortly.');
}

export async function releaseDatabaseDownload(orderItemId: string): Promise<void> {
  const { error } = await createAdminClient().rpc('release_download', { p_order_item_id: orderItemId });
  if (error) downloadDatabaseError(error);
}

/** Called only after the API has verified the guest's order/download credential. */
export async function claimOrderDownload(identity: string, productId: string, orderId: string): Promise<DownloadClaim> {
  const admin = createAdminClient();
  const readOrder = async () => {
    const { data, error } = await admin.from('orders')
      .select('id,email,user_id,status,items:order_items(id,product_id,downloads_used,download_limit,download_limit_override)')
      .eq('id', orderId).maybeSingle();
    if (error) downloadDatabaseError(error);
    return data as unknown as EntitlementOrder | null;
  };
  const refusal = (order: Awaited<ReturnType<typeof readOrder>>): string | undefined => {
    if (!order || !(order.user_id === identity || order.email.toLowerCase() === identity.toLowerCase() ||
      (!order.email && order.id === identity))) return 'not_purchased';
    if (order.status === 'refunded') return 'order_refunded';
    if (order.status !== 'paid') return 'not_purchased';
  };

  for (let attempt = 0; attempt < 8; attempt++) {
    const order = await readOrder();
    const reason = refusal(order);
    if (reason || !order) return { allowed: false, reason: reason || 'not_purchased' };
    const item = order.items.find(candidate => candidate.product_id === productId);
    if (!item) return { allowed: false, reason: 'not_purchased' };
    const limit = item.download_limit_override ?? item.download_limit;
    const result = { orderId, orderItemId: item.id, downloadsUsed: item.downloads_used, downloadLimit: limit };
    if (item.downloads_used >= limit) return { ...result, allowed: false, reason: 'download_limit_reached' };

    // PostgreSQL rechecks these predicates under its row lock. Only one request
    // can consume this counter value; competitors reload the count and limits.
    let update = admin.from('order_items')
      .update({ downloads_used: item.downloads_used + 1, last_downloaded_at: new Date().toISOString() })
      .eq('id', item.id).eq('order_id', orderId).eq('product_id', productId)
      .eq('downloads_used', item.downloads_used).eq('download_limit', item.download_limit);
    update = item.download_limit_override === null
      ? update.is('download_limit_override', null)
      : update.eq('download_limit_override', item.download_limit_override);
    const { data: claimed, error } = await update.select('id').maybeSingle();
    if (error) downloadDatabaseError(error);
    if (!claimed) continue;

    // A refund/ownership change between the read and update must not grant a URL.
    let current;
    try {
      current = await readOrder();
    } catch (error) {
      await releaseDatabaseDownload(item.id);
      throw error;
    }
    const changed = refusal(current);
    if (changed) {
      await releaseDatabaseDownload(item.id);
      return { ...result, allowed: false, reason: changed };
    }
    return { ...result, allowed: true, downloadsUsed: item.downloads_used + 1 };
  }
  throw new ApiError('upstream_error', 'Another download is being processed. Please try again shortly.');
}
