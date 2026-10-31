import { badRequest } from '@/lib/api/errors';
import { createHandler } from '@/lib/api/handler';
import { emailShell, sendEmail } from '@/lib/brevo';
import { getOrderById } from '@/lib/db/repository';
import { env } from '@/lib/env';
import { resendDownloadEmailSchema } from '@/lib/validation/schemas';

export const POST = createHandler(
  {
    auth: 'admin',
    body: resendDownloadEmailSchema,
    rateLimit: { name: 'adminWrite', by: 'user' },
  },
  async ({ body, log }) => {
    const order = await getOrderById(body.orderId);
    if (!order) {
      throw badRequest('Order not found.');
    }

    if (order.status !== 'paid') {
      throw badRequest('Only paid orders can receive download link emails.');
    }

    const downloadLink = `${env.NEXT_PUBLIC_SITE_URL}/orders/${order.id}`;

    const emailResult = await sendEmail({
      to: order.email,
      subject: `Your BookishBae e-book download links (Order ${order.order_number})`,
      template: 'download_links',
      orderId: order.id,
      text: `Hello ${order.full_name || 'Reader'},\n\nHere are your e-book download links for order ${order.order_number}.\n\nAccess your books: ${downloadLink}\n\nWarm regards,\nBookishBae`,
      html: emailShell({
        heading: 'Your e-book is ready',
        bodyHtml: `<p>Hello ${order.full_name || 'Reader'},</p><p>Thank you for your purchase. You can download your e-books anytime from your library.</p>`,
        ctaLabel: 'Download your e-books',
        ctaHref: downloadLink,
      }),
    });

    log.info('Resent download links email', {
      orderId: order.id,
      email: order.email,
      sent: emailResult.sent,
    });

    return { ok: true, sent: emailResult.sent, providerId: emailResult.providerId };
  },
);
