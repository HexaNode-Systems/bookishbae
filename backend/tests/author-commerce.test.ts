import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import * as categories from '../src/api/admin/categories/route';
import * as category from '../src/api/admin/categories/[id]/route';
import * as publicCategories from '../src/api/categories/route';
import * as coupons from '../src/api/admin/coupons/route';
import * as coupon from '../src/api/admin/coupons/[id]/route';
import * as products from '../src/api/admin/products/route';
import * as product from '../src/api/admin/products/[id]/route';
import * as publicProducts from '../src/api/products/route';
import * as publicProduct from '../src/api/products/[slug]/route';
import * as checkout from '../src/api/checkout/route';
import * as verify from '../src/api/checkout/verify/route';
import { cashfree, createCashfreeOrder } from '../src/lib/cashfree';
import { confirmCashfreePayment } from '../src/lib/payment-verification';
import { env } from '../src/lib/env';
import { gatewayCreates, gatewayOrders, gatewayPayments, setGatewayPaid } from './payment-fixture';
import { createHmac } from 'node:crypto';
import * as webhook from '../src/api/webhooks/cashfree/route';

const request = (path: string, method = 'GET', body?: unknown, role = 'admin') => new NextRequest(`http://localhost:3000${path}`, {
  method, headers: { origin: 'http://localhost:3000', 'content-type': 'application/json', 'x-test-role': role },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

test('Category and coupon administration refuses unauthenticated and customer requests', async () => {
  for (const role of ['none', 'customer']) {
    const expected = role === 'none' ? 401 : 403;
    assert.equal((await categories.GET(request('/api/admin/categories', 'GET', undefined, role))).status, expected);
    assert.equal((await coupons.GET(request('/api/admin/coupons', 'GET', undefined, role))).status, expected);
    assert.equal((await category.DELETE(request('/api/admin/categories/x', 'DELETE', undefined, role), { params: { id: crypto.randomUUID() } })).status, expected);
    assert.equal((await coupon.DELETE(request('/api/admin/coupons/x', 'DELETE', undefined, role), { params: { id: crypto.randomUUID() } })).status, expected);
  }
});

test('Author category CRUD, ID filtering and preview persistence survive fresh API reads without demo content', async t => {
  const originalFetch = globalThis.fetch;
  const categoryRows = new Map<string, any>();
  const bookRows = new Map<string, any>();
  t.mock.method(globalThis, 'fetch', async (input: any, init: any) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const isCategories = url.pathname === '/rest/v1/categories';
    if (!isCategories && url.pathname !== '/rest/v1/products') return originalFetch(input, init);
    const rows = isCategories ? categoryRows : bookRows;
    const method = init?.method || 'GET';
    const id = url.searchParams.get('id')?.replace(/^eq\./, '');
    const selected = [...rows.values()].filter(row => (!id || row.id === id) &&
      (!url.searchParams.has('category_id') || `eq.${row.category_id}` === url.searchParams.get('category_id')) &&
      (!url.searchParams.has('slug') || `eq.${row.slug}` === url.searchParams.get('slug')));
    if (method === 'HEAD') return new Response(null, { headers: { 'content-range': `0-0/${selected.length}` } });
    let row = selected[0];
    if (method === 'POST') { row = { id: crypto.randomUUID(), ...JSON.parse(init.body) }; rows.set(row.id, row); }
    if (method === 'PATCH') { row = { ...row, ...JSON.parse(init.body) }; rows.set(row.id, row); }
    if (method === 'DELETE' && id) rows.delete(id);
    return Response.json(new Headers(init?.headers).get('accept')?.includes('vnd.pgrst.object') ? row : selected, { headers: { 'content-range': `0-0/${selected.length}` } });
  });
  const categoryResponse = await categories.POST(request('/api/admin/categories', 'POST', { name: 'Author mysteries', slug: 'author-mysteries' }));
  assert.equal(categoryResponse.status, 200);
  const savedCategory = (await categoryResponse.json()).category;
  const preview = [{ heading: 'The author’s chapter', paragraphs: ['Original first paragraph.', 'Original second paragraph.'] }];
  const created = await products.POST(request('/api/admin/products', 'POST', {
    title: 'Author mystery', slug: `author-mystery-${crypto.randomUUID()}`, description: 'A new authored edition.',
    categoryId: savedCategory.id, samplePreview: preview, pricePaise: 19900, coverKey: '/covers/own.png', mainPdfKey: 'books/own.pdf', status: 'published',
  }));
  assert.equal(created.status, 200);
  const savedBook = (await created.json()).product;
  assert.equal(bookRows.get(savedBook.id).category_id, savedCategory.id);
  assert.deepEqual(bookRows.get(savedBook.id).sample_preview, preview);
  const filtered = await publicProducts.GET(request('/api/products?category=author-mysteries'));
  assert.deepEqual((await filtered.json()).products.map((book: any) => book.id), [savedBook.id]);
  const empty = await publicProducts.GET(request('/api/products?category=absent-category'));
  assert.deepEqual((await empty.json()).products, []);
  assert.equal((await category.PATCH(request(`/api/admin/categories/${savedCategory.id}`, 'PATCH', { name: 'Renamed mysteries', slug: 'author-mysteries' }), { params: { id: savedCategory.id } })).status, 200);
  const reloaded = await publicProduct.GET(request(`/api/products/${savedBook.slug}`), { params: { slug: savedBook.slug } });
  const reloadedBook = (await reloaded.json()).product;
  assert.deepEqual(reloadedBook.sample_preview, preview);
  assert.equal(reloadedBook.category, 'Renamed mysteries');
  assert.equal((await category.DELETE(request(`/api/admin/categories/${savedCategory.id}`, 'DELETE'), { params: { id: savedCategory.id } })).status, 409);
  const changed = await product.PATCH(request(`/api/admin/products/${savedBook.id}`, 'PATCH', { categoryId: null, samplePreview: [] }), { params: { id: savedBook.id } });
  assert.equal(changed.status, 200);
  assert.deepEqual((await changed.json()).product.sample_preview, []);
  assert.equal((await category.DELETE(request(`/api/admin/categories/${savedCategory.id}`, 'DELETE'), { params: { id: savedCategory.id } })).status, 200);
  assert.deepEqual((await (await publicCategories.GET(request('/api/categories'))).json()).categories, []);
});

test('Coupon create/edit/toggle/delete preserve book scope and dates; malformed discounts are rejected', async t => {
  const originalFetch = globalThis.fetch;
  let saved: any;
  let history = false;
  t.mock.method(globalThis, 'fetch', async (input: any, init: any) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname.endsWith('/rpc/save_coupon')) {
      const { p_id: id, p_coupon: body } = JSON.parse(init.body);
      saved = { id: id || crypto.randomUUID(), code: body.code, discount_type: body.discountType, discount_value: body.discountValue, product_ids: body.productIds, starts_at: body.startsAt, expires_at: body.expiresAt, is_active: body.isActive, times_used: 0 };
      return Response.json(saved);
    }
    if (url.pathname.endsWith('/rpc/delete_coupon')) {
      if (history) return Response.json({ code: '23503', message: 'Coupon has order history' }, { status: 409 });
      saved = undefined; return Response.json({ ok: true });
    }
    if (url.pathname === '/rest/v1/coupons') {
      if (init?.method === 'PATCH') { assert.deepEqual(Object.keys(JSON.parse(init.body)), ['is_active']); Object.assign(saved, JSON.parse(init.body)); return Response.json(saved); }
      return Response.json(saved ? [saved] : []);
    }
    if (url.pathname === '/rest/v1/coupon_products') return Response.json(saved?.product_ids.map((id: string) => ({ coupon_id: saved.id, product_id: id })) || []);
    return originalFetch(input, init);
  });
  const body = { code: 'AUTHOR10', discountType: 'flat', discountValue: 1000, productIds: [crypto.randomUUID(), crypto.randomUUID()], startsAt: '2026-01-01T00:00:12.000Z', expiresAt: '2027-01-01T00:00:34.000Z', usageLimit: 10, usageLimitPerUser: 1, maxDiscountPaise: 1000, isActive: true };
  const created = await coupons.POST(request('/api/admin/coupons', 'POST', body));
  assert.equal(created.status, 200);
  const row = (await created.json()).coupon;
  assert.equal(row.code, 'author10');
  assert.deepEqual((await (await coupons.GET(request('/api/admin/coupons'))).json()).coupons[0].product_ids, body.productIds);
  assert.equal((await coupon.PATCH(request(`/api/admin/coupons/${row.id}`, 'PATCH', { isActive: false }), { params: { id: row.id } })).status, 200);
  assert.equal(saved.is_active, false);
  assert.equal(saved.expires_at, body.expiresAt);
  assert.equal((await coupon.PATCH(request(`/api/admin/coupons/${row.id}`, 'PATCH', { ...body, discountType: 'percent', discountValue: 25 }), { params: { id: row.id } })).status, 200);
  assert.equal(saved.discount_value, 25);
  for (const invalid of [{ ...body, discountType: 'percent', discountValue: 101 }, { ...body, discountValue: 1.5 }, { ...body, expiresAt: '2025-01-01T00:00:00Z' }]) {
    assert.equal((await coupons.POST(request('/api/admin/coupons', 'POST', invalid))).status, 422);
  }
  history = true;
  assert.equal((await coupon.DELETE(request(`/api/admin/coupons/${row.id}`, 'DELETE'), { params: { id: row.id } })).status, 409);
  history = false;
  assert.equal((await coupon.DELETE(request(`/api/admin/coupons/${row.id}`, 'DELETE'), { params: { id: row.id } })).status, 200);
  assert.deepEqual((await (await coupons.GET(request('/api/admin/coupons'))).json()).coupons, []);
});

