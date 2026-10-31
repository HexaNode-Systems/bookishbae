import assert from 'node:assert';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { NextRequest } from 'next/server';

// Route Handlers
import * as adminProductsRoute from '../src/api/admin/products/route';
import * as adminProductDetailRoute from '../src/api/admin/products/[id]/route';
import * as adminOrdersRoute from '../src/api/admin/orders/route';
import * as adminOrderDetailRoute from '../src/api/admin/orders/[id]/route';
import * as adminOrderDownloadsRoute from '../src/api/admin/orders/downloads/route';
import * as adminOrderRefundRoute from '../src/api/admin/orders/refund/route';
import * as adminUploadPresignRoute from '../src/api/admin/uploads/presign/route';
import * as adminUploadsRoute from '../src/api/admin/uploads/route';
import * as adminIntegrationsRoute from '../src/api/admin/integrations/status/route';
import * as productsRoute from '../src/api/products/route';
import * as productSlugRoute from '../src/api/products/[slug]/route';
import * as checkoutRoute from '../src/api/checkout/route';
import * as checkoutVerifyRoute from '../src/api/checkout/verify/route';
import * as cashfreeWebhookRoute from '../src/api/webhooks/cashfree/route';
import * as razorpayWebhookRoute from '../src/api/webhooks/razorpay/route';
import * as downloadRoute from '../src/api/download/route';
import * as couponRoute from '../src/api/coupons/validate/route';
import * as newsletterRoute from '../src/api/newsletter/route';

import { env } from '../src/lib/env';
import { SEED_BOOK_IDS } from '../src/lib/db/repository';
import { createProduct, updateProduct, getProductByIdOrSlug } from '../src/lib/db/repository';
import { publicUrl } from '../src/lib/cloudinary';
import { storedObjects } from './storage-fixture';
import { setGatewayPaid } from './payment-fixture';

(process.env as Record<string, string | undefined>).NODE_ENV = 'test';

const LONG_AFTERNOON_ID = SEED_BOOK_IDS['the-long-afternoon']!;

