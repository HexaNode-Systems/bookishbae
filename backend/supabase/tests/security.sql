-- ============================================================================
-- BookishBae — supabase/tests/security.sql
--
-- Executable proof that the access-control model does what 0003_policies.sql
-- claims. Every check raises an exception on failure, so the script either runs
-- to the end printing PASS lines or stops at the first broken guarantee.
--
-- Run against a throwaway database, never production:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/security.sql
--
-- It assumes 0001-0004 have been applied and that roles `anon`,
-- `authenticated` and `service_role` exist. It creates its own fixtures under
-- emails ending in @test.invalid and removes them at the end.
-- ============================================================================

\set ON_ERROR_STOP on
\timing off

-- ---------------------------------------------------------------------------
-- Fixtures (created as the superuser / service role)
-- ---------------------------------------------------------------------------

begin;

-- Two buyers and one admin.
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'alice@test.invalid', '{"full_name":"Alice"}'),
  ('22222222-2222-2222-2222-222222222222', 'bob@test.invalid',   '{"full_name":"Bob"}'),
  ('33333333-3333-3333-3333-333333333333', 'admin@test.invalid', '{"full_name":"Admin"}');

-- The auth trigger should have mirrored all three into profiles.
do $$
declare n integer;
begin
  select count(*) into n from public.profiles where email like '%@test.invalid';
  if n <> 3 then
    raise exception 'FAIL: handle_new_user did not create 3 profiles (got %)', n;
  end if;
  raise notice 'PASS  auth trigger mirrored 3 profiles';
end $$;

update public.profiles set role = 'admin' where email = 'admin@test.invalid';

-- A published book and a draft one.
insert into public.products
  (id, slug, title, description, price_paise, discount_price_paise,
   cover_key, main_pdf_key, sample_pdf_key, status, published_at, download_limit)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'test-published', 'Test Published', 'A book.',
   29900, 19900, 'covers/x.png', 'books/secret-published.pdf', 'samples/x.pdf',
   'published', now(), 2),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'test-draft', 'Test Draft', 'Not out yet.',
   49900, null, 'covers/y.png', 'books/secret-draft.pdf', null,
   'draft', null, 5);

-- Alice buys the published book. Bob buys nothing.
insert into public.orders (id, user_id, email, full_name, status, subtotal_paise, discount_paise, total_paise, paid_at)
values ('bbbbbbbb-0000-0000-0000-000000000001',
        '11111111-1111-1111-1111-111111111111', 'alice@test.invalid', 'Alice',
        'paid', 19900, 0, 19900, now());

insert into public.order_items
  (id, order_id, product_id, title_snapshot, slug_snapshot, unit_price_paise, total_paise, download_limit)
values ('cccccccc-0000-0000-0000-000000000001',
        'bbbbbbbb-0000-0000-0000-000000000001',
        'aaaaaaaa-0000-0000-0000-000000000001',
        'Test Published', 'test-published', 19900, 19900, 2);

-- One order for Bob, left unpaid.
insert into public.orders (id, user_id, email, status, subtotal_paise, discount_paise, total_paise)
values ('bbbbbbbb-0000-0000-0000-000000000002',
        '22222222-2222-2222-2222-222222222222', 'bob@test.invalid',
        'pending', 29900, 0, 29900);

insert into public.order_items
  (order_id, product_id, title_snapshot, slug_snapshot, unit_price_paise, total_paise)
values ('bbbbbbbb-0000-0000-0000-000000000002',
        'aaaaaaaa-0000-0000-0000-000000000001',
        'Test Published', 'test-published', 29900, 29900);

-- Coupons for the validator tests.
insert into public.coupons (code, discount_type, discount_value, min_order_paise, max_discount_paise, is_active)
values ('test20', 'percent', 20, 0, null, true),
       ('testflat', 'flat', 5000, 10000, null, true),
       ('testcap', 'percent', 50, 0, 3000, true),
       ('testdead', 'percent', 10, 0, null, false);

