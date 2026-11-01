import { ApiError, notFound } from './api/errors';
import { db, transaction, databaseFailure } from './db/postgres';
import type { Category, Coupon } from '@/types/database';
import type { z } from 'zod';
import type { categorySchema, couponUpsertSchema } from './validation/schemas';
export const databaseError = databaseFailure;
export async function getCategories(): Promise<Category[]> { return db.query<Category>('SELECT * FROM public.categories ORDER BY sort_order,name'); }
export async function saveCategory(id: string | undefined, body: z.infer<typeof categorySchema>) {
  const values = [body.name, body.slug, body.description ?? null, body.sortOrder];
  const [row] = await db.query<Category>(id ? 'UPDATE public.categories SET name=$1,slug=$2,description=$3,sort_order=$4 WHERE id=$5 RETURNING *' : 'INSERT INTO public.categories(name,slug,description,sort_order) VALUES($1,$2,$3,$4) RETURNING *', id ? [...values, id] : values);
  if (!row)
    throw notFound();
  return row;
}
export async function deleteCategory(id: string) {
  await transaction(async (sql) => {
    await sql.query('SELECT id FROM public.categories WHERE id=$1 FOR UPDATE', [id]);
    if ((await sql.query('SELECT id FROM public.products WHERE category_id=$1 LIMIT 1', [id])).length)
      throw new ApiError('conflict', 'This category is used by books. Reassign those books before deleting it.');
    if (!(await sql.query('DELETE FROM public.categories WHERE id=$1 RETURNING id', [id])).length)
      throw notFound();
  });
}
export type ManagedCoupon = Coupon & {
  product_ids: string[];
};
export async function getCoupons(): Promise<ManagedCoupon[]> {
  return db.query<ManagedCoupon>(`SELECT c.*, ARRAY(SELECT DISTINCT product_id FROM public.coupon_products WHERE coupon_id=c.id UNION SELECT c.product_id WHERE c.product_id IS NOT NULL) AS product_ids FROM public.coupons c ORDER BY created_at DESC`);
}
export async function saveCoupon(id: string | undefined, body: z.infer<typeof couponUpsertSchema>) {
  const [row] = await db.query<{
    coupon: ManagedCoupon;
  }>('SELECT public.save_coupon($1,$2::jsonb) AS coupon', [id ?? null, JSON.stringify(body)]);
  return row!.coupon;
}
export async function deleteCoupon(id: string) { await db.query('SELECT public.delete_coupon($1)', [id]); }
export async function toggleCoupon(id: string, active: boolean) {
  const [row] = await db.query<Coupon>('UPDATE public.coupons SET is_active=$2 WHERE id=$1 RETURNING *', [id, active]);
  if (!row)
    throw notFound();
  return row;
}