// Helper to construct NextRequest for testing
function makeReq(
  url: string,
  options: {
    method?: string;
    role?: 'admin' | 'customer' | 'none';
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): NextRequest {
  const method = options.method ?? (options.body ? 'POST' : 'GET');
  if (url.endsWith('/api/checkout') && options.body && !Object.prototype.hasOwnProperty.call(options.body, 'phone')) {
    options.body = { phone: '9876543210', ...(options.body as object) };
  }
  const headers = new Headers({
    origin: 'http://localhost:3000',
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers ?? {}),
  });

  if (options.role && options.role !== 'none') {
    headers.set('x-test-role', options.role);
  }

  return new NextRequest(url, {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
}

// ---------------------------------------------------------------------------
// 1. Admin Authentication & Authorization
// ---------------------------------------------------------------------------
test('Admin Auth: refuses unauthenticated requests with 401', async () => {
  const req = makeReq('http://localhost:3000/api/admin/products', { role: 'none' });
  const res = await adminProductsRoute.GET(req);
  assert.strictEqual(res.status, 401);
  const data = await res.json();
  assert.strictEqual(data.error?.code, 'unauthenticated');
});

test('Admin Auth: refuses customer requests to admin endpoints with 403', async () => {
  const req = makeReq('http://localhost:3000/api/admin/products', { role: 'customer' });
  const res = await adminProductsRoute.GET(req);
  assert.strictEqual(res.status, 403);
  const data = await res.json();
  assert.strictEqual(data.error?.code, 'forbidden');
});

test('Admin Auth: allows admin requests to admin endpoints with 200', async () => {
  const req = makeReq('http://localhost:3000/api/admin/products', { role: 'admin' });
  const res = await adminProductsRoute.GET(req);
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.ok(Array.isArray(data.products));
  assert.ok(data.total >= 3);
});

test('Admin Auth: refuses customer access to admin orders with 403', async () => {
  const req = makeReq('http://localhost:3000/api/admin/orders', { role: 'customer' });
  const res = await adminOrdersRoute.GET(req);
  assert.strictEqual(res.status, 403);
});

// ---------------------------------------------------------------------------
// 2. Book Catalogue Operations & Private Keys Protection
// ---------------------------------------------------------------------------
test('Catalogue: public browse never exposes main_pdf_key', async () => {
  const req = makeReq('http://localhost:3000/api/products');
  const res = await productsRoute.GET(req);
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.ok(data.products.length >= 3);
  for (const book of data.products) {
    assert.strictEqual('main_pdf_key' in book, false, 'Public book must not leak main_pdf_key');
    assert.ok(book.title);
    assert.ok(book.price_paise > 0);
  }
});

test('Catalogue: public get by slug retrieves published book', async () => {
  const req = makeReq('http://localhost:3000/api/products/the-long-afternoon');
  const res = await productSlugRoute.GET(req, { params: { slug: 'the-long-afternoon' } });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.product.slug, 'the-long-afternoon');
  assert.strictEqual('main_pdf_key' in data.product, false);
});

test('Catalogue: admin create book enforces validation (discount price must be below price)', async () => {
  const invalidBook = {
    title: 'Test Invalid Book',
    slug: 'test-invalid-book',
    description: 'This is a test description for an invalid book.',
    pricePaise: 20000,
    discountPricePaise: 25000, // Invalid: discount price is higher than regular price
    status: 'draft',
    authorName: 'Annu',
  };
  const req = makeReq('http://localhost:3000/api/admin/products', {
    role: 'admin',
    body: invalidBook,
  });
  const res = await adminProductsRoute.POST(req);
  assert.strictEqual(res.status, 422);
  const data = await res.json();
  assert.strictEqual(data.error?.code, 'validation_failed');
});

test('Catalogue: admin create, read, update, and delete a book', async () => {
  const newBookSlug = `flow-test-book-${Date.now()}`;
  const newBook = {
    title: 'Flow Test Novella',
    slug: newBookSlug,
    subtitle: 'A novella of quiet hours',
    description: 'A complete test book description that fulfills length requirements.',
    excerpt: 'An excerpt of the flow test novella.',
    authorName: 'Annu',
    pricePaise: 29900,
    discountPricePaise: 19900,
    pageCount: 120,
    status: 'draft',
    isFeatured: false,
  };

  // 1. Create
  const createReq = makeReq('http://localhost:3000/api/admin/products', {
    role: 'admin',
    body: newBook,
  });
  const createRes = await adminProductsRoute.POST(createReq);
  assert.strictEqual(createRes.status, 200);
  const createdData = await createRes.json();
  assert.ok(createdData.product.id);
  const productId = createdData.product.id;

  // 2. Read
  const readReq = makeReq(`http://localhost:3000/api/admin/products/${productId}`, {
    role: 'admin',
  });
  const readRes = await adminProductDetailRoute.GET(readReq, { params: { id: productId } });
  assert.strictEqual(readRes.status, 200);
  const readData = await readRes.json();
  assert.strictEqual(readData.product.title, 'Flow Test Novella');

  // 3. Update
  const updateReq = makeReq(`http://localhost:3000/api/admin/products/${productId}`, {
    method: 'PATCH',
    role: 'admin',
    body: { title: 'Flow Test Novella (Revised)', pricePaise: 34900 },
  });
  const updateRes = await adminProductDetailRoute.PATCH(updateReq, { params: { id: productId } });
  assert.strictEqual(updateRes.status, 200);
  const updateData = await updateRes.json();
  assert.strictEqual(updateData.product.title, 'Flow Test Novella (Revised)');
  assert.strictEqual(updateData.product.price_paise, 34900);

  // 4. Delete
  const deleteReq = makeReq(`http://localhost:3000/api/admin/products/${productId}`, {
    method: 'DELETE',
    role: 'admin',
  });
  const deleteRes = await adminProductDetailRoute.DELETE(deleteReq, { params: { id: productId } });
  assert.strictEqual(deleteRes.status, 200);
  const deleteData = await deleteRes.json();
  assert.strictEqual(deleteData.ok, true);
});

// ---------------------------------------------------------------------------
// 3. Upload Presigning & Security
// ---------------------------------------------------------------------------
test('Uploads: refuses executable or disallowed mime types', async () => {
  const req = makeReq('http://localhost:3000/api/admin/uploads/presign', {
    role: 'admin',
    body: {
      purpose: 'cover',
      productId: LONG_AFTERNOON_ID,
      contentType: 'application/x-msdownload',
      contentLength: 1024 * 50,
    },
  });
  const res = await adminUploadPresignRoute.POST(req);
  assert.strictEqual(res.status, 422);
});

test('Uploads: refuses cover images larger than 5 MB', async () => {
  const req = makeReq('http://localhost:3000/api/admin/uploads/presign', {
    role: 'admin',
    body: {
      purpose: 'cover',
      productId: LONG_AFTERNOON_ID,
      contentType: 'image/png',
      contentLength: 6 * 1024 * 1024, // 6 MB (max allowed is 5 MB)
    },
  });
  const res = await adminUploadPresignRoute.POST(req);
  assert.strictEqual(res.status, 422);
});

test('Uploads: accepts valid cover upload and returns presigned parameters without secrets', async () => {
  const req = makeReq('http://localhost:3000/api/admin/uploads/presign', {
    role: 'admin',
    body: {
      purpose: 'cover',
      productId: LONG_AFTERNOON_ID,
      contentType: 'image/png',
      contentLength: 1024 * 500, // 500 KB
    },
  });
  const res = await adminUploadPresignRoute.POST(req);
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.ok(data.uploadUrl);
  assert.ok(data.key);
  assert.strictEqual('api_secret' in (data.fields || {}), false, 'Never return API secret');
});

// ---------------------------------------------------------------------------
// 4. Checkout, Server-side Pricing, & Coupon Application
// ---------------------------------------------------------------------------
test('Checkout: rejects client-supplied price or amount (tampering prevention)', async () => {
  const tamperedPayload = {
    productId: LONG_AFTERNOON_ID,
    email: 'reader@example.com',
    fullName: 'Test Reader',
    price: 1, // Tampered price injection
    amountPaise: 100, // Tampered paise injection
  };
  const req = makeReq('http://localhost:3000/api/checkout', {
    body: tamperedPayload,
  });
  const res = await checkoutRoute.POST(req);
  assert.strictEqual(res.status, 422, 'Strict schema must reject injected amount fields');
});

test('Checkout: creates order with server-calculated price from catalog', async () => {
  const validPayload = {
    productId: LONG_AFTERNOON_ID,
    email: 'reader@example.com',
    fullName: 'Test Reader',
  };
  const req = makeReq('http://localhost:3000/api/checkout', {
    body: validPayload,
  });
  const res = await checkoutRoute.POST(req);
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.ok(data.orderId);
  assert.ok(data.orderNumber);
  // Catalog price for The Long Afternoon is 29900 paise (₹299)
  assert.strictEqual(data.amountPaise, 29900);
  assert.strictEqual(data.currency, 'INR');
});

test('Checkout: applies valid coupon LAUNCH50 server-side (50% off)', async () => {
  const payloadWithCoupon = {
    productId: LONG_AFTERNOON_ID,
    email: 'reader@example.com',
    fullName: 'Discounted Reader',
    couponCode: 'LAUNCH50',
  };
  const req = makeReq('http://localhost:3000/api/checkout', {
    body: payloadWithCoupon,
  });
  const res = await checkoutRoute.POST(req);
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  // 50% discount on 29900 paise = 14950 paise
  assert.strictEqual(data.amountPaise, 14950);
});

// ---------------------------------------------------------------------------
// 5. Payment Verification & Webhook Signature Verification
// ---------------------------------------------------------------------------
test('Webhook: rejects Cashfree webhook with missing or wrong signature', async () => {
  const rawPayload = JSON.stringify({
    type: 'PAYMENT_SUCCESS_WEBHOOK',
    data: { order: { order_id: 'BB-FAKE-ORDER' } },
  });

  // Missing signature
  const missingReq = new NextRequest('http://localhost:3000/api/webhooks/cashfree', {
    method: 'POST',
    body: rawPayload,
  });
  const missingRes = await cashfreeWebhookRoute.POST(missingReq);
  assert.strictEqual(missingRes.status, 403);

  // Wrong signature
  const wrongReq = new NextRequest('http://localhost:3000/api/webhooks/cashfree', {
    method: 'POST',
    headers: {
      'x-webhook-signature': 'invalid-signature-value',
      'x-webhook-timestamp': String(Date.now()),
    },
    body: rawPayload,
  });
  const wrongRes = await cashfreeWebhookRoute.POST(wrongReq);
  assert.strictEqual(wrongRes.status, 403);
});

test('Webhook: fulfills paid order when Cashfree webhook has valid signature', async () => {
  // 1. Create order
  const checkoutRes = await checkoutRoute.POST(
    makeReq('http://localhost:3000/api/checkout', {
      body: {
        productId: LONG_AFTERNOON_ID,
        email: 'paidbuyer@example.com',
        fullName: 'Paid Buyer',
      },
    }),
  );
  const checkoutData = await checkoutRes.json();
  const orderId = checkoutData.orderId;
  const orderNumber = checkoutData.orderNumber;

  // 2. Build signed Cashfree webhook payload
  const timestamp = String(Math.floor(Date.now() / 1000));
  const webhookBody = JSON.stringify({
    type: 'PAYMENT_SUCCESS_WEBHOOK',
    event_time: new Date().toISOString(),
    data: {
      order: {
        order_id: orderNumber,
        order_amount: 299,
        order_tags: { orderId },
      },
      payment: {
        cf_payment_id: `pay_${Date.now()}`,
        payment_status: 'SUCCESS',
        payment_amount: 299,
        payment_currency: 'INR',
        payment_method: { type: 'UPI' },
      },
    },
  });

  const bodyToSign = timestamp + webhookBody;
  const signature = createHmac('sha256', env.CASHFREE_SECRET_KEY)
    .update(bodyToSign, 'utf8')
    .digest('base64');

  const webhookReq = new NextRequest('http://localhost:3000/api/webhooks/cashfree', {
    method: 'POST',
    headers: {
      'x-webhook-signature': signature,
      'x-webhook-timestamp': timestamp,
    },
    body: webhookBody,
  });

  setGatewayPaid(orderNumber);
  const webhookRes = await cashfreeWebhookRoute.POST(webhookReq);
  assert.strictEqual(webhookRes.status, 200);

  // 3. Verify order is now paid via admin orders
  const orderReq = makeReq(`http://localhost:3000/api/admin/orders/${orderId}`, {
    role: 'admin',
  });
  const orderRes = await adminOrderDetailRoute.GET(orderReq, { params: { id: orderId } });
  assert.strictEqual(orderRes.status, 200);
  const orderData = await orderRes.json();
  assert.strictEqual(orderData.order.status, 'paid');
  assert.ok(orderData.order.paid_at);

  // 4. Verify replaying the webhook event is an idempotent no-op
  const replayReq = new NextRequest('http://localhost:3000/api/webhooks/cashfree', {
    method: 'POST',
    headers: {
      'x-webhook-signature': signature,
      'x-webhook-timestamp': timestamp,
    },
    body: webhookBody,
  });
  const replayRes = await cashfreeWebhookRoute.POST(replayReq);
  assert.strictEqual(replayRes.status, 200);
  const replayData = await replayRes.json();
  assert.strictEqual(replayData.duplicate, true);
});

test('Webhook: retired Razorpay endpoint rejects all requests', async () => {
  const req = new NextRequest('http://localhost:3000/api/webhooks/razorpay', {
    method: 'POST',
    headers: { 'x-razorpay-signature': 'bad-signature' },
    body: JSON.stringify({ event: 'payment.captured' }),
  });
  const res = await razorpayWebhookRoute.POST(req);
  assert.strictEqual(res.status, 410);
});

test('Webhook: refuses fulfilment when Cashfree amount differs from order total', async () => {
  const checkoutRes = await checkoutRoute.POST(
    makeReq('http://localhost:3000/api/checkout', {
      body: {
        productId: LONG_AFTERNOON_ID,
        email: 'mismatchbuyer@example.com',
        fullName: 'Mismatch Buyer',
      },
    }),
  );
  const { orderId, orderNumber } = await checkoutRes.json();
  const timestamp = String(Math.floor(Date.now() / 1000));
  const webhookBody = JSON.stringify({
    type: 'PAYMENT_SUCCESS_WEBHOOK',
    event_time: new Date().toISOString(),
    data: {
      order: { order_id: orderNumber },
      payment: {
        cf_payment_id: `mismatch_${Date.now()}`,
        payment_status: 'SUCCESS',
        payment_amount: 1,
        payment_currency: 'INR',
      },
    },
  });
  const signature = createHmac('sha256', env.CASHFREE_SECRET_KEY)
    .update(timestamp + webhookBody, 'utf8')
    .digest('base64');
  const res = await cashfreeWebhookRoute.POST(new NextRequest('http://localhost:3000/api/webhooks/cashfree', {
    method: 'POST',
    headers: { 'x-webhook-signature': signature, 'x-webhook-timestamp': timestamp },
    body: webhookBody,
  }));
  assert.strictEqual(res.status, 200);

  const orderRes = await adminOrderDetailRoute.GET(
    makeReq(`http://localhost:3000/api/admin/orders/${orderId}`, { role: 'admin' }),
    { params: { id: orderId } },
  );
  const orderData = await orderRes.json();
  assert.strictEqual(orderData.order.status, 'pending');
});

// ---------------------------------------------------------------------------
// 6. Downloads & Entitlement Security
// ---------------------------------------------------------------------------
test('Downloads: sample PDF is downloadable without purchase or auth', async () => {
  const req = makeReq('http://localhost:3000/api/download', {
    body: { productId: LONG_AFTERNOON_ID, kind: 'sample' },
  });
  const res = await downloadRoute.POST(req);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.headers.get('content-type'), 'application/pdf');
  assert.match(res.headers.get('content-disposition')!, /attachment; filename=".*-sample\.pdf"/);
  assert.strictEqual(Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
});

test('Downloads: full e-book refused with 401 when unauthenticated', async () => {
  const req = makeReq('http://localhost:3000/api/download', {
    role: 'none',
    body: { productId: LONG_AFTERNOON_ID, kind: 'full' },
  });
  const res = await downloadRoute.POST(req);
  assert.strictEqual(res.status, 401);
});

test('Downloads: full e-book refused with 403 for user who has not purchased', async () => {
  const req = makeReq('http://localhost:3000/api/download', {
    role: 'customer',
    body: { productId: LONG_AFTERNOON_ID, kind: 'full' },
  });
  const res = await downloadRoute.POST(req);
  assert.strictEqual(res.status, 403);
  const data = await res.json();
  assert.strictEqual(data.error?.code, 'forbidden');
});

// ---------------------------------------------------------------------------
// 7. Order Status Updates & Refunds
// ---------------------------------------------------------------------------
test('Order Management: admin can update download limit override', async () => {
  // Create an order
  const checkoutRes = await checkoutRoute.POST(
    makeReq('http://localhost:3000/api/checkout', {
      body: {
        productId: LONG_AFTERNOON_ID,
        email: 'overridetest@example.com',
        fullName: 'Override Test',
      },
    }),
  );
  const checkoutData = await checkoutRes.json();
  const orderRes = await adminOrderDetailRoute.GET(
    makeReq(`http://localhost:3000/api/admin/orders/${checkoutData.orderId}`, { role: 'admin' }),
    { params: { id: checkoutData.orderId } },
  );
  const orderData = await orderRes.json();
  const orderItemId = orderData.order.items[0].id;

  const patchReq = makeReq('http://localhost:3000/api/admin/orders/downloads', {
    method: 'PATCH',
    role: 'admin',
    body: { orderItemId, downloadLimitOverride: 15 },
  });
  const patchRes = await adminOrderDownloadsRoute.PATCH(patchReq);
  assert.strictEqual(patchRes.status, 200);
  const patchData = await patchRes.json();
  assert.strictEqual(patchData.override, 15);
});

test('Order Management: refund marks order as refunded', async () => {
  const checkoutRes = await checkoutRoute.POST(
    makeReq('http://localhost:3000/api/checkout', {
      body: {
        productId: LONG_AFTERNOON_ID,
        email: 'refundme@example.com',
        fullName: 'Refund Buyer',
      },
    }),
  );
  const checkoutData = await checkoutRes.json();

  const refundReq = makeReq('http://localhost:3000/api/admin/orders/refund', {
    role: 'admin',
    body: { orderId: checkoutData.orderId, reason: 'Customer requested refund' },
  });
  const refundRes = await adminOrderRefundRoute.POST(refundReq);
  assert.strictEqual(refundRes.status, 200);
  const refundData = await refundRes.json();
  assert.strictEqual(refundData.status, 'refunded');

  // Verify status is refunded
  const orderRes = await adminOrderDetailRoute.GET(
    makeReq(`http://localhost:3000/api/admin/orders/${checkoutData.orderId}`, { role: 'admin' }),
    { params: { id: checkoutData.orderId } },
  );
  const orderData = await orderRes.json();
  assert.strictEqual(orderData.order.status, 'refunded');
});

// ---------------------------------------------------------------------------
// 8. Integration Security (Zero credentials leaked to client)
// ---------------------------------------------------------------------------
test('Security: integrations endpoint returns status without exposing secrets', async () => {
  const req = makeReq('http://localhost:3000/api/admin/integrations/status', { role: 'admin' });
  const res = await adminIntegrationsRoute.GET(req);
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  const rawText = JSON.stringify(data);

  assert.strictEqual(rawText.includes(env.CASHFREE_SECRET_KEY), false, 'Must not leak Cashfree secret');
  assert.strictEqual(rawText.includes(env.SUPABASE_SERVICE_ROLE_KEY), false, 'Must not leak Service Role key');
  assert.strictEqual(rawText.includes(env.CLOUDINARY_API_SECRET), false, 'Must not leak Cloudinary secret');
  assert.strictEqual(rawText.includes(env.BREVO_API_KEY), false, 'Must not leak Brevo key');
  assert.ok(data.integrations.cashfree.configured);
  assert.ok(data.integrations.supabase.configured);
});

// ---------------------------------------------------------------------------
// 9. Newsletter & Coupons
// ---------------------------------------------------------------------------
test('Public: newsletter subscription succeeds with valid email', async () => {
  const req = makeReq('http://localhost:3000/api/newsletter', {
    body: { email: 'subscriber@example.com' },
  });
  const res = await newsletterRoute.POST(req);
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.ok, true);
});