test('Cashfree creates a session for the server amount and verifies identity, amount, currency and successful payment', async () => {
  const reference = `sdk-${crypto.randomUUID()}`;
  const created = await createCashfreeOrder({ amountPaise: 19950, orderId: reference, customer: { id: 'reader', name: 'Reader', email: 'reader@example.com', phone: '9876543210' } });
  assert.ok(created.paymentSessionId);
  assert.equal(gatewayCreates.at(-1).order_amount, 199.5);
  assert.equal(gatewayCreates.at(-1).customer_details.customer_phone, '9876543210');
  const order = { razorpay_order_id: reference, order_number: reference, total_paise: 19950, currency: 'INR' };
  assert.deepEqual(await confirmCashfreePayment(order), { paid: false, status: 'pending' });
  gatewayPayments.set(reference, [{ payment_status: 'FAILED', payment_time: new Date().toISOString() }]);
  assert.equal((await confirmCashfreePayment(order)).status, 'failed');
  gatewayPayments.set(reference, [{ payment_status: 'USER_DROPPED', payment_time: new Date().toISOString() }]);
  assert.equal((await confirmCashfreePayment(order)).status, 'cancelled');
  setGatewayPaid(reference);
  assert.equal((await confirmCashfreePayment(order)).paymentId, `cf_${reference}`);
  gatewayOrders.get(reference).order_amount = 1;
  await assert.rejects(confirmCashfreePayment(order), /matched to this order/);
  gatewayOrders.get(reference).order_amount = 199.5;
  gatewayOrders.get(reference).order_currency = 'USD';
  await assert.rejects(confirmCashfreePayment(order), /matched to this order/);
  gatewayOrders.get(reference).order_currency = 'INR';
  gatewayPayments.get(reference)![0].payment_amount = 1;
  assert.deepEqual(await confirmCashfreePayment(order), { paid: false, status: 'pending' });
});

