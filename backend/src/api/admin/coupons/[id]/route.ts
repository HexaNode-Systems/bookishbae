import { createHandler } from '@/lib/api/handler';
import { saveCoupon, deleteCoupon, toggleCoupon } from '@/lib/author-commerce';
import { z } from 'zod';
import { couponUpsertSchema } from '@/lib/validation/schemas';
import { uuidSchema } from '@/lib/validation/common';
export const PATCH = createHandler({ auth: 'admin', body: z.union([couponUpsertSchema, z.object({ isActive: z.boolean() }).strict()]), rateLimit: { name: 'adminWrite', by: 'user' } }, async ({ body, params }) => ({ ok: true, coupon: 'code' in body ? await saveCoupon(uuidSchema.parse(params?.id), body) : await toggleCoupon(uuidSchema.parse(params?.id), body.isActive) }));
export const DELETE = createHandler({ auth: 'admin', rateLimit: { name: 'adminWrite', by: 'user' } }, async ({ params }) => { await deleteCoupon(uuidSchema.parse(params?.id)); return { ok: true }; });