test('Public: coupon validation validates code and returns discount', async () => {
  const req = makeReq('http://localhost:3000/api/coupons/validate', {
    body: { code: 'LAUNCH50', productId: LONG_AFTERNOON_ID },
  });
  const res = await couponRoute.POST(req);
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.valid, true);
  assert.strictEqual(data.discountType, 'percent');
  assert.strictEqual(data.discountValue, 50);
});

// ---------------------------------------------------------------------------
// 10. Purchase Verification & Secure Claim Token Download Flow
// ---------------------------------------------------------------------------
test('Checkout & Verify: verified paid order issues secure download token and permits full e-book download', async () => {
  // 1. Create order
  const checkoutRes = await checkoutRoute.POST(
    makeReq('http://localhost:3000/api/checkout', {
      body: {
        productId: LONG_AFTERNOON_ID,
        email: 'tokenbuyer@example.com',
        fullName: 'Token Buyer',
      },
    }),
  );
  assert.strictEqual(checkoutRes.status, 200);
  const checkoutData = await checkoutRes.json();
  assert.ok(checkoutData.orderId);

  // 2. Simulate payment success via webhook to mark it paid
  const webhookBody = JSON.stringify({
    type: 'PAYMENT_SUCCESS_WEBHOOK',
    event_time: new Date().toISOString(),
    data: {
      order: {
        order_id: checkoutData.orderNumber,
        order_amount: 299,
        order_currency: 'INR',
        order_tags: { orderId: checkoutData.orderId },
      },
      payment: {
        cf_payment_id: Date.now(),
        payment_status: 'SUCCESS',
        payment_amount: 299,
        payment_currency: 'INR',
        payment_method: { type: 'UPI' },
      },
    },
  });
  const ts = Math.floor(Date.now() / 1000).toString();
  const sig = createHmac('sha256', env.CASHFREE_SECRET_KEY)
    .update(ts + webhookBody)
    .digest('base64');

  setGatewayPaid(checkoutData.orderNumber);
  const whRes = await cashfreeWebhookRoute.POST(
    new NextRequest('http://localhost:3000/api/webhooks/cashfree', {
      method: 'POST',
      headers: {
        'x-webhook-signature': sig,
        'x-webhook-timestamp': ts,
      },
      body: webhookBody,
    }),
  );
  assert.strictEqual(whRes.status, 200);

  // 3. Verify payment via server-to-server verify endpoint
  const verifyRes = await checkoutVerifyRoute.POST(
    makeReq('http://localhost:3000/api/checkout/verify', {
      body: { orderId: checkoutData.orderId },
    }),
  );
  assert.strictEqual(verifyRes.status, 200);
  const verifyData = await verifyRes.json();
  assert.strictEqual(verifyData.verified, true);
  assert.strictEqual(verifyData.paid, true);
  assert.ok(verifyData.downloadToken, 'Must issue a secure downloadToken upon verified payment');

  // 4. Download full e-book anonymously using downloadToken
  const downloadRes = await downloadRoute.POST(
    makeReq('http://localhost:3000/api/download', {
      role: 'none',
      body: {
        productId: LONG_AFTERNOON_ID,
        kind: 'full',
        token: verifyData.downloadToken,
      },
    }),
  );
  assert.strictEqual(downloadRes.status, 200);
  const dlData = await downloadRes.json();
  assert.ok(dlData.url, 'Must provide presigned download URL');
  assert.strictEqual(dlData.downloadsUsed, 1);

  // 5. Tampered token must be rejected with 401
  const tamperedRes = await downloadRoute.POST(
    makeReq('http://localhost:3000/api/download', {
      role: 'none',
      body: {
        productId: LONG_AFTERNOON_ID,
        kind: 'full',
        token: verifyData.downloadToken + 'bad',
      },
    }),
  );
  assert.strictEqual(tamperedRes.status, 401);
});

