import { badRequest } from '@/lib/api/errors';
import { createHandler } from '@/lib/api/handler';
import { sendEmail } from '@/lib/brevo';
import { getOrderById, refundOrder } from '@/lib/db/repository';
import { orderRefundSchema } from '@/lib/validation/schemas';

export const POST = createHandler(
  {
    auth: 'admin',
    body: orderRefundSchema,
    rateLimit: { name: 'adminWrite', by: 'user' },
  },
  async ({ body, log }) => {
    const order = await getOrderById(body.orderId);
    if (!order) {
      throw badRequest('Order not found.');
    }

    if (order.status === 'refunded') {
      return { ok: true, alreadyRefunded: true, orderId: order.id };
    }

    const result = await refundOrder(order.id, body.amountPaise, body.reason);
    if (!result.ok) {
      throw badRequest(result.error ?? 'Refund failed.');
    }

    log.info('Order refunded and download entitlement revoked', {
      orderId: order.id,
      amountPaise: body.amountPaise ?? order.total_paise,
    });

    // Send refund notice email via Brevo
    await sendEmail({
      to: order.email,
      subject: `Refund processed for order ${order.order_number}`,
      template: 'refund_notice',
      orderId: order.id,
      text: `Hello ${order.full_name || 'Reader'},\n\nYour refund for order ${order.order_number} has been processed.\n\nWarm regards,\nBookishBae`,
      html: `<p>Hello ${order.full_name || 'Reader'},</p><p>Your refund for order <strong>${order.order_number}</strong> has been processed.</p><p>Warm regards,<br>BookishBae</p>`,
    });

    return { ok: true, orderId: order.id, status: 'refunded' };
  },
);
