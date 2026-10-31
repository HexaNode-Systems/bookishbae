-- ============================================================================
-- BookishBae — 0002_functions.sql
-- Functions, triggers and views.
--
-- Every function here is written with `set search_path = ''` and fully-qualified
-- object names. That is deliberate: a SECURITY DEFINER function with a mutable
-- search_path is a privilege-escalation hole, because a caller who can create
-- objects in a schema on the path can shadow the ones we meant to call.
--
-- SECURITY DEFINER is used only where the function must see or change rows the
-- caller cannot reach through RLS. Each such function either checks
-- public.is_admin() itself or is revoked from anon/authenticated in
-- 0003_policies.sql and left callable by service_role alone.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Generic helpers
-- ---------------------------------------------------------------------------

/** Keeps `updated_at` honest without the application having to remember. */
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

/**
 * Salted SHA-256 of a client IP, hex-encoded.
 *
 * We log a hash rather than the address so the audit trail stays useful for
 * spotting abuse without becoming a pile of personal data. Requires a stable
 * salt — rotating it makes historical rows uncomparable, which is a feature
 * if you ever need to break the link deliberately.
 */
create or replace function public.hash_ip(p_ip text, p_salt text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_ip is null or p_ip = '' then null
    else encode(sha256(convert_to(p_salt || ':' || p_ip, 'utf8')), 'hex')
  end;
$$;

/**
 * True when the calling user is an admin.
 *
 * SECURITY DEFINER on purpose: it is used inside the RLS policies on
 * `profiles`, and a plain query there would recurse into those same policies.
 */
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  );
$$;

-- ---------------------------------------------------------------------------
-- Auth plumbing
-- ---------------------------------------------------------------------------

/**
 * Mirrors a new auth.users row into public.profiles, then does two things that
 * make the store behave the way buyers expect:
 *
 *   1. Promotes the account to admin if its email is listed in the
 *      `admin_bootstrap_emails` setting. This is how the very first admin is
 *      created without anyone opening the SQL editor.
 *   2. Claims any guest orders placed with the same email, so a buyer who
 *      checks out without an account and signs in afterwards finds the book
 *      already in their library.
 */
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email      text := lower(new.email);
  v_bootstrap  jsonb;
  v_role       public.user_role := 'customer';
begin
  select s.value into v_bootstrap
  from public.site_settings s
  where s.key = 'admin_bootstrap_emails';

  if v_bootstrap is not null
     and jsonb_typeof(v_bootstrap) = 'array'
     and v_bootstrap ? v_email then
    v_role := 'admin';
  end if;

  insert into public.profiles (id, email, full_name, avatar_url, role)
  values (
    new.id,
    v_email,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name'
    ),
    new.raw_user_meta_data ->> 'avatar_url',
    v_role
  )
  on conflict (id) do update
    set email      = excluded.email,
        full_name  = coalesce(public.profiles.full_name, excluded.full_name),
        avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url),
        updated_at = now();

  -- Attach past guest purchases to the new account.
  update public.orders
     set user_id = new.id, updated_at = now()
   where user_id is null and email = v_email;

  update public.coupon_redemptions
     set user_id = new.id
   where user_id is null and email = v_email;

  return new;
end;
$$;

/** Keeps profiles.email in step when a user changes their email in auth. */
create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles
       set email = lower(new.email), updated_at = now()
     where id = new.id;

    update public.orders
       set user_id = new.id, updated_at = now()
     where user_id is null and email = lower(new.email);
  end if;
  return new;
end;
$$;

/**
 * The only supported way to change a role.
 *
 * `authenticated` has no UPDATE privilege on profiles.role at all (see
 * 0003_policies.sql), so this function is the single audited door. It refuses
 * to let an admin strip their own admin rights, which would otherwise be an
 * easy way to lock the store out of its own admin panel.
 */
create or replace function public.set_user_role(p_user_id uuid, p_role public.user_role)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.profiles;
begin
  if not public.is_admin() then
    raise exception 'forbidden: admin role required' using errcode = '42501';
  end if;

  if p_user_id = auth.uid() and p_role <> 'admin' then
    raise exception 'refusing to remove your own admin role' using errcode = '22023';
  end if;

  update public.profiles
     set role = p_role, updated_at = now()
   where id = p_user_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'profile % not found', p_user_id using errcode = 'P0002';
  end if;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------