test('Catalogue: dynamic status toggle from admin immediately reflects in public storefront catalogue', async () => {
  // 1. Create a draft book as admin
  const testSlug = `toggle-test-${Date.now()}`;
  const createRes = await adminProductsRoute.POST(
    makeReq('http://localhost:3000/api/admin/products', {
      role: 'admin',
      body: {
        title: 'Status Toggle Book',
        slug: testSlug,
        description: 'Test description for status toggle book.',
        pricePaise: 19900,
        coverKey: 'covers/test-cover.png',
        mainPdfKey: 'books/test-main.pdf',
        status: 'draft',
      },
    }),
  );
  assert.strictEqual(createRes.status, 200);
  const { product } = await createRes.json();

  // 2. Draft product must not appear on public /api/products
  const publicList1 = await productsRoute.GET(makeReq('http://localhost:3000/api/products'));
  const data1 = await publicList1.json();
  assert.strictEqual(data1.products.some((p: any) => p.slug === testSlug), false);

  // 3. Admin updates status to published
  const patchRes = await adminProductDetailRoute.PATCH(
    makeReq(`http://localhost:3000/api/admin/products/${product.id}`, {
      method: 'PATCH',
      role: 'admin',
      body: { status: 'published' },
    }),
    { params: { id: product.id } },
  );
  assert.strictEqual(patchRes.status, 200);

  // 4. Public storefront /api/products now immediately includes the published book
  const publicList2 = await productsRoute.GET(makeReq('http://localhost:3000/api/products'));
  const data2 = await publicList2.json();
  assert.strictEqual(data2.products.some((p: any) => p.slug === testSlug), true);

  // Cleanup: delete book
  await adminProductDetailRoute.DELETE(
    makeReq(`http://localhost:3000/api/admin/products/${product.id}`, {
      method: 'DELETE',
      role: 'admin',
    }),
    { params: { id: product.id } },
  );
});