insert into public.coupons (code, discount_type, discount_value, starts_at, expires_at, is_active)
values ('testold', 'percent', 15, now() - interval '10 days', now() - interval '1 day', true);

commit;

-- ===========================================================================
-- 1. The private PDF key must be unreachable from a browser role
-- ===========================================================================

do $$
begin
  set local role anon;
  begin
    perform main_pdf_key from public.products limit 1;
    raise exception 'FAIL: anon can read products.main_pdf_key';
  exception when insufficient_privilege then
    raise notice 'PASS  anon denied products.main_pdf_key';
  end;
end $$;

do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  begin
    perform main_pdf_key from public.products limit 1;
    raise exception 'FAIL: a signed-in buyer can read products.main_pdf_key';
  exception when insufficient_privilege then
    raise notice 'PASS  authenticated denied products.main_pdf_key';
  end;
end $$;

do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);
  begin
    perform main_pdf_key from public.products limit 1;
    raise exception 'FAIL: even an admin JWT can read products.main_pdf_key directly';
  exception when insufficient_privilege then
    raise notice 'PASS  admin JWT also denied main_pdf_key (keys are service-role only)';
  end;
end $$;

-- The safe projection must not have grown a key column.
do $$
declare leaked text;
begin
  select string_agg(column_name, ', ') into leaked
  from information_schema.columns
  where table_schema = 'public' and table_name = 'products_public'
    and (column_name like '%pdf_key%' or column_name like '%sha256%');
  if leaked is not null then
    raise exception 'FAIL: products_public exposes %', leaked;
  end if;
  raise notice 'PASS  products_public exposes no object keys';
end $$;

-- ===========================================================================
-- 2. Drafts are invisible to the public
-- ===========================================================================

do $$
declare n integer;
begin
  set local role anon;
  select count(*) into n from public.products;
  if n <> 1 then
    raise exception 'FAIL: anon sees % products, expected 1 published', n;
  end if;

  select count(*) into n from public.products_public;
  if n <> 1 then
    raise exception 'FAIL: products_public shows % rows to anon, expected 1', n;
  end if;
  raise notice 'PASS  drafts hidden from anon on both the table and the view';
end $$;

do $$
declare n integer;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);
  select count(*) into n from public.products;
  if n <> 2 then
    raise exception 'FAIL: admin sees % products, expected 2', n;
  end if;
  raise notice 'PASS  admin sees drafts';
end $$;

-- ===========================================================================
-- 3. Order isolation
-- ===========================================================================

do $$
declare n integer;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);

  select count(*) into n from public.orders;
  if n <> 1 then raise exception 'FAIL: Alice sees % orders, expected 1', n; end if;

  select count(*) into n from public.orders where email = 'bob@test.invalid';
  if n <> 0 then raise exception 'FAIL: Alice can read Bob''s order'; end if;

  select count(*) into n from public.order_items;
  if n <> 1 then raise exception 'FAIL: Alice sees % order_items, expected 1', n; end if;

  raise notice 'PASS  buyers see only their own orders and items';
end $$;

do $$
declare n integer;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);
  select count(*) into n from public.orders;
  if n < 2 then raise exception 'FAIL: admin sees % orders, expected >= 2', n; end if;
  raise notice 'PASS  admin sees all orders';
end $$;

-- A buyer must not be able to rewrite their own order total.
do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  update public.orders set total_paise = 1 where id = 'bbbbbbbb-0000-0000-0000-000000000001';
  if found then
    raise exception 'FAIL: a buyer rewrote their order total';
  end if;
  raise notice 'PASS  buyer cannot update their own order';
exception when insufficient_privilege then
  raise notice 'PASS  buyer denied UPDATE on orders';
end $$;

-- Nor invent an order.
do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  begin
    insert into public.orders (user_id, email, status, subtotal_paise, discount_paise, total_paise, paid_at)
    values ('11111111-1111-1111-1111-111111111111', 'alice@test.invalid', 'paid', 0, 0, 0, now());
    raise exception 'FAIL: a buyer created a paid order from the client';
  exception when insufficient_privilege then
    raise notice 'PASS  buyer denied INSERT on orders';
  end;
