// Real browser/API/database/storage check; never creates or changes a payment.
// Run from backend: node --env-file=.env.local --import tsx scripts/check-guest-download.mjs ORDER_UUID
import assert from 'node:assert/strict';
import { createAdminClient } from '../src/lib/supabase/admin.ts';
import { env } from '../src/lib/env.ts';
import { signDownloadToken } from '../src/lib/download-token.ts';
import { releaseDatabaseDownload } from '../src/lib/download-entitlement.ts';
import { launchChrome } from '../../frontend/tests/chrome-driver.mjs';

assert.equal(env.CASHFREE_ENVIRONMENT, 'TEST', 'Only verify an existing sandbox order');
const orderId = process.argv[2];
assert.match(orderId || '', /^[a-f0-9-]{36}$/i, 'Pass the sandbox guest order UUID');
const admin = createAdminClient();
const { data: order, error } = await admin.from('orders')
  .select('id,status,user_id,items:order_items(id,product_id,downloads_used,download_limit,download_limit_override)')
  .eq('id', orderId).single();
assert.ifError(error);
assert.equal(order.status, 'paid', 'Payment must already be verified');
assert.equal(order.user_id, null, 'Expected a guest checkout order');
assert.equal(order.items.length, 1);
const item = order.items[0];
assert.ok(item.downloads_used < (item.download_limit_override ?? item.download_limit));
const browser = await launchChrome('bookishbae-guest-download-');
const origin = process.env.BOOKISHBAE_BROWSER_ORIGIN || 'http://localhost:3000';
const network = [];
browser.on('Network.responseReceived', ({ response }) => {
  if (new URL(response.url).pathname === '/api/download') network.push({ path: '/api/download', status: response.status, mimeType: response.mimeType });
});
let consumed = false;
try {
  await browser.call('Page.navigate', { url: origin });
  await browser.until('document.readyState === "complete"', 'storefront page');
  const token = signDownloadToken(order.id, item.product_id, 60_000);
  const response = await browser.evaluate(`(async () => {
    const response = await fetch('/api/download', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(${JSON.stringify({ productId: item.product_id, kind: 'full', token })}) });
    return { status: response.status, body: await response.json() };
  })()`);
  assert.equal(response.status, 200, JSON.stringify(response.body.error));
  consumed = true;
  assert.equal(response.body.downloadsUsed, item.downloads_used + 1);
  const file = await fetch(response.body.url);
  assert.equal(file.status, 200, 'Actual private Cloudinary file must be readable');
  const bytes = Buffer.from(await file.arrayBuffer());
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-', 'Full download must contain actual PDF bytes');
  const persisted = await admin.from('order_items').select('downloads_used').eq('id', item.id).single();
  assert.ifError(persisted.error);
  assert.ok(persisted.data.downloads_used >= item.downloads_used + 1);
  console.log(JSON.stringify({ network, pdfStatus: file.status, contentType: file.headers.get('content-type'), pdfBytes: bytes.length, persistedClaim: true }));
} finally {
  browser.close();
  if (consumed) {
    await releaseDatabaseDownload(item.id);
    const restored = await admin.from('order_items').select('downloads_used').eq('id', item.id).single();
    assert.ifError(restored.error);
    console.log(JSON.stringify({ verificationSlotReleased: true, downloadsUsed: restored.data.downloads_used }));
  }
}