// ---------------------------------------------------------------------------
// 9. Multipart Uploads, Cover Mapping, & PDF Storage Isolation Tests
// ---------------------------------------------------------------------------

function makeMultipartReq(
  url: string,
  form: FormData,
  role: 'admin' | 'customer' | 'none' = 'admin',
): NextRequest {
  const headers = new Headers({
    origin: 'http://localhost:3000',
    'x-dev-admin': 'true',
  });
  if (role !== 'none') {
    headers.set('x-test-role', role);
  }
  return new NextRequest(url, {
    method: 'POST',
    headers,
    body: form,
  });
}

test('Uploads: multipart PDF upload succeeds and returns private storage key without public URL', async () => {
  const form = new FormData();
  form.append('purpose', 'main_pdf');
  form.append('productId', crypto.randomUUID());
  form.append(
    'file',
    new File([Buffer.from('%PDF-1.4 simulated pdf ebook content')], 'book-edition.pdf', {
      type: 'application/pdf',
    }),
  );

  const req = makeMultipartReq('http://localhost:3000/api/admin/uploads', form, 'admin');
  const res = await adminUploadsRoute.POST(req);

  assert.strictEqual(res.status, 200);
  assert.ok(res.headers.get('content-type')?.includes('application/json'));
  const data = await res.json();
  assert.strictEqual(data.ok, true);
  assert.ok(data.key.startsWith('books/'), 'Main PDF storage key must reside under books/');
  assert.strictEqual(data.url, undefined, 'Private paid PDF must NEVER return a public URL');
  assert.ok(data.size > 0);
});

