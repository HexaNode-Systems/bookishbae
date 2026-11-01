import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID, randomBytes } from 'node:crypto';
import { NextRequest } from 'next/server';
import { createClient, AuthApiError } from '@supabase/supabase-js';
import { logSeedFailure } from '../scripts/seed-admin';
import { db, transaction, getPool, poolConfig } from '../src/lib/db/postgres';
import { seedAdmin } from '../src/lib/db/seed-admin';
import { createProduct, getProducts, updateProduct, getProductByIdOrSlug, deleteProduct, createOrder, markOrderPaid, getOrderById, getDashboardStats, SEED_BOOK_IDS } from '../src/lib/db/repository';
import { rateLimit } from '../src/lib/rate-limit';
import { env } from '../src/lib/env';
import * as admin from '../src/api/admin/products/route';
import * as me from '../src/api/auth/me/route';
import * as profile from '../src/api/admin/profile/route';
import * as settings from '../src/api/admin/settings/route';
import * as verification from '../src/api/checkout/verify/route';
import { authWrites } from './auth-fixture';
import { logger } from '../src/lib/logger';
import { engine } from './database-fixture';
import { ADMIN_ID, CUSTOMER_ID } from './database-fixture';
function client() { return createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}}); }
const req = (token?: string, path='/api/admin/products', method='GET', body?: unknown) => new NextRequest(`http://localhost:3000${path}`,{method,headers:{origin:'http://localhost:3000','content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
test('Direct repository CRUD persists, filters, sorts and resists SQL injection', async () => {
  const slug = `postgres-${randomUUID()}`;
  const row = await createProduct({slug,title:"A reader's book",price_paise:15500,main_pdf_key:'books/hidden.pdf',cover_key:'/covers/book.png',status:'published',sample_preview:[]});
  assert.equal((await getProductByIdOrSlug(slug))?.id,row.id);
  assert.equal((await updateProduct(row.id,{title:'Changed title'}))?.title,'Changed title');
  assert.equal((await getProducts({query:'Changed title',publicView:true})).products[0]?.id,row.id);
  assert.equal((await getProducts({query:"' OR true; DROP TABLE public.products; --",publicView:true})).total,0);
  assert.ok((await getProducts()).total>=3);
  assert.deepEqual(await deleteProduct(row.id),{success:true});
  assert.equal(await getProductByIdOrSlug(row.id),null);
});
test('Public projections exclude all private file and internal fields, including future columns',async()=>{
  const result=await getProducts({publicView:true});
  for(const row of result.products) for(const field of ['main_pdf_key','sample_pdf_key','main_pdf_sha256','main_pdf_bytes','search_vector','download_limit','watermark_enabled']) assert.equal(field in row,false,field);
  assert.equal((await getProductByIdOrSlug(SEED_BOOK_IDS['the-long-afternoon']!,true))?.main_pdf_key,undefined);
});
test('Seed repeats and concurrent calls create one Auth user/profile/admin without resetting its password',async()=>{
  const auth=client();
  const password=randomBytes(24).toString('base64url');
  const email=`seed-${randomUUID()}@example.com`;
  const first=await seedAdmin(auth.auth.admin,{email,password});
  assert.equal(first.existed,false);
  const before=authWrites.length;
  await Promise.all([seedAdmin(auth.auth.admin,{email,password:randomBytes(24).toString('hex')}),seedAdmin(auth.auth.admin,{email})]);
  assert.equal(authWrites.length,before);
  const rows=await db.query('SELECT p.id,p.role,a.user_id FROM public.profiles p JOIN public.admin_users a ON a.user_id=p.id WHERE p.email=$1',[email]);
  assert.equal(rows.length,1); assert.equal(rows[0]!.role,'admin');
  const signedIn=await auth.auth.signInWithPassword({email,password});
  assert.equal(signedIn.error,null);
  const token=signedIn.data.session!.access_token;
  assert.equal((await admin.GET(req(token))).status,200);
  const identity=await me.GET(req(token,'/api/auth/me'));
  assert.equal((await identity.json()).isAdmin,true);
  const invalid=await auth.auth.signInWithPassword({email,password:randomBytes(24).toString('hex')});
  assert.ok(invalid.error);
});
test('Seed only changes an existing password with the explicit reset option',async()=>{
  const auth=client(),email=`reset-${randomUUID()}@example.com`,oldPassword=randomBytes(24).toString('hex'),password=randomBytes(24).toString('hex');
  await seedAdmin(auth.auth.admin,{email,password:oldPassword});
  await seedAdmin(auth.auth.admin,{email,password,resetPassword:true});
  assert.ok((await auth.auth.signInWithPassword({email,password:oldPassword})).error);
  assert.equal((await auth.auth.signInWithPassword({email,password})).error,null);
});
test('Seed confirms an existing account without changing its password and never persists credentials in public tables',async()=>{
  const auth=client(), email=`confirm-${randomUUID()}@example.com`, password=randomBytes(24).toString('base64url');
  const created=await auth.auth.admin.createUser({email,password,email_confirm:false});
  assert.equal(created.error,null);
  const before=authWrites.length;
  await seedAdmin(auth.auth.admin,{email});
  assert.deepEqual(authWrites[before],{action:'update',id:created.data.user!.id,reset:false});
  assert.equal((await auth.auth.signInWithPassword({email,password})).error,null);
  const [row]=await db.query('SELECT to_jsonb(p) AS profile FROM public.profiles p WHERE id=$1',[created.data.user!.id]);
  assert.equal(JSON.stringify(row).includes(password),false);
  assert.equal('password' in row!.profile,false);
});
test('Seed validates inputs and preflights PostgreSQL before any Auth write',async t=>{
  const auth=client(),before=authWrites.length;
  await assert.rejects(seedAdmin(auth.auth.admin,{email:'invalid'}));
  await assert.rejects(seedAdmin(auth.auth.admin,{email:'valid@example.com',password:'short'}));
  t.mock.method(getPool(),'connect',async()=>{throw new Error('offline');});
  await assert.rejects(seedAdmin(auth.auth.admin,{email:`offline-${randomUUID()}@example.com`,password:randomBytes(24).toString('hex')}),{code:'upstream_error'});
  assert.equal(authWrites.length,before);
});
test('Signup metadata and the obsolete email allowlist cannot promote a customer',async()=>{
  const id=randomUUID(),email=`signup-${id}@example.com`;
  await db.query("UPDATE public.site_settings SET value=jsonb_build_array($1::text) WHERE key='admin_bootstrap_emails'",[email]);
  await engine.query('INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,$2,$3::jsonb)',[id,email,JSON.stringify({role:'admin',is_admin:true})]);
  const [row]=await db.query('SELECT role FROM public.profiles WHERE id=$1',[id]);
  assert.equal(row!.role,'customer');
  assert.equal((await db.query('SELECT user_id FROM public.admin_users WHERE user_id=$1',[id])).length,0);
});
test('PostgreSQL URLs and credential fields are redacted from log messages, objects and error stacks',t=>{
  const lines: string[]=[];
  t.mock.method(console,'error',(...args: unknown[])=>{lines.push(JSON.stringify(args));});
  const secret=randomBytes(24).toString('hex');
  const url=`postgresql://postgres:${secret}@example.invalid/postgres`;
  logger.error(`Failed ${url}`,new Error(`Driver failed for ${url}`),{DATABASE_URL:url,connectionString:url,password:secret});
  assert.equal(lines.join('').includes(secret),false);
  assert.ok(lines.join('').includes('redacted'));
});
test('Seed error diagnostics identify connection, Auth lookup/create/update and upsert stages without leaking secrets', async t => {
  const secret = () => randomBytes(24).toString('base64url');
  const databasePassword = `${secret()}@/:?#`;
  const source = {
    DATABASE_URL: `postgresql://postgres:${encodeURIComponent(databasePassword)}@127.0.0.1:1/postgres`,
    SUPABASE_SERVICE_ROLE_KEY: secret(), NEXT_PUBLIC_SUPABASE_ANON_KEY: secret(),
    ADMIN_BOOTSTRAP_PASSWORD: secret(),
  };
  const authorization = secret();
  const leak = ` DATABASE_URL=${source.DATABASE_URL} password=${databasePassword} encoded=${encodeURIComponent(databasePassword)}` +
    ` service=${source.SUPABASE_SERVICE_ROLE_KEY} anon=${source.NEXT_PUBLIC_SUPABASE_ANON_KEY} admin=${source.ADMIN_BOOTSTRAP_PASSWORD}` +
    `\n{"Authorization":"Bearer ${authorization}"}\nAuthorization: Basic ${authorization}`;
  const logs: unknown[][] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => { logs.push(args); });
  const report = (stage: Parameters<typeof logSeedFailure>[0], error: unknown) => logSeedFailure(stage, error, source);
  const latest = () => JSON.parse(logs.filter(args => args[0] === 'Admin seed failed:').at(-1)![1] as string);

  await t.test('connection errors retain the PostgreSQL/network code', async sub => {
    sub.mock.method(getPool(), 'connect', async () => { throw Object.assign(new Error(`Connection refused${leak}`), { code: 'ECONNREFUSED' }); });
    await assert.rejects(seedAdmin(client().auth.admin, { email: 'admin@bookishbae.com' }, report), { code: 'upstream_error' });
    assert.equal(latest().stage, 'database connection');
    assert.equal(latest().code, 'ECONNREFUSED');
    assert.match(latest().message, /Connection refused/);
  });
  await t.test('lookup errors retain Supabase HTTP status, code and message', async sub => {
    const auth = client().auth.admin;
    sub.mock.method(auth, 'listUsers', async () => ({ data: { users: [] }, error: new AuthApiError(`Auth lookup denied${leak}`, 401, 'invalid_api_key') }));
    await assert.rejects(seedAdmin(auth, { email: 'admin@bookishbae.com' }, report));
    assert.equal(latest().stage, 'Supabase Auth user lookup');
    assert.equal(latest().status, 401);
    assert.equal(latest().code, 'invalid_api_key');
    assert.match(latest().message, /Auth lookup denied/);
  });
  await t.test('create errors identify the creation step', async sub => {
    const auth = client().auth.admin;
    sub.mock.method(auth, 'createUser', async () => ({ data: { user: null }, error: new AuthApiError(`Password policy rejected${leak}`, 422, 'weak_password') }));
    await assert.rejects(seedAdmin(auth, { email: `diagnostics-${randomUUID()}@example.com`, password: source.ADMIN_BOOTSTRAP_PASSWORD }, report));
    assert.equal(latest().stage, 'Supabase Auth user create');
    assert.equal(latest().status, 422);
    assert.equal(latest().code, 'weak_password');
  });
  await t.test('confirmation errors identify the update step without requesting a password reset', async sub => {
    const auth = client().auth.admin;
    sub.mock.method(auth, 'listUsers', async () => ({ data: { users: [{ id: ADMIN_ID, email: 'admin@bookishbae.com' }] }, error: null }));
    sub.mock.method(auth, 'updateUserById', async (_id: string, attributes: unknown) => {
      assert.deepEqual(attributes, { email_confirm: true });
      return { data: { user: null }, error: new AuthApiError(`Confirmation denied${leak}`, 403, 'not_admin') };
    });
    await assert.rejects(seedAdmin(auth, { email: 'admin@bookishbae.com' }, report));
    assert.equal(latest().stage, 'Supabase Auth user update');
    assert.equal(latest().status, 403);
  });
  await t.test('upsert errors retain the original PostgreSQL code', async sub => {
    const connect = getPool().connect.bind(getPool());
    sub.mock.method(getPool(), 'connect', async () => {
      const connection = await connect();
      const query = connection.query.bind(connection);
      connection.query = (async (text: string, values: unknown[]) => {
        if (text.startsWith('INSERT INTO public.profiles')) throw Object.assign(new Error(`Profile constraint failed${leak}`), { code: '23505', detail: leak, headers: { authorization } });
        return query(text, values);
      }) as typeof connection.query;
      return connection;
    });
    await assert.rejects(seedAdmin(client().auth.admin, { email: 'admin@bookishbae.com' }, report), { code: 'conflict' });
    assert.equal(latest().stage, 'database upsert');
    assert.equal(latest().code, '23505');
    assert.match(latest().message, /Profile constraint failed/);
  });

  const output = JSON.stringify(logs);
  for (const value of [...Object.values(source), databasePassword, encodeURIComponent(databasePassword), authorization]) {
    assert.equal(output.includes(value), false, 'Seed diagnostics must not contain any credential or authorization value');
  }
  assert.match(output, /redacted/);
});
test('Auth checks refuse unauthenticated, forged roles and customer sessions; membership revocation is immediate',async()=>{
  assert.equal((await admin.GET(req())).status,401);
  assert.equal((await admin.GET(new NextRequest('http://localhost:3000/api/admin/products',{headers:{'x-test-role':'admin','x-dev-admin':'true',cookie:'bb_dev_admin=true'}}))).status,401);
  assert.equal((await admin.GET(req('fixture-customer-token'))).status,403);
  assert.equal((await admin.GET(req('fixture-admin-token'))).status,200);
  await db.query('DELETE FROM public.admin_users WHERE user_id=$1',[ADMIN_ID]);
  try{assert.equal((await admin.GET(req('fixture-admin-token'))).status,403);}finally{await db.query('INSERT INTO public.admin_users(user_id) VALUES($1)',[ADMIN_ID]);}
});
test('Profile endpoint edits only the authenticated admin and rejects role/user-id injection',async()=>{
  assert.equal((await profile.PATCH(req('fixture-customer-token','/api/admin/profile','PATCH',{fullName:'Customer'}))).status,403);
  assert.equal((await profile.PATCH(req('fixture-admin-token','/api/admin/profile','PATCH',{fullName:'Escalation',role:'admin',id:CUSTOMER_ID}))).status,422);
  assert.equal((await profile.PATCH(req('fixture-admin-token','/api/admin/profile','PATCH',{fullName:'Configured Admin',phone:'',avatarUrl:''}))).status,200);
  assert.equal((await db.query('SELECT full_name FROM public.profiles WHERE id=$1',[ADMIN_ID]))[0]!.full_name,'Configured Admin');
});
test('Payment write failure rolls back paid status, sales counters and coupon redemption',async()=>{
  const order=await createOrder({productId:SEED_BOOK_IDS['the-long-afternoon']!,email:'transaction@example.com',fullName:'Reader',phone:'9876543210',couponCode:'launch50'});
  await assert.rejects(markOrderPaid(order.order.id,{paymentId:randomUUID(),amountPaise:1}),{code:'bad_request'});
  assert.equal((await getOrderById(order.order.id))?.status,'pending');
  assert.equal((await db.query('SELECT id FROM public.coupon_redemptions WHERE order_id=$1',[order.order.id])).length,0);
  await markOrderPaid(order.order.id,{paymentId:`capture-${order.order.id}`,amountPaise:order.order.total_paise});
  assert.equal((await getOrderById(order.order.id))?.status,'paid');
  assert.equal((await markOrderPaid(order.order.id)).alreadyPaid,true);
  assert.equal((await db.query('SELECT id FROM public.coupon_redemptions WHERE order_id=$1',[order.order.id])).length,1);
  assert.ok((await getDashboardStats()).revenuePaise>0);
  assert.equal((await verification.POST(req(undefined,'/api/checkout/verify','POST',{orderId:order.order.order_number}))).status,401);
  assert.equal((await verification.POST(req('fixture-customer-token','/api/checkout/verify','POST',{orderId:order.order.id}))).status,403);
});
test('PostgreSQL rate limiter enforces configured limits; unavailable DB has no memory fallback',async t=>{
  const original=env.RATE_LIMIT_ENABLED; env.RATE_LIMIT_ENABLED=true;
  try{
    const bucket=`test:${randomUUID()}`;
    assert.equal((await rateLimit(bucket,{limit:1,windowSeconds:60})).allowed,true);
    assert.equal((await rateLimit(bucket,{limit:1,windowSeconds:60})).allowed,false);
    t.mock.method(getPool(),'query',async()=>{throw new Error('offline');});
    await assert.rejects(rateLimit(bucket,{limit:1,windowSeconds:60}),{code:'upstream_error'});
  }finally{env.RATE_LIMIT_ENABLED=original;}
});
test('Database outage never returns saved settings, catalogue data, orders or profile success',async t=>{
  t.mock.method(getPool(),'query',async()=>{throw new Error('offline postgres://user:never-log-this@host/db');});
  const response=await settings.GET(req('fixture-admin-token','/api/admin/settings'));
  assert.equal(response.status,502);
  const raw=await response.text(); assert.equal(raw.includes('never-log-this'),false);
  await assert.rejects(getProducts(),{code:'upstream_error'});
  await assert.rejects(transaction(async()=>{throw new Error('force rollback');}),{code:'upstream_error'});
});
test('TLS verifies certificates, prevents URL overrides and limits plaintext to localhost',()=>{
  assert.throws(()=>poolConfig({DATABASE_URL:'https://example.com'}),/PostgreSQL URL/);
  assert.throws(()=>poolConfig({DATABASE_URL:'postgresql://user@remote.invalid/db',DATABASE_SSL_MODE:'disable'}),/only for local/);
  const config=poolConfig({DATABASE_URL:'postgresql://user@remote.invalid/db?sslmode=no-verify'});
  assert.equal((config.ssl as {rejectUnauthorized:boolean}).rejectUnauthorized,true);
  assert.equal(config.connectionString!.includes('sslmode'),false);
});
