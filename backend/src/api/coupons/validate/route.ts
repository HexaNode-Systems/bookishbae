import { badRequest } from '@/lib/api/errors';
import { createHandler } from '@/lib/api/handler';
import { validateCoupon } from '@/lib/db/repository';
import { couponValidateSchema } from '@/lib/validation/schemas';

export const POST = createHandler(
  {
    auth: 'public',
    body: couponValidateSchema,
    rateLimit: { name: 'coupon', by: 'user-or-ip' },
  },
  async ({ body, user, log }) => {
    const result = await validateCoupon(body.code, body.productId, body.email, user?.id);

    if (!result.valid) {
      log.info('Coupon rejected', { code: body.code });
      throw badRequest(result.message ?? 'Invalid or expired coupon code.');
    }

    log.info('Coupon accepted', { code: body.code, discountPaise: result.discountPaise });
    return {
      valid: true,
      code: body.code.toUpperCase(),
      discountType: result.discountType,
      discountValue: result.discountValue,
      discountPaise: result.discountPaise,
    };
  },
);