test('Uploads: multipart upload rejects invalid file types with consistent JSON error response', async () => {
  const form = new FormData();
  form.append('purpose', 'cover');
  form.append('productId', crypto.randomUUID());
  form.append(
    'file',
    new File(['malicious script content'], 'exploit.sh', {
      type: 'application/x-sh',
    }),
  );

  const req = makeMultipartReq('http://localhost:3000/api/admin/uploads', form, 'admin');
  const res = await adminUploadsRoute.POST(req);

  assert.strictEqual(res.status, 400);
  assert.ok(res.headers.get('content-type')?.includes('application/json'), 'Must return JSON on failure, never HTML');
  const data = await res.json();
  assert.ok(data.error?.message, 'Error object must contain a helpful message');
  assert.match(data.error.message.toLowerCase(), /must be one of/i);
});

test('Uploads: multipart upload rejects oversized files with consistent JSON error', async () => {
  const form = new FormData();
  form.append('purpose', 'cover');
  form.append('productId', crypto.randomUUID());
  // 6MB buffer exceeds the 5MB max image limit
  const hugeBuffer = new Uint8Array(6 * 1024 * 1024);
  form.append(
    'file',
    new File([hugeBuffer], 'huge-cover.png', {
      type: 'image/png',
    }),
  );

  const req = makeMultipartReq('http://localhost:3000/api/admin/uploads', form, 'admin');
  const res = await adminUploadsRoute.POST(req);

  assert.strictEqual(res.status, 400);
  assert.ok(res.headers.get('content-type')?.includes('application/json'));
  const data = await res.json();
  assert.ok(data.error?.message);
  assert.match(data.error.message.toLowerCase(), /smaller/i);
});

test('Cover URL Mapping: publicUrl properly resolves local seed covers, relative paths, and uploaded Cloudinary keys', () => {
  // 1. Local seed covers must be preserved as root-relative paths
  assert.strictEqual(
    publicUrl('covers/the-long-afternoon-cover.png'),
    '/covers/the-long-afternoon-cover.png',
  );
  assert.strictEqual(
    publicUrl('covers/letters-i-never-sent-cover.png'),
    '/covers/letters-i-never-sent-cover.png',
  );
  assert.strictEqual(
    publicUrl('covers/everything-we-didnt-say-cover.png'),
    '/covers/everything-we-didnt-say-cover.png',
  );

  // 2. Already rooted paths must be preserved
  assert.strictEqual(
    publicUrl('/covers/the-long-afternoon-cover.png'),
    '/covers/the-long-afternoon-cover.png',
  );

  // 3. Absolute HTTP/HTTPS URLs must be preserved
  assert.strictEqual(
    publicUrl('https://example.com/cdn/cover.webp'),
    'https://example.com/cdn/cover.webp',
  );

  // 4. Uploaded Cloudinary storage keys must map to Cloudinary CDN
  const uploadedKey = 'covers/b8d7c2a1-0000-4000-a000-000000000000/cover.png';
  assert.strictEqual(
    publicUrl(uploadedKey),
    `https://res.cloudinary.com/${env.CLOUDINARY_CLOUD_NAME}/image/upload/${uploadedKey}.png`,
  );

  // 5. Null or empty inputs return null
  assert.strictEqual(publicUrl(null), null);
  assert.strictEqual(publicUrl(undefined), null);
  assert.strictEqual(publicUrl(''), null);
});

