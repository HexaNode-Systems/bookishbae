import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { type TestContext } from 'node:test';
import { NextRequest } from 'next/server';
import * as download from '../src/api/download/route';
import { claimDownload, releaseDownload, SEED_BOOK_IDS } from '../src/lib/db/repository';
import { signDownloadToken } from '../src/lib/download-token';

/** Supabase HTTP fixture, deliberately separate from the repository's test store. */
function database(t: TestContext) {
  const originalFetch = globalThis.fetch;
  const productId = SEED_BOOK_IDS['the-long-afternoon']!;
  const item = { id: randomUUID(), product_id: productId, downloads_used: 0, download_limit: 5, download_limit_override: null as number | null };
  const order = { id: randomUUID(), email: 'guest@example.com', user_id: null, status: 'paid', items: [item] };
  const state = {
    order, item, productId, reads: 0, writes: 0, releases: 0,
    failRead: 0, failWrite: false, failRelease: false,
    beforePatch: () => {}, afterPatch: () => {}, rpcReason: '',
  };
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const response = (rows: unknown[]) => Response.json(
      new Headers(init?.headers).get('accept')?.includes('vnd.pgrst.object') ? rows[0] : rows,
    );
    const failure = () => Response.json({ code: '08006', message: 'Fixture database unavailable' }, { status: 503 });
    if (url.pathname === '/rest/v1/orders') {
      state.reads++;
      if (state.failRead && state.reads >= state.failRead) return failure();
      return response(url.searchParams.get('id') === `eq.${order.id}` ? [structuredClone(order)] : []);
    }
    if (url.pathname === '/rest/v1/order_items' && init?.method === 'PATCH') {
      if (state.failWrite) return failure();
      state.beforePatch();
      assert.equal(url.searchParams.get('id'), `eq.${item.id}`);
      assert.equal(url.searchParams.get('order_id'), `eq.${order.id}`);
      assert.equal(url.searchParams.get('product_id'), `eq.${productId}`);
      const matches = url.searchParams.get('downloads_used') === `eq.${item.downloads_used}` &&
        url.searchParams.get('download_limit') === `eq.${item.download_limit}` &&
        url.searchParams.get('download_limit_override') === (item.download_limit_override === null ? 'is.null' : `eq.${item.download_limit_override}`);
      if (!matches) return response([]);
      Object.assign(item, JSON.parse(String(init.body)));
      state.writes++;
      state.afterPatch();
      return response([{ id: item.id }]);
    }
    if (url.pathname === '/rest/v1/rpc/release_download') {
      if (state.failRelease) return failure();
      assert.equal(JSON.parse(String(init?.body)).p_order_item_id, item.id);
      item.downloads_used = Math.max(0, item.downloads_used - 1);
      state.releases++;
      return Response.json(null);
    }
    if (url.pathname === '/rest/v1/rpc/claim_download' && state.rpcReason) {
      return Response.json({ allowed: false, reason: state.rpcReason });
    }
    if (url.pathname === '/rest/v1/downloads') return new Response(null, { status: 201 });
    return originalFetch(input, init);
  });
  return state;
}

function request(productId: string, token: string) {
  return new NextRequest('http://localhost:3000/api/download', {
    method: 'POST', headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
    body: JSON.stringify({ productId, kind: 'full', token }),
  });
}

test('Paid guest token uses the persisted order and counter, not the user-only RPC or test store', async t => {
  const db = database(t);
  const token = signDownloadToken(db.order.id, db.productId);
  const response = await download.POST(request(db.productId, token));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.match(body.url, /^https:\/\/api\.cloudinary\.com\//);
  assert.equal(body.downloadsUsed, 1);
  assert.equal(body.downloadLimit, 5);
  assert.equal(db.item.downloads_used, 1);
  assert.equal(db.writes, 1);
  assert.ok(db.reads >= 3, 'Route and claim recheck paid order in Supabase');
});

test('Guest credentials cannot unlock another product and tampered tokens do not touch counters', async t => {
  const db = database(t);
  const token = signDownloadToken(db.order.id, randomUUID());
  assert.equal((await download.POST(request(db.productId, token))).status, 401);
  assert.equal((await download.POST(request(db.productId, `${token}tampered`))).status, 401);
  assert.equal(db.writes, 0);
  assert.equal(db.reads, 0);
});

test('Guest entitlement requires matching identity, exact order, purchased product and paid status', async t => {
  const db = database(t);
  const claim = (identity = db.order.email, productId = db.productId, orderId = db.order.id) => claimDownload(identity, productId, orderId);
  assert.equal((await claim('someone-else@example.com')).allowed, false);
  assert.equal((await claim(undefined, randomUUID())).allowed, false);
  assert.equal((await claim(undefined, undefined, randomUUID())).allowed, false);
  for (const status of ['pending', 'failed', 'cancelled', 'refunded']) {
    db.order.status = status;
    const result = await claim();
    assert.equal(result.allowed, false);
    assert.equal(result.reason, status === 'refunded' ? 'order_refunded' : 'not_purchased');
  }
  assert.equal(db.writes, 0);
});

test('Concurrent guest claims respect the final remaining slot and admin overrides', async t => {
  const db = database(t);
  db.item.download_limit_override = 1;
  const claims = await Promise.all(Array.from({ length: 6 }, () => claimDownload(db.order.email, db.productId, db.order.id)));
  assert.equal(claims.filter(result => result.allowed).length, 1);
  assert.ok(claims.filter(result => !result.allowed).every(result => result.reason === 'download_limit_reached'));
  assert.equal(db.item.downloads_used, 1);
  assert.equal(db.writes, 1);
});

test('Changing the download override during a claim is rechecked before incrementing', async t => {
  const db = database(t);
  db.beforePatch = () => { db.item.download_limit_override = 0; };
  const claim = await claimDownload(db.order.email, db.productId, db.order.id);
  assert.equal(claim.reason, 'download_limit_reached');
  assert.equal(db.item.downloads_used, 0);
});

test('A refund during the claim refuses access and restores the consumed slot', async t => {
  const db = database(t);
  db.afterPatch = () => { db.order.status = 'refunded'; };
  const claim = await claimDownload(db.order.email, db.productId, db.order.id);
  assert.equal(claim.allowed, false);
  assert.equal(claim.reason, 'order_refunded');
  assert.equal(db.item.downloads_used, 0);
  assert.equal(db.releases, 1);
});

test('Database failures return a useful 502 rather than fallback success or an unhandled 500', async t => {
  const db = database(t);
  db.failWrite = true;
  const token = signDownloadToken(db.order.id, db.productId);
  const response = await download.POST(request(db.productId, token));
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.error.code, 'upstream_error');
  assert.match(body.error.message, /try again/i);
  assert.equal(db.item.downloads_used, 0);
});

test('Failure to recheck payment releases the slot and refuses access', async t => {
  const db = database(t);
  db.failRead = 2;
  await assert.rejects(claimDownload(db.order.email, db.productId, db.order.id), { code: 'upstream_error' });
  assert.equal(db.item.downloads_used, 0);
  assert.equal(db.releases, 1);
});

test('A failed quota restoration is reported rather than silently succeeding', async t => {
  const db = database(t);
  db.failRelease = true;
  await assert.rejects(releaseDownload(db.item.id), { code: 'upstream_error' });
  assert.equal(db.releases, 0);
});

test('Signed-in download RPC exhaustion uses the same limit reason as guest orders', async t => {
  const db = database(t);
  db.rpcReason = 'limit_reached';
  assert.equal((await claimDownload(randomUUID(), db.productId)).reason, 'download_limit_reached');
});
