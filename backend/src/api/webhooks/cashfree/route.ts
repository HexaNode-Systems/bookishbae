import { confirmCashfreePayment } from '@/lib/payment-verification';
import { ApiError } from '@/lib/api/errors';
import { createHmac } from 'node:crypto';
import { badRequest, forbidden } from '@/lib/api/errors';
import { createHandler } from '@/lib/api/handler';
import { emailShell, sendEmail } from '@/lib/brevo';
import {
  parseWebhookPayload,
  redactPaymentEntity,
  verifyWebhookSignature,
} from '@/lib/cashfree';
import {
  getOrderById,
  isWebhookProcessed,
  markOrderPaid,
  recordWebhookEvent,
} from '@/lib/db/repository';
import { env } from '@/lib/env';

export const POST = createHandler(
  {
    auth: 'public',
    csrf: false,
    rawBody: true,
  },
  async ({ request, log }) => {
    const rawBody = await request.text();
    const signature =
      request.headers.get('x-webhook-signature') ||
      request.headers.get('x-cashfree-signature');
    const timestamp =
      request.headers.get('x-webhook-timestamp') ||
      request.headers.get('x-cashfree-timestamp');

    // 1. Verify Webhook Signature. Never trust an unverified payload!
    if (!signature) {
      log.warn('Cashfree webhook missing signature');
      throw forbidden('Missing webhook signature.');
    }

    const isValid = verifyWebhookSignature(rawBody, signature, timestamp);
    if (!isValid) {
      log.warn('Cashfree webhook signature mismatch');
      throw forbidden('Invalid webhook signature.');
    }

    // 2. Parse payload
    const payload = parseWebhookPayload(rawBody);
    if (!payload) {
      throw badRequest('Malformed webhook payload.');
    }

    const eventType = payload.type || 'PAYMENT_SUCCESS_WEBHOOK';
    const eventTime = payload.event_time || new Date().toISOString();
    const orderData = payload.data?.order;
    const paymentData = payload.data?.payment;

    const orderReference =
      orderData?.order_id ||
      (orderData?.order_tags?.orderId as string) ||
      '';

    const eventId =
      (paymentData?.cf_payment_id ? String(paymentData.cf_payment_id) : null) ||
      `${eventType}_${orderReference}_${eventTime}`;

    // 3. Idempotency check: replay of the same event must be a no-op
    const alreadyProcessed = await isWebhookProcessed('cashfree', eventId);
    if (alreadyProcessed) {
      log.info('Cashfree webhook event already processed, ignoring duplicate', { eventId });
      return { ok: true, duplicate: true };
    }

    log.info('Processing Cashfree webhook event', { eventType, eventId, orderReference });

    // 4. Handle event
    if (eventType === 'PAYMENT_SUCCESS_WEBHOOK' || paymentData?.payment_status === 'SUCCESS') {
      const order = await getOrderById(orderReference);

      if (order) {
        const paidAmountPaise = paymentData?.payment_amount == null
          ? null
          : Math.round(Number(paymentData.payment_amount) * 100);
        const currency = paymentData?.payment_currency || order.currency;
        if (paidAmountPaise !== order.total_paise || currency !== 'INR') {
          log.error('Cashfree payment amount/currency did not match the stored order; refusing fulfilment', {
            orderId: order.id,
            expectedAmountPaise: order.total_paise,
            receivedAmountPaise: paidAmountPaise,
            currency,
          });
        } else {
        const confirmation = await confirmCashfreePayment(order);
        if (!confirmation.paid) throw new ApiError('upstream_error', 'Cashfree has not confirmed this payment yet.');
        const paymentSnapshot = paymentData ? redactPaymentEntity(paymentData) : {};
        const paymentId = confirmation.paymentId!;
        const amountPaise = paymentData?.payment_amount
          ? Math.round(paymentData.payment_amount * 100)
          : order.total_paise;

        const paymentResult = await markOrderPaid(order.id, {
          paymentId,
          method: (paymentData?.payment_method?.type as string) || 'UPI',
          amountPaise,
          gatewaySnapshot: paymentSnapshot,
        });

        // Send confirmation email if not already sent
        if (!paymentResult.ok) {
          log.error('Paid Cashfree event could not transition the order; refusing confirmation email', {
            orderId: order.id,
          });
          throw new ApiError('upstream_error', 'The verified payment could not be committed. Please retry the webhook.');
        } else if (!paymentResult.alreadyPaid) {
          const downloadUrl = `${env.NEXT_PUBLIC_SITE_URL}/orders/${order.id}`;
          await sendEmail({
            to: order.email,
            subject: `Receipt for order ${order.order_number} — BookishBae`,
            template: 'purchase_confirmation',
            orderId: order.id,
            text: `Hello ${order.full_name || 'Reader'},\n\nThank you for your purchase! Your order ${order.order_number} has been confirmed.\n\nDownload your e-books: ${downloadUrl}\n\nWarm regards,\nBookishBae`,
            html: emailShell({
              heading: 'Thank you for your order',
              bodyHtml: `<p>Hello ${order.full_name || 'Reader'},</p><p>Your order <strong>${order.order_number}</strong> is confirmed and ready in your library.</p>`,
              ctaLabel: 'Download your e-books',
              ctaHref: downloadUrl,
            }),
          });
        }
        }
      } else {
        log.warn('Order referenced in webhook was not found', { orderReference });
        throw badRequest('The referenced order could not be found.');
      }
    }

    // 5. Record processed webhook event for idempotency
    await recordWebhookEvent({
      provider: 'cashfree',
      eventId,
      eventType,
      payload,
      processedAt: new Date().toISOString(),
    });

    return { ok: true };
  },
);