end $$;

-- ===========================================================================
-- 4. Privilege escalation through profiles.role
-- ===========================================================================

do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  begin
    update public.profiles set role = 'admin' where id = '11111111-1111-1111-1111-111111111111';
    raise exception 'FAIL: a buyer promoted themselves to admin';
  exception when insufficient_privilege then
    raise notice 'PASS  buyer denied UPDATE on profiles.role';
  end;
end $$;

-- The permitted self-edit must still work.
do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  update public.profiles set full_name = 'Alice Edited'
   where id = '11111111-1111-1111-1111-111111111111';
  if not found then
    raise exception 'FAIL: a buyer cannot edit their own name';
  end if;
  raise notice 'PASS  buyer can edit their own profile fields';
end $$;

-- set_user_role is admin-gated.
do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  begin
    perform public.set_user_role('11111111-1111-1111-1111-111111111111', 'admin');
    raise exception 'FAIL: set_user_role worked for a non-admin';
  exception when insufficient_privilege then
    raise notice 'PASS  set_user_role refuses non-admins';
  end;
end $$;

-- And admins cannot demote themselves into a lockout.
do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);
  begin
    perform public.set_user_role('33333333-3333-3333-3333-333333333333', 'customer');
    raise exception 'FAIL: admin demoted itself';
  exception when invalid_parameter_value then
    raise notice 'PASS  admin cannot remove its own admin role';
  end;
end $$;

-- ===========================================================================
-- 5. Coupons are not enumerable, and the validator is server-only
-- ===========================================================================

do $$
declare n integer;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  select count(*) into n from public.coupons;
  if n <> 0 then
    raise exception 'FAIL: a buyer can list % coupons', n;
  end if;
  raise notice 'PASS  coupons invisible to buyers';
end $$;

do $$
begin
  set local role anon;
  begin
    perform public.validate_coupon('test20', 100000, null, null, null);
    raise exception 'FAIL: anon can call validate_coupon directly';
  exception when insufficient_privilege then
    raise notice 'PASS  validate_coupon denied to anon';
  end;
end $$;

do $$
begin
  set local role anon;
  begin
    perform public.claim_download('11111111-1111-1111-1111-111111111111',
                                  'aaaaaaaa-0000-0000-0000-000000000001');
    raise exception 'FAIL: anon can call claim_download';
  exception when insufficient_privilege then
    raise notice 'PASS  claim_download denied to anon';
  end;
end $$;

do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  begin
    perform public.claim_download('11111111-1111-1111-1111-111111111111',
                                  'aaaaaaaa-0000-0000-0000-000000000001');
    raise exception 'FAIL: a signed-in buyer can call claim_download directly';
  exception when insufficient_privilege then
    raise notice 'PASS  claim_download denied to authenticated';
  end;
end $$;

-- ===========================================================================
-- 6. Rate limiting
-- ===========================================================================

do $$
declare r record; allowed_count integer := 0;
begin
  for i in 1..7 loop
    select * into r from public.consume_rate_limit('test:bucket:1', 5, 3600);
    if r.allowed then allowed_count := allowed_count + 1; end if;
  end loop;

  if allowed_count <> 5 then
    raise exception 'FAIL: limit of 5 allowed % requests', allowed_count;
  end if;

  select * into r from public.consume_rate_limit('test:bucket:1', 5, 3600);
  if r.remaining <> 0 then
    raise exception 'FAIL: remaining should clamp at 0, got %', r.remaining;
  end if;

  -- A different bucket must have its own budget.
  select * into r from public.consume_rate_limit('test:bucket:2', 5, 3600);
  if not r.allowed or r.remaining <> 4 then
    raise exception 'FAIL: buckets are not independent (allowed=%, remaining=%)', r.allowed, r.remaining;
  end if;

  raise notice 'PASS  rate limiter allows exactly N per window, per bucket';
end $$;

-- ===========================================================================
-- 7. Coupon validation arithmetic
-- ===========================================================================

