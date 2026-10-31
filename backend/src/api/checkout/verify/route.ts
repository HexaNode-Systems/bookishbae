import { notFound } from '@/lib/api/errors';
import { createHandler } from '@/lib/api/handler';
import { confirmCashfreePayment } from '@/lib/payment-verification';
import { getOrderById, markOrderPaid } from '@/lib/db/repository';
import { signDownloadToken } from '@/lib/download-token';
import { z } from 'zod';

const verifyRequestSchema = z.object({
  orderId: z.string().min(1).max(100),
});

export const POST = createHandler(
  {
    auth: 'public',
    body: verifyRequestSchema,
    rateLimit: { name: 'checkout', by: 'user-or-ip' },
  },
  async ({ body, log }) => {
    const order = await getOrderById(body.orderId);
    if (!order) {
      throw notFound('Order not found.');
    }

    // If order is already fulfilled and paid in our ledger
    if (order.status === 'paid') {
      const productId = order.items?.[0]?.product_id;
      const downloadToken = signDownloadToken(order.id, productId);
      return {
        verified: true,
        paid: true,
        orderId: order.id,
        orderNumber: order.order_number,
        status: 'paid',
        downloadToken,
        productId,
      };
    }

    // Never trust client claims: verify directly with Cashfree gateway
    try {
      const confirmation = await confirmCashfreePayment(order);
      if (confirmation.paid) {
        const paymentResult = await markOrderPaid(order.id, {
          paymentId: confirmation.paymentId!, amountPaise: order.total_paise,
          gatewaySnapshot: { source: 'cashfree_server_verification' },
        });

        if (!paymentResult.ok) {
          return {
            verified: true,
            paid: false,
            orderId: order.id,
            orderNumber: order.order_number,
            status: 'pending',
            message: 'Cashfree confirmed the payment, but the order could not be finalized. Please contact support and do not pay again.',
          };
        }

        const updatedOrder = await getOrderById(order.id);
        const productId = updatedOrder?.items?.[0]?.product_id || order.items?.[0]?.product_id;
        const downloadToken = signDownloadToken(order.id, productId);

        return {
          verified: true,
          paid: true,
          orderId: order.id,
          orderNumber: order.order_number,
          status: 'paid',
          downloadToken,
          productId,
        };
      }

      return { verified: true, paid: false, orderId: order.id, orderNumber: order.order_number, status: confirmation.status };
    } catch (cfError) {
      log.warn('Could not fetch Cashfree order status directly', { cfError });
      return {
        verified: false,
        paid: false,
        orderId: order.id,
        orderNumber: order.order_number,
        status: 'pending',
        message: 'Payment has not been confirmed. Please check again shortly.',
      };
    }
  },
);
