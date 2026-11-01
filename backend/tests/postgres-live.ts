/** Optional tests over the actual pg wire driver, restricted to disposable loopback DBs. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { configureTestEnvironment } from './test-environment';

async function main() {
  const value = process.env.BOOKISHBAE_TEST_DATABASE_URL;
  if (!value) throw new Error('BOOKISHBAE_TEST_DATABASE_URL is required.');
  const url = new URL(value);
  if (!['localhost','127.0.0.1','[::1]'].includes(url.hostname)) throw new Error('Only disposable local databases are allowed.');
  configureTestEnvironment();
  process.env.DATABASE_URL = value;
  process.env.DATABASE_SSL_MODE = 'disable';
  const { db, transaction, closeDatabase } = await import('../src/lib/db/postgres');
  const repo = await import('../src/lib/db/repository');
  const { getProfile } = await import('../src/lib/db/profiles');
  const { installPaymentFixture } = await import('./payment-fixture');
  await installPaymentFixture();
  const userId = randomUUID(), slug = `wire-${randomUUID()}`;
  let productId: string | undefined;
  try {
    // auth.users is a disposable shim here, never a real Auth service.
    await db.query('INSERT INTO auth.users(id,email) VALUES($1,$2)',[userId,`${userId}@test.invalid`]);
    assert.equal((await getProfile(userId))?.is_admin,false);
    await db.query("UPDATE public.profiles SET role='admin' WHERE id=$1",[userId]);
    assert.equal((await getProfile(userId))?.is_admin,true);
    const product = await repo.createProduct({slug,title:'Wire driver fixture',price_paise:12345,main_pdf_key:'books/wire-private.pdf',cover_key:'/covers/wire.png',status:'published'});
    productId=product.id;
    await repo.updateProduct(product.id,{title:'Updated over PostgreSQL'});
    assert.equal((await repo.getProductByIdOrSlug(slug))?.title,'Updated over PostgreSQL');
    const publicView=await repo.getProductByIdOrSlug(product.id,true);
    for (const key of ['main_pdf_key','sample_pdf_key','main_pdf_bytes','search_vector']) assert.equal(key in publicView!,false);
    const checkout=await repo.createOrder({productId:product.id,email:`${userId}@test.invalid`,fullName:'Wire buyer',phone:'9876543210',userId});
    await assert.rejects(repo.markOrderPaid(checkout.order.id,{paymentId:`wire-${randomUUID()}`,amountPaise:1}),{code:'bad_request'});
    assert.equal((await repo.getOrderById(checkout.order.id))?.status,'pending');
    await repo.markOrderPaid(checkout.order.id,{paymentId:`wire-${randomUUID()}`,amountPaise:12345});
    await repo.updateDownloadOverride(checkout.orderItem.id,1);
    const claims=await Promise.all(Array.from({length:8},()=>repo.claimDownload(userId,product.id,checkout.order.id)));
    assert.equal(claims.filter(claim=>claim.allowed).length,1,'Real pooled connections must serialize the last download slot');
    await repo.releaseDownload(checkout.orderItem.id);
    assert.equal((await repo.claimDownload(userId,product.id)).allowed,true);
    await assert.rejects(transaction(async sql=>{
      await sql.query('UPDATE public.products SET title=$2 WHERE id=$1',[product.id,'Must roll back']);
      throw new Error('deliberate rollback');
    }),{code:'upstream_error'});
    assert.equal((await repo.getProductByIdOrSlug(slug))?.title,'Updated over PostgreSQL');
    assert.equal((await repo.refundOrder(checkout.order.id)).ok,true);
    assert.equal((await repo.claimDownload(userId,product.id,checkout.order.id)).reason,'order_refunded');
    console.log('Actual pg repository CRUD, profile authorization, checkout/payment rollback, concurrent quota, refund and public privacy checks passed.');
  } finally {
    if(productId) {
      await db.query('DELETE FROM public.orders WHERE id IN (SELECT order_id FROM public.order_items WHERE product_id=$1)',[productId]);
      await repo.deleteProduct(productId);
    }
    await db.query('DELETE FROM auth.users WHERE id=$1',[userId]);
    await closeDatabase();
  }
}
void main().catch(()=>{console.error('Actual pg repository verification failed. Inspect the disposable database setup and assertions.');process.exitCode=1;});
