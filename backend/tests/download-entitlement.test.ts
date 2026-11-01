import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { db, getPool } from '../src/lib/db/postgres';
import { claimDownload, releaseDownload, SEED_BOOK_IDS } from '../src/lib/db/repository';
import { signDownloadToken } from '../src/lib/download-token';
import * as download from '../src/api/download/route';
import { CUSTOMER_ID } from './database-fixture';
const productId = SEED_BOOK_IDS['the-long-afternoon']!;
async function fixture() {
  const email = `guest-${randomUUID()}@example.com`;
  const [result] = await db.query(`SELECT public.create_checkout_order($1,$2,'Guest reader') AS result`, [productId,email]);
  const { order, orderItem: item } = result!.result;
  await db.query("UPDATE public.orders SET status='paid',paid_at=now() WHERE id=$1", [order.id]);
  return { order: { ...order, email }, item };
}
function request(token: string) { return new NextRequest('http://localhost:3000/api/download', { method: 'POST', headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' }, body: JSON.stringify({ productId, kind: 'full', token }) }); }
test('Paid guest token uses persisted PostgreSQL entitlement and counter', async () => {
  const { order, item } = await fixture();
  const response = await download.POST(request(signDownloadToken(order.id, productId)));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).downloadsUsed, 1);
  assert.equal((await db.query('SELECT downloads_used FROM public.order_items WHERE id=$1', [item.id]))[0]!.downloads_used, 1);
});
test('Guest identity, exact order, product and paid status are all required', async () => {
  const { order, item } = await fixture();
  assert.equal((await claimDownload('someone-else@example.com',productId,order.id)).allowed,false);
  assert.equal((await claimDownload(order.email,randomUUID(),order.id)).allowed,false);
  assert.equal((await claimDownload(order.email,productId,randomUUID())).allowed,false);
  for (const status of ['pending','failed','cancelled','refunded']) {
    await db.query('UPDATE public.orders SET status=$2 WHERE id=$1',[order.id,status]);
    const claim = await claimDownload(order.email,productId,order.id);
    assert.equal(claim.allowed,false);
    assert.equal(claim.reason,status==='refunded'?'order_refunded':'not_purchased');
  }
  assert.equal((await db.query('SELECT downloads_used FROM public.order_items WHERE id=$1',[item.id]))[0]!.downloads_used,0);
});
test('Concurrent claims respect final slot, admin overrides and quota restoration', async () => {
  const { order, item } = await fixture();
  await db.query('UPDATE public.order_items SET download_limit_override=1 WHERE id=$1',[item.id]);
  const claims = await Promise.all(Array.from({ length: 6 },()=>claimDownload(order.email,productId,order.id)));
  assert.equal(claims.filter(c=>c.allowed).length,1);
  assert.ok(claims.filter(c=>!c.allowed).every(c=>c.reason==='download_limit_reached'));
  await releaseDownload(item.id);
  assert.equal((await claimDownload(order.email,productId,order.id)).allowed,true);
  await db.query('UPDATE public.order_items SET download_limit_override=0 WHERE id=$1',[item.id]);
  assert.equal((await claimDownload(order.email,productId,order.id)).allowed,false);
});
test('Refund before a claim revokes access and does not consume a slot', async () => {
  const { order, item } = await fixture();
  await db.query('SELECT public.refund_order($1)',[order.id]);
  assert.equal((await claimDownload(order.email,productId,order.id)).reason,'order_refunded');
  assert.equal((await db.query('SELECT downloads_used FROM public.order_items WHERE id=$1',[item.id]))[0]!.downloads_used,0);
});
test('Tampered and wrong-product guest tokens do not touch counters', async () => {
  const { order, item } = await fixture();
  assert.equal((await download.POST(request(signDownloadToken(order.id,randomUUID())))).status,401);
  assert.equal((await download.POST(request(signDownloadToken(order.id,productId)+'tampered'))).status,401);
  assert.equal((await db.query('SELECT downloads_used FROM public.order_items WHERE id=$1',[item.id]))[0]!.downloads_used,0);
});
test('Database connection failures refuse claims with 502 and preserve counters', async t => {
  const { order, item } = await fixture();
  t.mock.method(getPool(),'connect',async()=>{ throw new Error('offline'); });
  const response = await download.POST(request(signDownloadToken(order.id,productId)));
  assert.equal(response.status,502);
  assert.equal((await response.json()).error.code,'upstream_error');
  assert.equal((await db.query('SELECT downloads_used FROM public.order_items WHERE id=$1',[item.id]))[0]!.downloads_used,0);
});
test('Failed transaction rolls back a partially consumed download', async t => {
  const { order, item } = await fixture();
  const connect = getPool().connect.bind(getPool());
  t.mock.method(getPool(),'connect',async()=>{
    const client = await connect();
    const query = client.query.bind(client);
    client.query = (async (text: string, values: unknown[]) => {
      const result = await query(text,values);
      if (text.startsWith('UPDATE public.order_items SET downloads_used')) throw new Error('simulated lost update response');
      return result;
    }) as typeof client.query;
    return client;
  });
  await assert.rejects(claimDownload(order.email,productId,order.id),{ code:'upstream_error' });
  assert.equal((await db.query('SELECT downloads_used FROM public.order_items WHERE id=$1',[item.id]))[0]!.downloads_used,0);
});
test('Quota restoration failure is reported instead of fallback success', async t => {
  const { item } = await fixture();
  t.mock.method(getPool(),'query',async()=>{ throw new Error('offline'); });
  await assert.rejects(releaseDownload(item.id),{ code:'upstream_error' });
});
test('A failed download audit returns 502 and restores quota instead of reporting delivery success', async t => {
  const { order, item } = await fixture();
  const query = getPool().query.bind(getPool());
  let fail = true;
  t.mock.method(getPool(), 'query', async (text: string, values: unknown[]) => {
    if (fail && text.startsWith('INSERT INTO public.downloads')) { fail = false; throw new Error('audit unavailable'); }
    return query(text, values);
  });
  const response = await download.POST(request(signDownloadToken(order.id, productId)));
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error.code, 'upstream_error');
  assert.equal((await db.query('SELECT downloads_used FROM public.order_items WHERE id=$1', [item.id]))[0]!.downloads_used, 0);
});
test('Signed-in buyer uses own purchase and same exhaustion reason', async () => {
  const { order, item } = await fixture();
  await db.query('UPDATE public.orders SET user_id=$2 WHERE id=$1',[order.id,CUSTOMER_ID]);
  await db.query('UPDATE public.order_items SET download_limit_override=0 WHERE id=$1',[item.id]);
  // Existing customer purchases may have headroom; scope this check explicitly.
  assert.equal((await claimDownload(CUSTOMER_ID,productId,order.id)).reason,'download_limit_reached');
  assert.equal((await claimDownload(randomUUID(),productId)).allowed,false);
});
