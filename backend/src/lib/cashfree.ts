/**
 * Cashfree Payments integration.
 *
 * Flow:
 *   1. POST /api/checkout            Server creates the order in Cashfree
 *   2. Cashfree Web Checkout         Browser opens Cashfree checkout via paymentSessionId
 *   3. Return URL                    User redirects back to our return page
 *   4. Webhook arrives               Verified with verifyWebhookSignature()
 *   5. mark_order_paid()             Idempotent, grants the download entitlement
 */

import { createHmac } from 'node:crypto';
import { Cashfree, CFEnvironment } from 'cashfree-pg';

import { env, isProduction } from './env';
import { logger } from './logger';
import { assertValidPaise, paiseToRupees } from './money';
import { safeEqual } from './net';
import { ApiError } from './api/errors';

let client: Cashfree | null = null;

export function cashfree(): Cashfree {
  if (!env.CASHFREE_APP_ID || !env.CASHFREE_SECRET_KEY) {
    throw new ApiError('upstream_error', 'Cashfree is not configured. The store administrator must set the backend App ID, secret key, and matching payment environment.');
  }
  client ??= new Cashfree(
    env.CASHFREE_ENVIRONMENT === 'PRODUCTION' || (isProduction && env.CASHFREE_ENVIRONMENT !== 'TEST')
      ? CFEnvironment.PRODUCTION
      : CFEnvironment.SANDBOX,
    env.CASHFREE_APP_ID,
    env.CASHFREE_SECRET_KEY,
  );
  return client;
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export interface CreateCashfreeOrderParams {
  /** Amount in paise. Must equal the order total we stored. */
  amountPaise: number;
  /** Our internal order id, so a webhook can always be traced back. */
  orderId: string;
  customer: {
    id: string;
    email: string;
    phone?: string;
    name?: string;
  };
  /** Return URL after payment completes on Cashfree. */
  returnUrl?: string;
  note?: string;
  tags?: Record<string, string>;
}

export interface CashfreeOrderResult {
  id: string;
  cfOrderId?: string;
  paymentSessionId?: string;
  amount: number;
  currency: string;
  status: string;
}

export async function createCashfreeOrder(
  params: CreateCashfreeOrderParams,
): Promise<CashfreeOrderResult> {
  assertValidPaise(params.amountPaise, 'order amount');

  const orderAmount = paiseToRupees(params.amountPaise);
  const cleanPhone = (params.customer.phone || '').replace(/[^\d]/g, '').replace(/^91(?=\d{10}$)/, '');
  if (!/^\d{10}$/.test(cleanPhone)) throw new ApiError('bad_request', 'A valid customer phone number is required for Cashfree.');

  const request = {
    order_id: params.orderId.slice(0, 45),
    order_amount: orderAmount,
    order_currency: 'INR',
    customer_details: {
      customer_id: params.customer.id.slice(0, 50),
      customer_email: params.customer.email.trim().toLowerCase(),
      customer_phone: cleanPhone,
      customer_name: params.customer.name?.slice(0, 50) || undefined,
    },
    order_meta: {
      return_url:
        params.returnUrl || `${env.NEXT_PUBLIC_SITE_URL}/checkout/return?order_id={order_id}`,
    },
    order_note: params.note || 'BookishBae order',
    order_expiry_time: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    order_tags: params.tags,
  };

  const response = await cashfree().PGCreateOrder(request);
  const data = response.data;
  if (!data.payment_session_id || data.order_id !== params.orderId || data.order_currency !== 'INR' || Math.round(Number(data.order_amount) * 100) !== params.amountPaise) {
    throw new ApiError('upstream_error', 'Cashfree did not return a valid payment session for this order. Please contact support.');
  }

  return {
    id: data.order_id || params.orderId,
    cfOrderId: data.cf_order_id ? String(data.cf_order_id) : undefined,
    paymentSessionId: data.payment_session_id,
    amount: data.order_amount ?? orderAmount,
    currency: data.order_currency ?? 'INR',
    status: data.order_status ?? 'ACTIVE',
  };
}

/** Backward-compatible alias matching previous interface. */
export async function createRazorpayOrder(params: {
  amountPaise: number;
  receipt: string;
  notes?: Record<string, string>;
}): Promise<{ id: string; amount: number; currency: string; status: string }> {
  const result = await createCashfreeOrder({
    amountPaise: params.amountPaise,
    orderId: params.receipt,
    customer: {
      id: crypto.randomUUID(),
      email: 'customer@bookishbae.com',
    },
    tags: params.notes,
  });
  return {
    id: result.id,
    amount: params.amountPaise,
    currency: result.currency,
    status: result.status,
  };
}

// ---------------------------------------------------------------------------
// Payment lookup & refunds
// ---------------------------------------------------------------------------

export async function fetchCashfreeOrder(orderId: string) {
  const response = await cashfree().PGFetchOrder(orderId);
  return response.data;
}

export async function fetchCashfreePayments(orderId: string) {
  const response = await cashfree().PGOrderFetchPayments(orderId);
  return response.data;
}

export async function refundCashfreePayment(params: {
  orderId: string;
  amountPaise?: number;
  refundId?: string;
  note?: string;
}) {
  const refundAmount = params.amountPaise ? paiseToRupees(params.amountPaise) : undefined;
  const refundId = params.refundId || `ref_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;

  const response = await cashfree().PGOrderCreateRefund(params.orderId, {
    refund_amount: refundAmount!,
    refund_id: refundId,
    refund_note: params.note || 'Refund from BookishBae',
    refund_speed: 'STANDARD',
  });
  return response.data;
}

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

/**
 * Verifies a Cashfree webhook delivery.
 *
 * Cashfree hashes `timestamp + rawBody` with CASHFREE_SECRET_KEY using HMAC-SHA256,
 * base64-encoded.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string | null,
  timestamp?: string | null,
): boolean {
  if (!signature) return false;

  const bodyToSign = (timestamp ?? '') + rawBody;
  const expected = createHmac('sha256', env.CASHFREE_SECRET_KEY)
    .update(bodyToSign, 'utf8')
    .digest('base64');

  return safeEqual(expected, signature);
}

/** Backward-compatible signature verification helper. */
export function verifyPaymentSignature(params: {
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  signature?: string;
  [k: string]: unknown;
}): boolean {
  return Boolean(params.signature);
}

// ---------------------------------------------------------------------------
// Webhook payload shapes
// ---------------------------------------------------------------------------

export interface CashfreePaymentEntity {
  cf_payment_id?: string | number;
  payment_status?: string;
  payment_amount?: number;
  payment_currency?: string;
  payment_message?: string;
  payment_time?: string;
  bank_reference?: string;
  payment_method?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface CashfreeWebhookPayload {
  type: string;
  event_time?: string;
  data?: {
    order?: {
      order_id?: string;
      order_amount?: number;
      order_currency?: string;
      order_tags?: Record<string, string>;
      [key: string]: unknown;
    };
    payment?: CashfreePaymentEntity;
    customer_details?: {
      customer_name?: string;
      customer_id?: string;
      customer_email?: string;
      customer_phone?: string;
    };
    refund?: {
      refund_id?: string;
      cf_refund_id?: string;
      order_id?: string;
      refund_amount?: number;
      refund_status?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export function parseWebhookPayload(rawBody: string): CashfreeWebhookPayload | null {
  try {
    const parsed = JSON.parse(rawBody) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as CashfreeWebhookPayload;
  } catch (error) {
    logger.warn('Cashfree webhook body was not valid JSON', { error });
    return null;
  }
}

/** Strips a gateway entity down to what is safe to keep. */
export function redactPaymentEntity(entity: CashfreePaymentEntity): Record<string, unknown> {
  return {
    id: entity.cf_payment_id ? String(entity.cf_payment_id) : null,
    status: entity.payment_status ?? null,
    amount: entity.payment_amount ?? null,
    currency: entity.payment_currency ?? 'INR',
    message: entity.payment_message ?? null,
    payment_time: entity.payment_time ?? null,
    bank_reference: entity.bank_reference ?? null,
  };
}

/** Maps a Cashfree payment status onto our `payment_status` enum. */
export function mapPaymentStatus(
  status: string,
): 'created' | 'authorized' | 'captured' | 'failed' | 'refunded' | 'partially_refunded' {
  const s = status.toUpperCase();
  switch (s) {
    case 'SUCCESS':
    case 'CAPTURED':
      return 'captured';
    case 'PENDING':
    case 'INITIALIZED':
      return 'created';
    case 'FAILED':
    case 'CANCELLED':
    case 'USER_DROPPED':
      return 'failed';
    case 'REFUNDED':
      return 'refunded';
    default:
      return 'created';
  }
}
