import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

if (!process.env.BOOKISHBAE_TEST_DATABASE_URL) throw Error('Set BOOKISHBAE_TEST_DATABASE_URL to a disposable local PostgreSQL database with migrations 0001–0007 applied.');
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
const suite = await run(['-f', fileURLToPath(new URL('../supabase/tests/author_commerce.sql', import.meta.url))]);
assert.equal(suite.code, 0, suite.stderr);
const book = randomUUID(), coupon = randomUUID(), code = `limit_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
try {
  const setup = await run(['-c', `insert into public.products(id,slug,title,price_paise,cover_key,main_pdf_key,status) values('${book}','limit-${book}','Concurrency fixture',10000,'covers/test.png','books/test.pdf','published'); insert into public.coupons(id,code,discount_type,discount_value,usage_limit) values('${coupon}','${code}','percent',10,1);`]);
  assert.equal(setup.code, 0, setup.stderr);
  const contenders = await Promise.all(['first', 'second'].map(reader => run(['-c', `select public.create_checkout_order('${book}','${reader}@example.com','Concurrent reader','${code}');`])));
  assert.equal(contenders.filter(result => result.code === 0).length, 1, 'Exactly one concurrent checkout can reserve the final coupon use');
  assert.match(contenders.find(result => result.code !== 0).stderr, /exhausted/);
  const count = await run(['-t', '-A', '-c', `select count(*) from public.orders where coupon_id='${coupon}';`]);
  assert.equal(count.stdout.trim(), '1');
  console.log('PostgreSQL author-commerce assertions passed; concurrent coupon reservation limit passed.');
} finally {
  const cleaned = await run(['-c', `begin; delete from public.orders where coupon_id='${coupon}'; delete from public.coupons where id='${coupon}'; delete from public.products where id='${book}'; commit;`]);
  assert.equal(cleaned.code, 0, cleaned.stderr);
}
