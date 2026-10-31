import { badRequest } from '@/lib/api/errors';
import { createHandler } from '@/lib/api/handler';
import { createOrder, getProductByIdOrSlug } from '@/lib/db/repository';
import { checkoutRequestSchema } from '@/lib/validation/schemas';
import { env } from '@/lib/env';
import { cashfree } from '@/lib/cashfree';

export const GET = createHandler({ auth: 'public' }, async () => ({
  configured: !!env.CASHFREE_APP_ID && !!env.CASHFREE_SECRET_KEY,
  paymentMode: env.CASHFREE_ENVIRONMENT === 'PRODUCTION' ? 'production' : 'sandbox',
  message: !env.CASHFREE_APP_ID || !env.CASHFREE_SECRET_KEY ? 'Cashfree is not configured. Please contact the store administrator.' : undefined,
}));

export const POST = createHandler(
  {
    auth: 'public',
    body: checkoutRequestSchema,
    rateLimit: { name: 'checkout', by: 'user-or-ip' },
  },
  async ({ body, user, ipHash, userAgent, log }) => {
    cashfree(); // Validate backend configuration before creating a pending order.
    // 1. Verify product exists and is published
    const product = await getProductByIdOrSlug(body.productId, true, true);
    if (!product || product.status !== 'published') {
      throw badRequest('The requested book is not available for purchase.');
    }

    log.info('Creating checkout order', {
      productId: product.id,
      slug: product.slug,
      email: body.email,
    });

    // 2. Create internal order and initialize Cashfree payment
    const result = await createOrder({
      productId: product.id,
      email: body.email,
      fullName: body.fullName,
      phone: body.phone,
      couponCode: body.couponCode,
      marketingOptIn: body.marketingOptIn,
      metadata: body.metadata,
      ipHash,
      userAgent,
      userId: user?.id ?? null,
    });

    log.info('Checkout order created', {
      orderId: result.order.id,
      orderNumber: result.order.order_number,
      totalPaise: result.order.total_paise,
    });

    return {
      orderId: result.order.id,
      orderNumber: result.order.order_number,
      paymentSessionId: result.paymentSessionId,
      paymentMode: env.CASHFREE_ENVIRONMENT === 'PRODUCTION' ? 'production' : 'sandbox',
      cfOrderId: result.cfOrderId,
      amountPaise: result.order.total_paise,
      currency: result.order.currency,
    };
  },
);