test('Cashfree missing configuration, missing session and gateway rejection cannot report successful checkout', async t => {
  const input = { amountPaise: 10000, orderId: `sdk-${crypto.randomUUID()}`, customer: { id: 'reader', email: 'reader@example.com', phone: '9876543210' } };
  const original = env.CASHFREE_APP_ID;
  try { env.CASHFREE_APP_ID = ''; await assert.rejects(createCashfreeOrder(input), /not configured/); } finally { env.CASHFREE_APP_ID = original; }
  const client = cashfree();
  const mocked = t.mock.method(client, 'PGCreateOrder', async () => ({ data: { order_id: input.orderId, order_amount: 100, order_currency: 'INR' } }));
  await assert.rejects(createCashfreeOrder(input), /valid payment session/);
  mocked.mock.restore();
  t.mock.method(client, 'PGCreateOrder', async () => { throw { message: 'Denied', response: { status: 401, data: { code: 'authentication_failed' } } }; });
  const response = await checkout.POST(request('/api/checkout', 'POST', { productId: '11111111-1111-4111-a111-111111111111', fullName: 'Reader', email: 'reader@example.com', phone: '9876543210' }));
  assert.equal(response.status, 502);
  assert.match((await response.json()).error.message, /configured credentials/);
});

test('Checkout rejects tampering and invalid coupons before Cashfree; only verified payment yields download access', async () => {
  const body = { productId: '11111111-1111-4111-a111-111111111111', fullName: 'Reader', email: 'reader@example.com', phone: '9876543210' };
  const before = gatewayCreates.length;
  for (const changes of [{ pricePaise: 1 }, { discountPaise: 29900 }, { amount: 1 }]) {
    assert.equal((await checkout.POST(request('/api/checkout', 'POST', { ...body, ...changes }))).status, 422);
  }
  assert.equal((await checkout.POST(request('/api/checkout', 'POST', { ...body, couponCode: 'not-valid' }))).status, 400);
  assert.equal(gatewayCreates.length, before);
  const created = await checkout.POST(request('/api/checkout', 'POST', body));
  assert.equal(created.status, 200);
  const order = await created.json();
  const pending = await (await verify.POST(request('/api/checkout/verify', 'POST', { orderId: order.orderId }))).json();
  assert.equal(pending.paid, false);
  assert.equal(pending.downloadToken, undefined);
  setGatewayPaid(order.orderNumber);
  const paid = await (await verify.POST(request('/api/checkout/verify', 'POST', { orderId: order.orderId }))).json();
  assert.equal(paid.paid, true);
  assert.ok(paid.downloadToken);
});