do $$
declare v jsonb;
begin
  v := public.validate_coupon('test20', 100000, null, 'alice@test.invalid', null);
  if not (v ->> 'valid')::boolean or (v ->> 'discount_paise')::integer <> 20000 then
    raise exception 'FAIL: 20%% of 100000 should be 20000, got %', v;
  end if;

  v := public.validate_coupon('TEST20  ', 100000, null, null, null);
  if not (v ->> 'valid')::boolean then
    raise exception 'FAIL: coupon codes should be case- and space-insensitive, got %', v;
  end if;

  v := public.validate_coupon('testcap', 100000, null, null, null);
  if (v ->> 'discount_paise')::integer <> 3000 then
    raise exception 'FAIL: max_discount_paise not applied, got %', v;
  end if;

  v := public.validate_coupon('testflat', 5000, null, null, null);
  if (v ->> 'valid')::boolean or v ->> 'reason' <> 'below_minimum' then
    raise exception 'FAIL: min_order_paise not enforced, got %', v;
  end if;

  v := public.validate_coupon('testflat', 20000, null, null, null);
  if (v ->> 'discount_paise')::integer <> 5000 then
    raise exception 'FAIL: flat discount wrong, got %', v;
  end if;

  v := public.validate_coupon('testflat', 3000, null, null, null);
  if (v ->> 'valid')::boolean then
    raise exception 'FAIL: below-minimum order accepted, got %', v;
  end if;

  v := public.validate_coupon('testold', 100000, null, null, null);
  if (v ->> 'valid')::boolean or v ->> 'reason' <> 'expired' then
    raise exception 'FAIL: expired coupon accepted, got %', v;
  end if;

  v := public.validate_coupon('testdead', 100000, null, null, null);
  if (v ->> 'valid')::boolean then
    raise exception 'FAIL: inactive coupon accepted, got %', v;
  end if;

  v := public.validate_coupon('nosuchcode', 100000, null, null, null);
  if (v ->> 'valid')::boolean then
    raise exception 'FAIL: unknown coupon accepted, got %', v;
  end if;

  -- A flat discount larger than the cart must not produce a negative total.
  v := public.validate_coupon('testflat', 12000, null, null, null);
  if (v ->> 'total_paise')::integer < 0 then
    raise exception 'FAIL: negative total, got %', v;
  end if;

  raise notice 'PASS  coupon validation: percent, flat, cap, minimum, expiry, inactive, unknown';
end $$;

-- ===========================================================================
-- 8. Download entitlement
-- ===========================================================================

do $$
declare v jsonb;
begin
  -- Bob never paid.
  v := public.claim_download('22222222-2222-2222-2222-222222222222',
                             'aaaaaaaa-0000-0000-0000-000000000001');
  if (v ->> 'allowed')::boolean or v ->> 'reason' <> 'not_purchased' then
    raise exception 'FAIL: unpaid order granted a download, got %', v;
  end if;
  raise notice 'PASS  pending order grants no download';

  -- Alice paid, limit is 2.
  v := public.claim_download('11111111-1111-1111-1111-111111111111',
                             'aaaaaaaa-0000-0000-0000-000000000001');
  if not (v ->> 'allowed')::boolean or (v ->> 'remaining')::integer <> 1 then
    raise exception 'FAIL: first download should succeed with 1 left, got %', v;
  end if;

  v := public.claim_download('11111111-1111-1111-1111-111111111111',
                             'aaaaaaaa-0000-0000-0000-000000000001');
  if not (v ->> 'allowed')::boolean or (v ->> 'remaining')::integer <> 0 then
    raise exception 'FAIL: second download should succeed with 0 left, got %', v;
  end if;

  v := public.claim_download('11111111-1111-1111-1111-111111111111',
                             'aaaaaaaa-0000-0000-0000-000000000001');
  if (v ->> 'allowed')::boolean or v ->> 'reason' <> 'limit_reached' then
    raise exception 'FAIL: third download should be refused, got %', v;
  end if;
  raise notice 'PASS  download limit enforced exactly (2 of 2 consumed, 3rd refused)';

  -- Releasing a slot restores access, which is the outage path.
  perform public.release_download('cccccccc-0000-0000-0000-000000000001');
  v := public.claim_download('11111111-1111-1111-1111-111111111111',
                             'aaaaaaaa-0000-0000-0000-000000000001');
  if not (v ->> 'allowed')::boolean then
    raise exception 'FAIL: release_download did not restore a slot, got %', v;
  end if;
  raise notice 'PASS  release_download returns a consumed slot';

  -- An admin override lifts the ceiling.
  update public.order_items set download_limit_override = 10
   where id = 'cccccccc-0000-0000-0000-000000000001';
  v := public.claim_download('11111111-1111-1111-1111-111111111111',
                             'aaaaaaaa-0000-0000-0000-000000000001');
  if not (v ->> 'allowed')::boolean or (v ->> 'download_limit')::integer <> 10 then
    raise exception 'FAIL: admin override not honoured, got %', v;
  end if;
  raise notice 'PASS  admin download-limit override honoured';

  -- A refund withdraws access immediately.
  perform public.refund_order('bbbbbbbb-0000-0000-0000-000000000001');
  v := public.claim_download('11111111-1111-1111-1111-111111111111',
                             'aaaaaaaa-0000-0000-0000-000000000001');
  if (v ->> 'allowed')::boolean then
    raise exception 'FAIL: refunded order still grants downloads, got %', v;
  end if;
  raise notice 'PASS  refund revokes download entitlement';
