import { ApiError, badRequest, notFound } from './api/errors';
import { createAdminClient } from './supabase/admin';
import type { Category, Coupon } from '@/types/database';
import type { z } from 'zod';
import type { categorySchema, couponUpsertSchema } from './validation/schemas';
import { logger } from './logger';

export function databaseError(error: { code?: string; message?: string } | null): never {
  logger.error('Author commerce database operation failed', { code: error?.code, message: error?.message });
  if (error?.code === '23505') throw new ApiError('conflict', 'That code or category slug already exists.');
  if (error?.code === '23503') throw new ApiError('conflict', 'This item is still in use. Reassign its books or disable the coupon instead.');
  if (error?.code === 'PGRST116' || error?.code === 'P0002') throw notFound('The requested item no longer exists.');
  if (error?.code === '22023') throw badRequest(error.message || 'Those details are not valid.');
  throw new ApiError('upstream_error', 'The database operation failed. Check that the latest migrations have been applied and retry.');
}

export async function getCategories(): Promise<Category[]> {
  const { data, error } = await createAdminClient().from('categories').select('*').order('sort_order').order('name');
  if (error || !data) databaseError(error);
  return data;
}

export async function saveCategory(id: string | undefined, body: z.infer<typeof categorySchema>) {
  const values = { name: body.name, slug: body.slug, description: body.description ?? null, sort_order: body.sortOrder };
  const table = createAdminClient().from('categories');
  const { data, error } = await (id ? table.update(values).eq('id', id) : table.insert(values)).select().single();
  if (error || !data) databaseError(error);
  return data;
}

export async function deleteCategory(id: string) {
  const used = await createAdminClient().from('products').select('id', { count: 'exact', head: true }).eq('category_id', id);
  if (used.error) databaseError(used.error);
  if (used.count) throw new ApiError('conflict', 'This category is used by books. Reassign those books before deleting it.');
  const { data, error } = await createAdminClient().from('categories').delete().eq('id', id).select('id').single();
  if (error || !data) databaseError(error);
}

export type ManagedCoupon = Coupon & { product_ids: string[] };
export async function getCoupons(): Promise<ManagedCoupon[]> {
  const admin = createAdminClient();
  const { data, error } = await admin.from('coupons').select('*').order('created_at', { ascending: false });
  if (error || !data) databaseError(error);
  const links = await admin.from('coupon_products').select('coupon_id,product_id');
  if (links.error) databaseError(links.error);
  return data.map((coupon) => ({ ...coupon, product_ids: [...new Set([...(links.data?.filter((link) => link.coupon_id === coupon.id).map((link) => link.product_id) || []), ...(coupon.product_id ? [coupon.product_id] : [])])] }));
}

export async function saveCoupon(id: string | undefined, body: z.infer<typeof couponUpsertSchema>) {
  const { data, error } = await createAdminClient().rpc('save_coupon', { p_id: id ?? null, p_coupon: body });
  if (error || !data) databaseError(error);
  return data;
}

export async function deleteCoupon(id: string) {
  const { data, error } = await createAdminClient().rpc('delete_coupon', { p_id: id });
  if (error || !data) databaseError(error);
}

export async function toggleCoupon(id: string, isActive: boolean) {
  const { data, error } = await createAdminClient().from('coupons').update({ is_active: isActive }).eq('id', id).select().single();
  if (error || !data) databaseError(error);
  return data;
}