test('New book: uploaded cover and separate sample persist through database reads and return real PDF bytes', async (t) => {
  const originalFetch = globalThis.fetch;
  const rows = new Map<string, any>();
  let databaseReads = 0;
  t.mock.method(globalThis, 'fetch', async (input: any, init: any) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname !== '/rest/v1/products') return originalFetch(input, init);
    const method = init?.method || 'GET';
    const headers = { 'content-type': 'application/json', 'content-range': `0-0/${rows.size}` };
    if (method === 'POST') {
      const row = JSON.parse(init.body);
      rows.set(row.id, row);
      return new Response(JSON.stringify(row), { status: 201, headers });
    }
    databaseReads++;
    const row = [...rows.values()].find((row) =>
      (!url.searchParams.has('id') || url.searchParams.get('id') === `eq.${row.id}`) &&
      (!url.searchParams.has('slug') || url.searchParams.get('slug') === `eq.${row.slug}`));
    return new Response(JSON.stringify(new Headers(init?.headers).get('accept')?.includes('vnd.pgrst.object') ? row : [...rows.values()]), { headers });
  });

  const upload = async (purpose: string, bytes: Buffer, mime: string) => {
    const form = new FormData();
    form.set('purpose', purpose);
    form.set('file', new File([Uint8Array.from(bytes)], purpose === 'cover' ? 'cover.jpg' : `${purpose}.pdf`, { type: mime }));
    const response = await adminUploadsRoute.POST(makeMultipartReq('http://localhost:3000/api/admin/uploads', form));
    assert.strictEqual(response.status, 200);
    return response.json();
  };
  const cover = await upload('cover', Buffer.from('unique-cover-fixture'), 'image/jpeg');
  const sampleBytes = Buffer.from('%PDF-1.7\nUnique opening sample\n%%EOF');
  const sample = await upload('sample_pdf', sampleBytes, 'application/pdf');
  const full = await upload('main_pdf', Buffer.from('%PDF-1.7\nPrivate full edition\n%%EOF'), 'application/pdf');
  assert.notStrictEqual(sample.key, full.key);
  assert.strictEqual(sample.url, undefined);
  const slug = `new-upload-${crypto.randomUUID()}`;
  const created = await adminProductsRoute.POST(makeReq('http://localhost:3000/api/admin/products', {
    role: 'admin', body: { title: 'A newly uploaded book', slug, description: 'A new edition regression fixture.',
      pricePaise: 12345, coverKey: cover.key, samplePdfKey: sample.key, mainPdfKey: full.key, status: 'published' },
  }));
  assert.strictEqual(created.status, 200);
  const { product } = await created.json();
  assert.strictEqual(rows.get(product.id).cover_key, cover.key);
  assert.strictEqual(rows.get(product.id).sample_pdf_key, sample.key);
  assert.strictEqual(rows.get(product.id).main_pdf_key, full.key);
  assert.strictEqual(rows.get(product.id).cover_url, undefined, 'URL is derived from the persisted key, not a transient database field');
  for (const read of [
    () => adminProductDetailRoute.GET(makeReq(`http://localhost:3000/api/admin/products/${product.id}`, { role: 'admin' }), { params: { id: product.id } }),
    () => productSlugRoute.GET(makeReq(`http://localhost:3000/api/products/${slug}`), { params: { slug } }),
  ]) {
    const response = await read();
    assert.strictEqual(response.status, 200);
    const { product: reloaded } = await response.json();
    assert.strictEqual(reloaded.cover_url, cover.url);
    assert.strictEqual(reloaded.cover_key, cover.key);
    assert.strictEqual(reloaded.sample_pdf_url, undefined, 'Never invent a local sample URL for an uploaded object');
  }
  const list = await productsRoute.GET(makeReq('http://localhost:3000/api/products'));
  const listed = (await list.json()).products.find((p: any) => p.id === product.id);
  assert.strictEqual(listed.cover_url, cover.url);
  assert.strictEqual(listed.main_pdf_key, undefined);
  assert.ok(databaseReads >= 3, 'The regression must exercise database reads, not only fixture fallback');
  const downloaded = await downloadRoute.POST(makeReq('http://localhost:3000/api/download', { body: { productId: product.id, kind: 'sample' } }));
  assert.strictEqual(downloaded.status, 200);
  assert.strictEqual(downloaded.headers.get('content-type'), 'application/pdf');
  assert.match(downloaded.headers.get('content-disposition')!, /filename="A-newly-uploaded-book-sample\.pdf"/);
  assert.deepStrictEqual(Buffer.from(await downloaded.arrayBuffer()), sampleBytes);

  const checkout = await checkoutRoute.POST(makeReq('http://localhost:3000/api/checkout', {
    body: { productId: product.id, fullName: '  New Reader  ', email: 'NEW@example.com', phone: '+91 98765-43210' },
  }));
  assert.strictEqual(checkout.status, 200);
  const order = await checkout.json();
  assert.strictEqual(order.amountPaise, 12345);
  const detail = await adminOrderDetailRoute.GET(makeReq(`http://localhost:3000/api/admin/orders/${order.orderId}`, { role: 'admin' }), { params: { id: order.orderId } });
  assert.strictEqual((await detail.json()).order.status, 'pending');
  const forbiddenFull = await downloadRoute.POST(makeReq('http://localhost:3000/api/download', { body: { productId: product.id, kind: 'full', orderId: order.orderId } }));
  assert.strictEqual(forbiddenFull.status, 401);
});

