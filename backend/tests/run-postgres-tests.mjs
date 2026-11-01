import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

if (!process.env.BOOKISHBAE_TEST_DATABASE_URL) throw Error('Set BOOKISHBAE_TEST_DATABASE_URL to a disposable local PostgreSQL database with migrations 0001–0008 applied.');
const url = new URL(process.env.BOOKISHBAE_TEST_DATABASE_URL);
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw Error('These fixtures may only run against a disposable local database.');
const executable = process.env.PSQL_PATH || 'psql';
const args = ['-h', url.hostname, '-p', url.port || '5432', '-U', decodeURIComponent(url.username), '-d', url.pathname.slice(1), '-v', 'ON_ERROR_STOP=1', '-q'];
const run = extra => new Promise((resolve, reject) => {
  const child = spawn(executable, [...args, ...extra], { windowsHide: true, env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password) } });
  let stdout = '', stderr = '';
  child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
  child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr }));
});
for (const name of ['security.sql', 'author_commerce.sql']) {
  const suite = await run(['-f', fileURLToPath(new URL(`../supabase/tests/${name}`, import.meta.url))]);
  assert.equal(suite.code, 0, suite.stderr);
}
const book = randomUUID(), coupon = randomUUID(), code = `limit_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
try {
  const setup = await run(['-c', `insert into public.products(id,slug,title,price_paise,cover_key,main_pdf_key,status) values('${book}','limit-${book}','Concurrency fixture',10000,'covers/test.png','books/test.pdf','published'); insert into public.coupons(id,code,discount_type,discount_value,usage_limit) values('${coupon}','${code}','percent',10,1);`]);
  assert.equal(setup.code, 0, setup.stderr);
  const contenders = await Promise.all(['first', 'second'].map(reader => run(['-c', `select public.create_checkout_order('${book}','${reader}@example.com','Concurrent reader','${code}');`])));
  assert.equal(contenders.filter(result => result.code === 0).length, 1, 'Exactly one concurrent checkout can reserve the final coupon use');
  assert.match(contenders.find(result => result.code !== 0).stderr, /exhausted/);
  const count = await run(['-t', '-A', '-c', `select count(*) from public.orders where coupon_id='${coupon}';`]);
  assert.equal(count.stdout.trim(), '1');

  // Real row-lock contention for the conditional update used by guest claims.
  // These disposable fixtures never contact Cashfree or mark real orders paid.
  const guest = await run(['-t', '-A', '-c', `select (public.create_checkout_order('${book}','guest-${book}@example.com','Guest fixture')->'order'->>'id');`]);
  assert.equal(guest.code, 0, guest.stderr);
  const guestId = guest.stdout.trim();
  assert.match(guestId, /^[a-f0-9-]{36}$/i);
  const paidFixture = await run(['-c', `update public.orders set status='paid',paid_at=now() where id='${guestId}'; update public.order_items set download_limit=1 where order_id='${guestId}';`]);
  assert.equal(paidFixture.code, 0, paidFixture.stderr);
  const downloads = await Promise.all([1, 2].map(() => run(['-t', '-A', '-c', `update public.order_items set downloads_used=1,last_downloaded_at=now() where order_id='${guestId}' and product_id='${book}' and downloads_used=0 and download_limit=1 and download_limit_override is null returning id;`])));
  for (const result of downloads) assert.equal(result.code, 0, result.stderr);
  assert.equal(downloads.filter(result => result.stdout.trim()).length, 1, 'Only one concurrent guest request can consume the final slot');
  const counter = await run(['-t', '-A', '-c', `select downloads_used from public.order_items where order_id='${guestId}';`]);
  assert.equal(counter.stdout.trim(), '1');
  const released = await run(['-c', `select public.release_download(id) from public.order_items where order_id='${guestId}';`]);
  assert.equal(released.code, 0, released.stderr);
  const restored = await run(['-t', '-A', '-c', `select downloads_used from public.order_items where order_id='${guestId}';`]);
  assert.equal(restored.stdout.trim(), '0');
  console.log('PostgreSQL author-commerce assertions, concurrent coupon reservation, concurrent guest download limit and quota restoration passed.');
} finally {
  const cleaned = await run(['-c', `begin; delete from public.orders where coupon_id='${coupon}' or id in (select order_id from public.order_items where product_id='${book}'); delete from public.coupons where id='${coupon}'; delete from public.products where id='${book}'; commit;`]);
  assert.equal(cleaned.code, 0, cleaned.stderr);
}

const repositorySuite = await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ['--import','tsx','tests/postgres-live.ts'], {
    cwd: fileURLToPath(new URL('../',import.meta.url)), windowsHide: true, stdio: 'inherit', env: process.env,
  });
  child.on('error',reject); child.on('close',resolve);
});
assert.equal(repositorySuite,0,'Actual pg repository checks must pass');