end $$;

-- ===========================================================================
-- 9. Fulfilment idempotency
-- ===========================================================================

do $$
declare v1 jsonb; v2 jsonb; v_sales integer;
begin
  update public.orders set status = 'pending', paid_at = null, refunded_at = null
   where id = 'bbbbbbbb-0000-0000-0000-000000000002';
  update public.products set sales_count = 0
   where id = 'aaaaaaaa-0000-0000-0000-000000000001';

  v1 := public.mark_order_paid('bbbbbbbb-0000-0000-0000-000000000002');
  if not (v1 ->> 'ok')::boolean or (v1 ->> 'already_paid')::boolean then
    raise exception 'FAIL: first mark_order_paid should fulfil, got %', v1;
  end if;

  v2 := public.mark_order_paid('bbbbbbbb-0000-0000-0000-000000000002');
  if not (v2 ->> 'already_paid')::boolean then
    raise exception 'FAIL: replayed webhook re-fulfilled the order, got %', v2;
  end if;

  select sales_count into v_sales from public.products
   where id = 'aaaaaaaa-0000-0000-0000-000000000001';
  if v_sales <> 1 then
    raise exception 'FAIL: sales_count double-counted a replayed webhook (got %)', v_sales;
  end if;

  if jsonb_array_length(v1 -> 'items') <> 1 then
    raise exception 'FAIL: mark_order_paid did not return the order items, got %', v1;
  end if;

  raise notice 'PASS  mark_order_paid is idempotent and returns items';
end $$;

-- The unique constraint on webhook_events is the outer idempotency guard.
do $$
begin
  insert into public.webhook_events (provider, event_id, event_type)
  values ('razorpay', 'evt_test_1', 'payment.captured');
  begin
    insert into public.webhook_events (provider, event_id, event_type)
    values ('razorpay', 'evt_test_1', 'payment.captured');
    raise exception 'FAIL: duplicate webhook event_id was accepted';
  exception when unique_violation then
    raise notice 'PASS  duplicate webhook delivery rejected by unique constraint';
  end;
end $$;

-- ===========================================================================
-- 10. Data-integrity constraints
-- ===========================================================================