test('Samples: missing, unavailable, HTML, and full-edition keys return useful JSON errors without attachments', async () => {
  for (const [sampleKey, status] of [[null, 404], ['samples/missing/object.pdf', 502], ['samples/corrupt/object.pdf', 502], ['books/another-private.pdf', 404]] as const) {
    if (sampleKey?.includes('corrupt')) storedObjects.set(sampleKey, Buffer.from('<!doctype html><title>Error</title>'));
    const created = await adminProductsRoute.POST(makeReq('http://localhost:3000/api/admin/products', {
      role: 'admin', body: { title: 'Sample error fixture', slug: `sample-error-${crypto.randomUUID()}`,
        description: 'Sample error regression fixture.', pricePaise: 19900, coverKey: '/covers/test.jpg',
        mainPdfKey: 'books/private.pdf', samplePdfKey: sampleKey, status: 'published' },
    }));
    const { product } = await created.json();
    const response = await downloadRoute.POST(makeReq('http://localhost:3000/api/download', { body: { productId: product.id, kind: 'sample' } }));
    assert.strictEqual(response.status, status);
    assert.match(response.headers.get('content-type')!, /application\/json/);
    assert.strictEqual(response.headers.get('content-disposition'), null);
    assert.ok((await response.json()).error.message);
    await adminProductDetailRoute.DELETE(makeReq(`http://localhost:3000/api/admin/products/${product.id}`, { role: 'admin', method: 'DELETE' }), { params: { id: product.id } });
  }
});

test('Checkout: accepts real phone numbers and rejects incomplete customer details without creating a payment session', async () => {
  for (const phone of ['9876543210', '+91 98765 43210']) {
    const response = await checkoutRoute.POST(makeReq('http://localhost:3000/api/checkout', {
      body: { productId: LONG_AFTERNOON_ID, fullName: 'Valid Reader', email: 'reader@example.com', phone },
    }));
    assert.strictEqual(response.status, 200);
    assert.ok((await response.json()).paymentSessionId);
  }
  for (const invalid of [{ phone: undefined }, { phone: '' }, { phone: 'wrong' }, { fullName: '' }, { email: 'invalid' }, { fullName: 'x'.repeat(81) }]) {
    const response = await checkoutRoute.POST(makeReq('http://localhost:3000/api/checkout', {
      body: { productId: LONG_AFTERNOON_ID, fullName: 'Valid Reader', email: 'reader@example.com', ...invalid },
    }));
    assert.strictEqual(response.status, 422);
    const data = await response.json();
    assert.ok(data.error.details.fields);
    assert.strictEqual(data.paymentSessionId, undefined);
  }
});

test('Database outages: development must not report a successful book save or start checkout from fixture data', async () => {
  const originalMode = env.NODE_ENV;
  try {
    env.NODE_ENV = 'development';
    await assert.rejects(createProduct({ title: 'Unsaved book', slug: 'unsaved-book' }), /could not be saved to the database/);
    await assert.rejects(updateProduct(LONG_AFTERNOON_ID, { title: 'Unsaved title' }), /could not be saved to the database/);
    await assert.rejects(getProductByIdOrSlug(LONG_AFTERNOON_ID, true, true), /Checkout is temporarily unavailable/);
  } finally {
    env.NODE_ENV = originalMode;
  }
});

test('Catalogue: book saved with private PDF key persists in database and remains private from public catalogue endpoints', async () => {
  const testSlug = `vault-test-${Date.now()}`;
  const privatePdfKey = `books/vault-${Date.now()}/edition.pdf`;

  // 1. Admin creates book with cover and private PDF key
  const createRes = await adminProductsRoute.POST(
    makeReq('http://localhost:3000/api/admin/products', {
      role: 'admin',
      body: {
        title: 'Vault Edition Book',
        slug: testSlug,
        description: 'Test book with private PDF key.',
        pricePaise: 39900,
        coverKey: 'covers/test-vault-cover.png',
        mainPdfKey: privatePdfKey,
        mainPdfBytes: 1048576,
        status: 'published',
      },
    }),
  );
  assert.strictEqual(createRes.status, 200);
  const { product } = await createRes.json();
  assert.strictEqual(product.main_pdf_key, privatePdfKey, 'Admin response preserves private PDF key');

  // 2. Public product detail endpoint must NEVER expose main_pdf_key to visitors
  const publicRes = await productSlugRoute.GET(
    makeReq(`http://localhost:3000/api/products/${testSlug}`),
    { params: { slug: testSlug } },
  );
  assert.strictEqual(publicRes.status, 200);
  const publicData = await publicRes.json();
  assert.ok(publicData.product);
  assert.strictEqual(
    (publicData.product as any).main_pdf_key,
    undefined,
    'Storefront product response must never expose main_pdf_key',
  );
  assert.ok(publicData.product.cover_url, 'Storefront product response must have valid cover_url');

  // 3. Public products browse list must also NEVER expose main_pdf_key
  const browseRes = await productsRoute.GET(makeReq('http://localhost:3000/api/products'));
  assert.strictEqual(browseRes.status, 200);
  const browseData = await browseRes.json();
  const found = browseData.products.find((p: any) => p.slug === testSlug);
  assert.ok(found);
  assert.strictEqual(
    found.main_pdf_key,
    undefined,
    'Storefront catalogue list must never expose main_pdf_key',
  );

  // Cleanup: delete book
  await adminProductDetailRoute.DELETE(
    makeReq(`http://localhost:3000/api/admin/products/${product.id}`, {
      method: 'DELETE',
      role: 'admin',
    }),
    { params: { id: product.id } },
  );
});