/** Human-readable order numbers: BB-2026-001042. */
create or replace function public.set_order_number()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.order_number is null or new.order_number = '' then
    new.order_number := 'BB-' || to_char(now(), 'YYYY') || '-' ||
                        lpad(nextval('public.order_number_seq')::text, 6, '0');
  end if;
  return new;
end;
$$;

/**
 * Marks an order paid and performs every side effect that must happen in the
 * same transaction as that state change.
 *
 * Idempotent: a second call for an already-paid order reports
 * `{"already_paid": true}` and changes nothing. The Razorpay webhook can and
 * will be delivered more than once, so this is load-bearing, not a nicety.
 *
 * Returns the order plus its items, so the caller can send the confirmation
 * email without a second round trip.
 */
create or replace function public.mark_order_paid(p_order_id uuid, p_paid_at timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order  public.orders;
  v_items  jsonb;
begin
  select * into v_order from public.orders where id = p_order_id for update;

  if v_order.id is null then
    return jsonb_build_object('ok', false, 'reason', 'order_not_found');
  end if;

  if v_order.status = 'paid' then
    return jsonb_build_object(
      'ok', true, 'already_paid', true,
      'order_id', v_order.id, 'order_number', v_order.order_number
    );
  end if;

  if v_order.status = 'refunded' then
    -- A capture arriving after a refund is an operational problem, not
    -- something to silently re-fulfil.
    return jsonb_build_object('ok', false, 'reason', 'order_refunded');
  end if;

  update public.orders
     set status = 'paid', paid_at = coalesce(p_paid_at, now()), updated_at = now()
   where id = p_order_id
  returning * into v_order;

  -- Bestseller counters.
  update public.products p
     set sales_count = p.sales_count + oi.quantity, updated_at = now()
    from public.order_items oi
   where oi.order_id = p_order_id and p.id = oi.product_id;

  -- Mark any verified-purchase reviews now that the purchase is real.
  update public.reviews r
     set is_verified_purchase = true, updated_at = now()
    from public.order_items oi
   where oi.order_id = p_order_id
     and r.product_id = oi.product_id
     and r.user_id = v_order.user_id;

  -- Record the coupon redemption only now, so abandoned checkouts never burn
  -- a usage slot.
  if v_order.coupon_id is not null and v_order.discount_paise > 0 then
    insert into public.coupon_redemptions (coupon_id, order_id, user_id, email, discount_paise)
    values (v_order.coupon_id, v_order.id, v_order.user_id, v_order.email, v_order.discount_paise)
    on conflict (coupon_id, order_id) do nothing;

    update public.coupons
       set times_used = times_used + 1, updated_at = now()
     where id = v_order.coupon_id;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'order_item_id', oi.id,
           'product_id', oi.product_id,
           'title', oi.title_snapshot,
           'slug', oi.slug_snapshot,
           'unit_price_paise', oi.unit_price_paise,
           'quantity', oi.quantity,
           'total_paise', oi.total_paise
         ) order by oi.created_at), '[]'::jsonb)
    into v_items
    from public.order_items oi
   where oi.order_id = p_order_id;

  return jsonb_build_object(
    'ok', true,
    'already_paid', false,
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'email', v_order.email,
    'full_name', v_order.full_name,
    'total_paise', v_order.total_paise,
    'items', v_items
  );
end;
$$;

/**
 * Records a refund and revokes the entitlement.
 *
 * Downloads are checked against order status, so flipping the order to
 * 'refunded' is what actually withdraws access — there is no separate
 * entitlement flag to forget.
 */