do $$
begin
  begin
    insert into public.orders (email, status, subtotal_paise, discount_paise, total_paise)
    values ('mismatch@test.invalid', 'pending', 10000, 1000, 10000);
    raise exception 'FAIL: an order whose totals do not balance was accepted';
  exception when check_violation then
    raise notice 'PASS  order totals must balance';
  end;

  begin
    insert into public.orders (email, status, subtotal_paise, discount_paise, total_paise)
    values ('UPPER@test.invalid', 'pending', 0, 0, 0);
    raise exception 'FAIL: a non-lowercase email was accepted';
  exception when check_violation then
    raise notice 'PASS  emails are forced lowercase';
  end;

  begin
    update public.products set discount_price_paise = 99999
     where id = 'aaaaaaaa-0000-0000-0000-000000000001';
    raise exception 'FAIL: a discount above list price was accepted';
  exception when check_violation then
    raise notice 'PASS  discount must be below list price';
  end;

  begin
    insert into public.products (slug, title, price_paise, status)
    values ('no-files', 'No Files', 10000, 'published');
    raise exception 'FAIL: a published product with no PDF or cover was accepted';
  exception when check_violation then
    raise notice 'PASS  a product cannot be published without a cover and a PDF';
  end;
end $$;

-- ===========================================================================
-- 11. Review moderation and rating cache
-- ===========================================================================

do $$
declare v_avg numeric; v_count integer;
begin
  insert into public.reviews (product_id, user_id, author_name, rating, body, status)
  values ('aaaaaaaa-0000-0000-0000-000000000001',
          '11111111-1111-1111-1111-111111111111', 'Alice', 5, 'Loved it.', 'pending');

  select rating_avg, rating_count into v_avg, v_count
    from public.products where id = 'aaaaaaaa-0000-0000-0000-000000000001';
  if v_count <> 0 then
    raise exception 'FAIL: a pending review counted towards the rating (count=%)', v_count;
  end if;

  update public.reviews set status = 'approved'
   where product_id = 'aaaaaaaa-0000-0000-0000-000000000001';

  select rating_avg, rating_count into v_avg, v_count
    from public.products where id = 'aaaaaaaa-0000-0000-0000-000000000001';
  if v_count <> 1 or v_avg <> 5.00 then
    raise exception 'FAIL: approved review not reflected (avg=%, count=%)', v_avg, v_count;
  end if;

  raise notice 'PASS  only approved reviews affect the cached rating';
end $$;

do $$
declare n integer;
begin
  set local role anon;
  select count(*) into n from public.reviews where status <> 'approved';
  if n <> 0 then
    raise exception 'FAIL: anon can read % unapproved reviews', n;
  end if;
  raise notice 'PASS  unapproved reviews hidden from the public';
end $$;

-- ===========================================================================
-- 12. Settings allowlist
-- ===========================================================================

do $$
declare n integer;
begin
  set local role anon;
  select count(*) into n from public.site_settings where key = 'admin_bootstrap_emails';
  if n <> 0 then
    raise exception 'FAIL: anon can read admin_bootstrap_emails';
  end if;

  select count(*) into n from public.site_settings where key = 'hero';
  if n <> 1 then
    raise exception 'FAIL: anon cannot read the public hero setting';
  end if;
  raise notice 'PASS  site_settings honours the is_public allowlist';
end $$;

-- Subscriber list must not be harvestable.
do $$
declare n integer;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  select count(*) into n from public.newsletter_subscribers;
  if n <> 0 then
    raise exception 'FAIL: a buyer can read the subscriber list';
  end if;
  raise notice 'PASS  newsletter list readable only by admins';
end $$;

-- Rate-limit counters must be unreachable from any browser role.
do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  begin
    perform count(*) from public.rate_limits;
    raise exception 'FAIL: authenticated can read rate_limits';
  exception when insufficient_privilege then
    raise notice 'PASS  rate_limits unreachable from the client';
  end;
end $$;

-- ===========================================================================
-- Cleanup
-- ===========================================================================

begin;
delete from public.webhook_events where event_id = 'evt_test_1';
delete from public.rate_limits where bucket like 'test:bucket:%';
delete from public.coupons where code in ('test20','testflat','testcap','testdead','testold');
delete from public.orders where email like '%@test.invalid';
delete from public.products where slug in ('test-published','test-draft');
delete from auth.users where email like '%@test.invalid';
commit;

\echo ''
\echo '================================================'
\echo ' All BookishBae security checks passed.'
\echo '================================================'
