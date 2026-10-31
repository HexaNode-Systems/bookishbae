import { createHandler } from '@/lib/api/handler';
import { getCoupons, saveCoupon } from '@/lib/author-commerce';
import { couponUpsertSchema } from '@/lib/validation/schemas';
export const GET = createHandler({ auth: 'admin' }, async () => ({ coupons: await getCoupons() }));
export const POST = createHandler({ auth: 'admin', body: couponUpsertSchema, rateLimit: { name: 'adminWrite', by: 'user' } }, async ({ body }) => ({ ok: true, coupon: await saveCoupon(undefined, body) }));