test('A signed success webhook cannot grant access while Cashfree still reports the order as pending', async () => {
  const created = await checkout.POST(request('/api/checkout', 'POST', { productId: '11111111-1111-4111-a111-111111111111', fullName: 'Reader', email: 'pending@example.com', phone: '9876543210' }));
  const order = await created.json();
  const raw = JSON.stringify({ type: 'PAYMENT_SUCCESS_WEBHOOK', data: { order: { order_id: order.orderNumber }, payment: { cf_payment_id: 'unconfirmed-payment', payment_status: 'SUCCESS', payment_amount: order.amountPaise / 100, payment_currency: 'INR' } } });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', env.CASHFREE_SECRET_KEY).update(timestamp + raw).digest('base64');
  const response = await webhook.POST(new NextRequest('http://localhost:3000/api/webhooks/cashfree', { method: 'POST', headers: { 'x-webhook-signature': signature, 'x-webhook-timestamp': timestamp }, body: raw }));
  assert.equal(response.status, 502);
  const result = await (await verify.POST(request('/api/checkout/verify', 'POST', { orderId: order.orderId }))).json();
  assert.equal(result.paid, false);
  assert.equal(result.downloadToken, undefined);
});

test('Public checkout configuration reports missing setup without returning any backend secrets', async () => {
  const original = env.CASHFREE_APP_ID;
  try {
    env.CASHFREE_APP_ID = '';
    const result = await (await checkout.GET(request('/api/checkout'))).json();
    assert.equal(result.configured, false);
    assert.equal(result.paymentMode, 'sandbox');
    assert.match(result.message, /not configured/);
    assert.equal(JSON.stringify(result).includes(env.CASHFREE_SECRET_KEY), false);
  } finally { env.CASHFREE_APP_ID = original; }
});