create or replace function public.refund_order(p_order_id uuid, p_refunded_at timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders where id = p_order_id for update;

  if v_order.id is null then
    return jsonb_build_object('ok', false, 'reason', 'order_not_found');
  end if;

  if v_order.status = 'refunded' then
    return jsonb_build_object('ok', true, 'already_refunded', true, 'order_id', v_order.id);
  end if;

  update public.orders
     set status = 'refunded', refunded_at = coalesce(p_refunded_at, now()), updated_at = now()
   where id = p_order_id;

  -- Give the sales counters back.
  update public.products p
     set sales_count = greatest(p.sales_count - oi.quantity, 0), updated_at = now()
    from public.order_items oi
   where oi.order_id = p_order_id and p.id = oi.product_id;

  return jsonb_build_object(
    'ok', true, 'already_refunded', false,
    'order_id', v_order.id, 'order_number', v_order.order_number, 'email', v_order.email
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Downloads
-- ---------------------------------------------------------------------------

/**
 * Atomically checks entitlement and consumes one download slot.
 *
 * This is the heart of the delivery security model. It answers one question —
 * "does this user hold an unexhausted, paid, non-refunded right to this
 * product?" — and if so decrements the counter under a row lock before
 * returning. The caller presigns a URL only on `allowed: true`.
 *
 * Call it with the service role from /api/download. Never from the browser.
 */
create or replace function public.claim_download(p_user_id uuid, p_product_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item_id         uuid;
  v_item            public.order_items;
  v_order           public.orders;
  v_effective_limit integer;
begin
  if p_user_id is null or p_product_id is null then
    return jsonb_build_object('allowed', false, 'reason', 'bad_request');
  end if;

  -- Pick the entitlement with the most headroom, newest purchase first. A
  -- buyer who bought the same book twice gets both allowances.
  select oi.id
    into v_item_id
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
   where oi.product_id = p_product_id
     and o.user_id = p_user_id
     and o.status = 'paid'
   order by (coalesce(oi.download_limit_override, oi.download_limit) - oi.downloads_used) desc,
            o.paid_at desc nulls last
   limit 1;

  if v_item_id is null then
    return jsonb_build_object('allowed', false, 'reason', 'not_purchased');
  end if;

  -- Re-read under a lock; two tabs clicking Download at once serialise here.
  select * into v_item from public.order_items where id = v_item_id for update;
  select * into v_order from public.orders where id = v_item.order_id;

  -- Status could have changed between the two statements (a refund landing
  -- mid-click), so verify again now that we hold the lock.
  if v_order.status <> 'paid' then
    return jsonb_build_object('allowed', false, 'reason', 'not_purchased');
  end if;

  v_effective_limit := coalesce(v_item.download_limit_override, v_item.download_limit);

  if v_item.downloads_used >= v_effective_limit then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'limit_reached',
      'order_item_id', v_item.id,
      'downloads_used', v_item.downloads_used,
      'download_limit', v_effective_limit
    );
  end if;

  update public.order_items
     set downloads_used = downloads_used + 1,
         last_downloaded_at = now()
   where id = v_item.id
  returning * into v_item;

  return jsonb_build_object(
    'allowed', true,
    'order_item_id', v_item.id,
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'downloads_used', v_item.downloads_used,
    'download_limit', v_effective_limit,
    'remaining', v_effective_limit - v_item.downloads_used
  );
end;
$$;

/**
 * Hands a consumed download slot back.
 *
 * Called from the error path in /api/download: if claim_download succeeded but
 * R2 presigning or watermarking then failed, the buyer should not lose one of
 * their five downloads for our outage.
 */
create or replace function public.release_download(p_order_item_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_used integer;
begin
  update public.order_items
     set downloads_used = greatest(downloads_used - 1, 0)
   where id = p_order_item_id
  returning downloads_used into v_used;

  return coalesce(v_used, 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- Coupons
-- ---------------------------------------------------------------------------

/**
 * Validates a coupon and computes the discount, in paise.
 *
 * Returns a jsonb verdict rather than raising, because "this code expired" is
 * a normal checkout outcome that the UI needs to render, not an error.
 *
 * Coupons are not readable by clients, so this SECURITY DEFINER function is the
 * only way a visitor learns anything about a code — and all it learns is
 * whether the exact string they typed is usable.
 */
create or replace function public.validate_coupon(
  p_code          text,
  p_subtotal_paise integer,
  p_product_id    uuid default null,
  p_email         text default null,
  p_user_id       uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_coupon    public.coupons;
  v_discount  integer;
  v_used_by   integer;
begin
  if p_code is null or p_subtotal_paise is null or p_subtotal_paise < 0 then
    return jsonb_build_object('valid', false, 'reason', 'bad_request');
  end if;

  select * into v_coupon from public.coupons where code = lower(trim(p_code));

  if v_coupon.id is null or not v_coupon.is_active then
    return jsonb_build_object('valid', false, 'reason', 'not_found');
  end if;

  if v_coupon.starts_at > now() then
    return jsonb_build_object('valid', false, 'reason', 'not_started');
  end if;

  if v_coupon.expires_at is not null and v_coupon.expires_at <= now() then
    return jsonb_build_object('valid', false, 'reason', 'expired');
  end if;

  if v_coupon.usage_limit is not null and v_coupon.times_used >= v_coupon.usage_limit then
    return jsonb_build_object('valid', false, 'reason', 'exhausted');
  end if;

  if v_coupon.product_id is not null
     and (p_product_id is null or v_coupon.product_id <> p_product_id) then
    return jsonb_build_object('valid', false, 'reason', 'not_applicable');
  end if;

  if p_subtotal_paise < v_coupon.min_order_paise then
    return jsonb_build_object(
      'valid', false, 'reason', 'below_minimum',
      'min_order_paise', v_coupon.min_order_paise
    );
  end if;

  if v_coupon.usage_limit_per_user is not null then
    select count(*) into v_used_by
      from public.coupon_redemptions cr
     where cr.coupon_id = v_coupon.id
       and (
         (p_user_id is not null and cr.user_id = p_user_id)
         or (p_email is not null and cr.email = lower(p_email))
       );

    if v_used_by >= v_coupon.usage_limit_per_user then
      return jsonb_build_object('valid', false, 'reason', 'already_used');
    end if;
  end if;

  if v_coupon.discount_type = 'percent' then
    v_discount := floor(p_subtotal_paise::numeric * v_coupon.discount_value / 100)::integer;
  else
    v_discount := v_coupon.discount_value;
  end if;

  if v_coupon.max_discount_paise is not null then
    v_discount := least(v_discount, v_coupon.max_discount_paise);
  end if;

  -- Never let a coupon produce a negative total.
  v_discount := greatest(least(v_discount, p_subtotal_paise), 0);

  return jsonb_build_object(
    'valid', true,
    'coupon_id', v_coupon.id,
    'code', v_coupon.code,
    'description', v_coupon.description,
    'discount_type', v_coupon.discount_type,
    'discount_paise', v_discount,
    'total_paise', p_subtotal_paise - v_discount
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Reviews
-- ---------------------------------------------------------------------------

/** Recomputes the cached rating on products from approved reviews only. */
create or replace function public.recalc_product_rating()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product_id uuid := coalesce(new.product_id, old.product_id);
begin
  update public.products p
     set rating_avg = sub.avg_rating,
         rating_count = sub.cnt,
         updated_at = now()
    from (
      select round(avg(r.rating)::numeric, 2) as avg_rating, count(*)::integer as cnt
        from public.reviews r
       where r.product_id = v_product_id and r.status = 'approved'
    ) sub
   where p.id = v_product_id;

  -- avg() over zero rows yields NULL, which is what we want in rating_avg, but
  -- rating_count is NOT NULL so normalise it.
  update public.products
     set rating_count = 0
   where id = v_product_id and rating_count is null;

  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Rate limiting
-- ---------------------------------------------------------------------------

/**
 * Fixed-window counter.
 *
 * Chosen over a sliding window because it is a single upsert with no read, so
 * it cannot deadlock and costs one round trip. The trade-off is that a client
 * can burst up to 2x the limit across a window boundary; for checkout and
 * download endpoints that is immaterial.
 *
 * `allowed` is false on the request that *exceeds* the limit, so a limit of 5
 * permits exactly five requests per window.
 */
create or replace function public.consume_rate_limit(
  p_bucket          text,
  p_limit           integer,
  p_window_seconds  integer
)
returns table (allowed boolean, used integer, remaining integer, reset_at timestamptz)
language plpgsql
set search_path = ''
as $$
declare
  v_window_start timestamptz;
  v_count        integer;
begin
  if p_limit <= 0 or p_window_seconds <= 0 then
    raise exception 'consume_rate_limit: limit and window must be positive'
      using errcode = '22023';
  end if;

  v_window_start := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds
  );

  insert into public.rate_limits as rl (bucket, window_start, count)
  values (p_bucket, v_window_start, 1)
  on conflict (bucket, window_start) do update
    set count = rl.count + 1
  returning rl.count into v_count;

  return query
    select v_count <= p_limit,
           v_count,
           greatest(p_limit - v_count, 0),
           v_window_start + make_interval(secs => p_window_seconds);
end;
$$;

/** Housekeeping for the counter table. Call from a cron route or pg_cron. */
create or replace function public.prune_rate_limits(p_older_than interval default interval '2 hours')
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.rate_limits where window_start < now() - p_older_than;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin reporting
-- ---------------------------------------------------------------------------

/**
 * Everything the admin dashboard needs, in one call.
 *
 * Checks is_admin() itself rather than relying on the route, so a leaked anon
 * key still cannot read revenue. Revenue counts paid orders only and excludes
 * refunds.
 */
create or replace function public.admin_dashboard_stats(p_days integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from        timestamptz;
  v_totals      jsonb;
  v_period      jsonb;
  v_series      jsonb;
  v_top         jsonb;
  v_recent      jsonb;
  v_counts      jsonb;
begin
  if not public.is_admin() then
    raise exception 'forbidden: admin role required' using errcode = '42501';
  end if;

  p_days := greatest(least(coalesce(p_days, 30), 365), 1);
  v_from := date_trunc('day', now()) - make_interval(days => p_days - 1);

  select jsonb_build_object(
           'revenue_paise', coalesce(sum(o.total_paise), 0),
           'orders', count(*),
           'aov_paise', coalesce(round(avg(o.total_paise))::integer, 0)
         )
    into v_totals
    from public.orders o
   where o.status = 'paid';

  select jsonb_build_object(
           'revenue_paise', coalesce(sum(o.total_paise), 0),
           'orders', count(*),
           'aov_paise', coalesce(round(avg(o.total_paise))::integer, 0)
         )
    into v_period
    from public.orders o
   where o.status = 'paid' and o.paid_at >= v_from;

  select coalesce(jsonb_agg(jsonb_build_object(
           'day', to_char(d.day, 'YYYY-MM-DD'),
           'revenue_paise', coalesce(agg.revenue, 0),
           'orders', coalesce(agg.orders, 0)
         ) order by d.day), '[]'::jsonb)
    into v_series
    from generate_series(v_from, date_trunc('day', now()), interval '1 day') as d(day)
    left join (
      select date_trunc('day', o.paid_at) as day,
             sum(o.total_paise)::bigint as revenue,
             count(*)::bigint as orders
        from public.orders o
       where o.status = 'paid' and o.paid_at >= v_from
       group by 1
    ) agg on agg.day = d.day;

  select coalesce(jsonb_agg(t), '[]'::jsonb)
    into v_top
    from (
      select jsonb_build_object(
               'product_id', p.id,
               'title', p.title,
               'slug', p.slug,
               'cover_key', p.cover_key,
               'units', sum(oi.quantity)::integer,
               'revenue_paise', sum(oi.total_paise)::bigint
             ) as t
        from public.order_items oi
        join public.orders o on o.id = oi.order_id
        join public.products p on p.id = oi.product_id
       where o.status = 'paid'
       group by p.id, p.title, p.slug, p.cover_key
       order by sum(oi.total_paise) desc
       limit 5
    ) top;

  select coalesce(jsonb_agg(r), '[]'::jsonb)
    into v_recent
    from (
      select jsonb_build_object(
               'order_id', o.id,
               'order_number', o.order_number,
               'email', o.email,
               'full_name', o.full_name,
               'total_paise', o.total_paise,
               'status', o.status,
               'paid_at', o.paid_at,
               'created_at', o.created_at
             ) as r
        from public.orders o
       order by o.created_at desc
       limit 10
    ) recent;

  select jsonb_build_object(
           'customers', (select count(*) from public.profiles),
           'products_published', (select count(*) from public.products where status = 'published'),
           'products_draft', (select count(*) from public.products where status = 'draft'),
           'orders_pending', (select count(*) from public.orders where status = 'pending'),
           'orders_failed', (select count(*) from public.orders where status = 'failed'),
           'orders_refunded', (select count(*) from public.orders where status = 'refunded'),
           'reviews_pending', (select count(*) from public.reviews where status = 'pending'),
           'downloads_total', (select count(*) from public.downloads where succeeded),
           'downloads_refused', (select count(*) from public.downloads where not succeeded)
         )
    into v_counts;

  return jsonb_build_object(
    'window_days', p_days,
    'generated_at', now(),
    'all_time', v_totals,
    'period', v_period,
    'series', v_series,
    'top_products', v_top,
    'recent_orders', v_recent,
    'counts', v_counts
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists categories_touch on public.categories;
create trigger categories_touch before update on public.categories
  for each row execute function public.touch_updated_at();

drop trigger if exists products_touch on public.products;
create trigger products_touch before update on public.products
  for each row execute function public.touch_updated_at();

drop trigger if exists coupons_touch on public.coupons;
create trigger coupons_touch before update on public.coupons
  for each row execute function public.touch_updated_at();

drop trigger if exists orders_touch on public.orders;
create trigger orders_touch before update on public.orders
  for each row execute function public.touch_updated_at();

drop trigger if exists payments_touch on public.payments;
create trigger payments_touch before update on public.payments
  for each row execute function public.touch_updated_at();

drop trigger if exists reviews_touch on public.reviews;
create trigger reviews_touch before update on public.reviews
  for each row execute function public.touch_updated_at();

drop trigger if exists testimonials_touch on public.testimonials;
create trigger testimonials_touch before update on public.testimonials
  for each row execute function public.touch_updated_at();

drop trigger if exists site_settings_touch on public.site_settings;
create trigger site_settings_touch before update on public.site_settings
  for each row execute function public.touch_updated_at();

drop trigger if exists orders_set_number on public.orders;
create trigger orders_set_number before insert on public.orders
  for each row execute function public.set_order_number();

drop trigger if exists reviews_recalc_rating on public.reviews;
create trigger reviews_recalc_rating after insert or update or delete on public.reviews
  for each row execute function public.recalc_product_rating();

-- Triggers on auth.users must be created by a role that owns auth.users; on
-- Supabase the SQL editor runs as `postgres`, which can. If you apply these
-- migrations with a lesser role, run this block separately as postgres.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed after update of email on auth.users
  for each row execute function public.handle_user_email_change();

-- ---------------------------------------------------------------------------
-- products_public — the only product shape client code should read
--
-- This view runs with the owner's rights (security_invoker is NOT set), which
-- is what lets it test `sample_pdf_key is not null` without granting anyone
-- access to the key itself. Because the owner bypasses RLS, the
-- `where p.status = 'published'` clause at the bottom IS the access control
-- for this view. Do not remove it, and do not add a column that exposes an R2
-- object key.
--
-- Admin screens read public.products directly instead; they need drafts.
-- ---------------------------------------------------------------------------

create or replace view public.products_public
with (security_barrier = true) as
  select
    p.id,
    p.slug,
    p.title,
    p.subtitle,
    p.description,
    p.excerpt,
    p.author_name,
    p.category_id,
    c.slug  as category_slug,
    c.name  as category_name,
    p.price_paise,
    p.discount_price_paise,
    coalesce(p.discount_price_paise, p.price_paise) as effective_price_paise,
    case
      when p.discount_price_paise is null or p.price_paise = 0 then 0
      else round(((p.price_paise - p.discount_price_paise)::numeric / p.price_paise) * 100)::integer
    end as discount_percent,
    p.currency,
    p.cover_key,
    p.cover_width,
    p.cover_height,
    p.cover_alt,
    -- Whether a free sample exists, without revealing its object key.
    (p.sample_pdf_key is not null) as has_sample,
    p.page_count,
    p.language,
    p.isbn,
    p.status,
    p.is_featured,
    p.sales_count,
    p.rating_avg,
    p.rating_count,
    p.meta_title,
    p.meta_description,
    p.published_at,
    p.created_at
  from public.products p
  left join public.categories c on c.id = p.category_id
  where p.status = 'published';

comment on view public.products_public is
  'Published products only, with every R2 object key omitted. Owner-rights view: the WHERE clause is the access control.';
