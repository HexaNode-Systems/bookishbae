-- ============================================================================
-- BookishBae — 0001_schema.sql
-- Tables, enums, constraints and indexes.
--
-- Run order: 0001_schema.sql -> 0002_functions.sql -> 0003_policies.sql
--
-- Conventions used throughout:
--   * Money is stored as an INTEGER count of paise (1 INR = 100 paise). This is
--     Razorpay's native unit, so no rounding ever happens between our ledger and
--     the gateway's. Never introduce a float column for money.
--   * Emails are stored lowercased (enforced by CHECK) so plain unique indexes
--     and equality joins are case-insensitive without the citext extension.
--   * Every table gets created WITHOUT privileges here; 0003_policies.sql
--     revokes Supabase's permissive defaults and grants back exactly what each
--     role needs, column by column.
-- ============================================================================

set search_path = public;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.user_role as enum ('customer', 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.product_status as enum ('draft', 'published', 'archived');
exception when duplicate_object then null; end $$;

do $$ begin
  -- 'pending'   order row created, Razorpay order created, nothing paid yet
  -- 'paid'      webhook verified a capture; this is the ONLY state that entitles a download
  -- 'failed'    gateway reported a terminal failure
  -- 'cancelled' abandoned or cancelled before payment
  -- 'refunded'  money returned; entitlement revoked
  create type public.order_status as enum ('pending', 'paid', 'failed', 'cancelled', 'refunded');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.payment_status as enum
    ('created', 'authorized', 'captured', 'failed', 'refunded', 'partially_refunded');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.discount_type as enum ('percent', 'flat');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.review_status as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.download_kind as enum ('full', 'sample', 'watermarked');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- profiles — one row per auth.users row, created by a trigger (0002)
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  email             text not null,
  full_name         text,
  avatar_url        text,
  phone             text,
  role              public.user_role not null default 'customer',
  marketing_opt_in  boolean not null default false,
  notes             text,                       -- admin-only free text
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint profiles_email_lowercase check (email = lower(email)),
  constraint profiles_email_shape check (position('@' in email) > 1)
);

create unique index if not exists profiles_email_key on public.profiles (email);
create index if not exists profiles_role_idx on public.profiles (role) where role = 'admin';
create index if not exists profiles_created_at_idx on public.profiles (created_at desc);

comment on table public.profiles is
  'Public mirror of auth.users plus store-specific fields. Role changes must go through public.set_user_role().';

-- ---------------------------------------------------------------------------
-- categories
-- ---------------------------------------------------------------------------

create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  description text,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint categories_slug_shape check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create index if not exists categories_sort_idx on public.categories (sort_order, name);

-- ---------------------------------------------------------------------------
-- products
--
-- The three R2 object keys are the crown jewels: `main_pdf_key` points at an
-- object in the PRIVATE bucket and must never be selectable by anon or
-- authenticated. 0003_policies.sql enforces that with column-level grants, and
-- `products_public` is the view client code should read from.
-- ---------------------------------------------------------------------------

create table if not exists public.products (
  id                    uuid primary key default gen_random_uuid(),
  slug                  text not null unique,
  title                 text not null,
  subtitle              text,
  description           text not null default '',
  -- Short marketing line used on cards and in OG descriptions.
  excerpt               text,
  author_name           text not null default 'Annu',
  category_id           uuid references public.categories (id) on delete set null,

  price_paise           integer not null check (price_paise >= 0),
  discount_price_paise  integer check (discount_price_paise >= 0),
  currency              char(3) not null default 'INR',

  cover_key             text,      -- key in the PUBLIC media bucket
  cover_width           integer,
  cover_height          integer,
  cover_alt             text,
  sample_pdf_key        text,      -- PRIVATE bucket; presigned to anyone, no purchase needed
  main_pdf_key          text,      -- PRIVATE bucket; presigned only after entitlement check
  main_pdf_bytes        bigint check (main_pdf_bytes is null or main_pdf_bytes >= 0),
  main_pdf_sha256       text,

  page_count            integer check (page_count is null or page_count > 0),
  language              text not null default 'en',
  isbn                  text,

  status                public.product_status not null default 'draft',
  is_featured           boolean not null default false,

  -- Per-product watermarking. Off by default: watermarking forces the PDF
  -- through a server function, which is only viable for small files. See
  -- docs/DECISIONS.md #2.
  watermark_enabled     boolean not null default false,
  download_limit        integer not null default 5 check (download_limit > 0),

  sales_count           integer not null default 0 check (sales_count >= 0),
  rating_avg            numeric(3, 2) check (rating_avg is null or (rating_avg >= 1 and rating_avg <= 5)),
  rating_count          integer not null default 0 check (rating_count >= 0),

  meta_title            text,
  meta_description      text,

  published_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint products_slug_shape check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  -- A "discount" that is not below the list price is a pricing bug, not a sale.
  constraint products_discount_below_price
    check (discount_price_paise is null or discount_price_paise < price_paise),
  -- A published product must be sellable and deliverable.
  constraint products_publishable
    check (status <> 'published' or (main_pdf_key is not null and cover_key is not null)),

  search_vector tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(subtitle, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(excerpt, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(author_name, '')), 'C')
  ) stored
);

create index if not exists products_status_published_idx
  on public.products (status, published_at desc nulls last);
create index if not exists products_category_idx on public.products (category_id)
  where status = 'published';
create index if not exists products_featured_idx on public.products (is_featured)
  where status = 'published' and is_featured;
create index if not exists products_bestsellers_idx on public.products (sales_count desc, created_at desc)
  where status = 'published';
create index if not exists products_price_idx on public.products
  (coalesce(discount_price_paise, price_paise));
create index if not exists products_search_idx on public.products using gin (search_vector);
create index if not exists products_title_trgm_idx on public.products (lower(title));

comment on column public.products.main_pdf_key is
  'Object key in the PRIVATE R2 bucket. Not granted to anon/authenticated — read it with the service role only.';

-- ---------------------------------------------------------------------------
-- coupons
-- ---------------------------------------------------------------------------

create table if not exists public.coupons (
  id                    uuid primary key default gen_random_uuid(),
  code                  text not null,
  description           text,
  discount_type         public.discount_type not null,
  -- percent: 1..100. flat: an amount in paise.
  discount_value        integer not null check (discount_value > 0),
  max_discount_paise    integer check (max_discount_paise is null or max_discount_paise > 0),
  min_order_paise       integer not null default 0 check (min_order_paise >= 0),
  usage_limit           integer check (usage_limit is null or usage_limit > 0),
  usage_limit_per_user  integer check (usage_limit_per_user is null or usage_limit_per_user > 0),
  times_used            integer not null default 0 check (times_used >= 0),
  starts_at             timestamptz not null default now(),
  expires_at            timestamptz,
  -- null = applies to the whole cart; set = only this product
  product_id            uuid references public.products (id) on delete cascade,
  is_active             boolean not null default true,
  created_by            uuid references public.profiles (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint coupons_code_lowercase check (code = lower(code)),
  constraint coupons_code_shape check (code ~ '^[a-z0-9][a-z0-9_-]{1,31}$'),
  constraint coupons_percent_range
    check (discount_type <> 'percent' or discount_value between 1 and 100),
  constraint coupons_window check (expires_at is null or expires_at > starts_at)
);

create unique index if not exists coupons_code_key on public.coupons (code);
create index if not exists coupons_active_idx on public.coupons (is_active, expires_at)
  where is_active;

comment on table public.coupons is
  'Not readable by clients at all — codes would be enumerable. Validate through public.validate_coupon().';

-- ---------------------------------------------------------------------------
-- orders
-- ---------------------------------------------------------------------------

create table if not exists public.orders (
  id                  uuid primary key default gen_random_uuid(),
  order_number        text not null unique,
  -- Nullable so guests can buy; backfilled by the auth trigger when the buyer
  -- later signs in with the same email.
  user_id             uuid references public.profiles (id) on delete set null,
  email               text not null,
  full_name           text,

  status              public.order_status not null default 'pending',
  currency            char(3) not null default 'INR',
  subtotal_paise      integer not null default 0 check (subtotal_paise >= 0),
  discount_paise      integer not null default 0 check (discount_paise >= 0),
  total_paise         integer not null default 0 check (total_paise >= 0),

  coupon_id           uuid references public.coupons (id) on delete set null,
  coupon_code         text,

  razorpay_order_id   text,

  -- Hashed, never raw: see public.hash_ip() / lib/net.ts.
  ip_hash             text,
  user_agent          text,
  -- Free-form, non-sensitive metadata (utm params, locale).
  metadata            jsonb not null default '{}'::jsonb,

  paid_at             timestamptz,
  failed_at           timestamptz,
  refunded_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint orders_email_lowercase check (email = lower(email)),
  constraint orders_totals_balance check (total_paise = subtotal_paise - discount_paise),
  constraint orders_discount_within_subtotal check (discount_paise <= subtotal_paise),
  constraint orders_paid_has_timestamp check (status <> 'paid' or paid_at is not null)
);

create unique index if not exists orders_razorpay_order_id_key
  on public.orders (razorpay_order_id) where razorpay_order_id is not null;
create index if not exists orders_user_idx on public.orders (user_id, created_at desc);
create index if not exists orders_email_idx on public.orders (email, created_at desc);
create index if not exists orders_status_idx on public.orders (status, created_at desc);
create index if not exists orders_paid_at_idx on public.orders (paid_at desc) where status = 'paid';
create index if not exists orders_unclaimed_idx on public.orders (email)
  where user_id is null;

-- ---------------------------------------------------------------------------
-- order_items — the entitlement ledger. One row = one right to download.
-- ---------------------------------------------------------------------------

create table if not exists public.order_items (
  id                      uuid primary key default gen_random_uuid(),
  order_id                uuid not null references public.orders (id) on delete cascade,
  -- RESTRICT: a product that has ever been sold must not be deletable, or we
  -- would orphan a buyer's library. Archive it instead.
  product_id              uuid not null references public.products (id) on delete restrict,

  -- Snapshots so an invoice reprinted in two years still shows what was bought
  -- at the price it was bought for.
  title_snapshot          text not null,
  slug_snapshot           text not null,
  unit_price_paise        integer not null check (unit_price_paise >= 0),
  quantity                integer not null default 1 check (quantity > 0),
  total_paise             integer not null check (total_paise >= 0),

  download_limit          integer not null default 5 check (download_limit > 0),
  -- Admin override. NULL means "use download_limit".
  download_limit_override integer check (download_limit_override is null or download_limit_override >= 0),
  downloads_used          integer not null default 0 check (downloads_used >= 0),
  last_downloaded_at      timestamptz,

  created_at              timestamptz not null default now(),

  constraint order_items_unique_product unique (order_id, product_id)
);

create index if not exists order_items_order_idx on public.order_items (order_id);
create index if not exists order_items_product_idx on public.order_items (product_id);

comment on column public.order_items.downloads_used is
  'Incremented atomically by public.claim_download(); decremented by public.release_download() if presigning fails.';

-- ---------------------------------------------------------------------------
-- payments
-- ---------------------------------------------------------------------------

create table if not exists public.payments (
  id                      uuid primary key default gen_random_uuid(),
  order_id                uuid not null references public.orders (id) on delete cascade,
  razorpay_payment_id     text not null,
  razorpay_order_id       text,
  status                  public.payment_status not null,
  method                  text,
  amount_paise            integer not null check (amount_paise >= 0),
  currency                char(3) not null default 'INR',
  fee_paise               integer,
  tax_paise               integer,
  error_code              text,
  error_description       text,
  refund_id               text,
  refunded_amount_paise   integer check (refunded_amount_paise is null or refunded_amount_paise >= 0),
  -- Redacted copy of the gateway entity (card/VPA/contact stripped in
  -- lib/razorpay.ts before it reaches here). Admin-readable only.
  gateway_snapshot        jsonb not null default '{}'::jsonb,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create unique index if not exists payments_razorpay_payment_id_key
  on public.payments (razorpay_payment_id);
create index if not exists payments_order_idx on public.payments (order_id, created_at desc);
create index if not exists payments_status_idx on public.payments (status, created_at desc);

-- ---------------------------------------------------------------------------
-- webhook_events — the idempotency table for Razorpay delivery
-- ---------------------------------------------------------------------------

create table if not exists public.webhook_events (
  id            uuid primary key default gen_random_uuid(),
  provider      text not null default 'razorpay',
  -- Razorpay's `x-razorpay-event-id` header. Unique per (provider, event_id),
  -- which is what makes replayed deliveries no-ops.
  event_id      text not null,
  event_type    text not null,
  payload       jsonb,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz,
  attempts      integer not null default 0,
  error         text,
  constraint webhook_events_unique unique (provider, event_id)
);

create index if not exists webhook_events_unprocessed_idx
  on public.webhook_events (received_at) where processed_at is null;
create index if not exists webhook_events_type_idx
  on public.webhook_events (event_type, received_at desc);

-- ---------------------------------------------------------------------------
-- downloads — append-only audit log
-- ---------------------------------------------------------------------------

create table if not exists public.downloads (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references public.profiles (id) on delete set null,
  order_id      uuid references public.orders (id) on delete set null,
  order_item_id uuid references public.order_items (id) on delete set null,
  product_id    uuid not null references public.products (id) on delete cascade,
  kind          public.download_kind not null default 'full',
  object_key    text not null,
  ip_hash       text,
  user_agent    text,
  -- false = the attempt was refused (limit reached, no entitlement). Keeping
  -- refusals is what makes abuse visible.
  succeeded     boolean not null default true,
  refusal_reason text,
  created_at    timestamptz not null default now()
);

create index if not exists downloads_user_idx on public.downloads (user_id, created_at desc);
create index if not exists downloads_product_idx on public.downloads (product_id, created_at desc);
create index if not exists downloads_order_item_idx on public.downloads (order_item_id);
create index if not exists downloads_failed_idx on public.downloads (created_at desc)
  where not succeeded;

-- ---------------------------------------------------------------------------
-- coupon_redemptions
-- ---------------------------------------------------------------------------

create table if not exists public.coupon_redemptions (
  id              uuid primary key default gen_random_uuid(),
  coupon_id       uuid not null references public.coupons (id) on delete cascade,
  order_id        uuid not null references public.orders (id) on delete cascade,
  user_id         uuid references public.profiles (id) on delete set null,
  email           text not null,
  discount_paise  integer not null check (discount_paise >= 0),
  created_at      timestamptz not null default now(),
  constraint coupon_redemptions_unique unique (coupon_id, order_id),
  constraint coupon_redemptions_email_lowercase check (email = lower(email))
);

create index if not exists coupon_redemptions_coupon_idx on public.coupon_redemptions (coupon_id);
create index if not exists coupon_redemptions_email_idx on public.coupon_redemptions (coupon_id, email);
create index if not exists coupon_redemptions_user_idx on public.coupon_redemptions (user_id);

-- ---------------------------------------------------------------------------
-- reviews
-- ---------------------------------------------------------------------------

create table if not exists public.reviews (
  id                   uuid primary key default gen_random_uuid(),
  product_id           uuid not null references public.products (id) on delete cascade,
  user_id              uuid references public.profiles (id) on delete cascade,
  order_id             uuid references public.orders (id) on delete set null,
  author_name          text not null,
  rating               smallint not null check (rating between 1 and 5),
  title                text,
  body                 text,
  status               public.review_status not null default 'pending',
  is_verified_purchase boolean not null default false,
  moderated_by         uuid references public.profiles (id) on delete set null,
  moderated_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  -- One review per buyer per book.
  constraint reviews_one_per_user unique (product_id, user_id)
);

create index if not exists reviews_product_approved_idx
  on public.reviews (product_id, created_at desc) where status = 'approved';
create index if not exists reviews_moderation_queue_idx
  on public.reviews (created_at) where status = 'pending';
create index if not exists reviews_user_idx on public.reviews (user_id);

-- ---------------------------------------------------------------------------
-- testimonials — curated quotes for the home page (not tied to a product)
-- ---------------------------------------------------------------------------

create table if not exists public.testimonials (
  id            uuid primary key default gen_random_uuid(),
  author_name   text not null,
  author_title  text,
  avatar_url    text,
  quote         text not null,
  rating        smallint check (rating between 1 and 5),
  sort_order    integer not null default 0,
  is_published  boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists testimonials_published_idx
  on public.testimonials (sort_order, created_at) where is_published;

-- ---------------------------------------------------------------------------
-- site_settings — editable content blocks, keyed
--
-- Some keys are public (hero, social links, faq) and some are not
-- (admin_bootstrap_emails). 0003_policies.sql only exposes the public allowlist.
-- ---------------------------------------------------------------------------

create table if not exists public.site_settings (
  key         text primary key,
  value       jsonb not null default '{}'::jsonb,
  is_public   boolean not null default false,
  updated_by  uuid references public.profiles (id) on delete set null,
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- newsletter_subscribers
-- ---------------------------------------------------------------------------

create table if not exists public.newsletter_subscribers (
  id              uuid primary key default gen_random_uuid(),
  email           text not null,
  source          text,
  confirmed_at    timestamptz,
  unsubscribed_at timestamptz,
  ip_hash         text,
  created_at      timestamptz not null default now(),
  constraint newsletter_email_lowercase check (email = lower(email))
);

create unique index if not exists newsletter_subscribers_email_key
  on public.newsletter_subscribers (email);

-- ---------------------------------------------------------------------------
-- email_log — what we sent, to whom, and whether it landed
-- ---------------------------------------------------------------------------

create table if not exists public.email_log (
  id           uuid primary key default gen_random_uuid(),
  to_email     text not null,
  template     text not null,
  subject      text,
  provider_id  text,
  order_id     uuid references public.orders (id) on delete set null,
  status       text not null default 'sent' check (status in ('sent', 'failed', 'skipped')),
  error        text,
  created_at   timestamptz not null default now()
);

create index if not exists email_log_order_idx on public.email_log (order_id, created_at desc);
create index if not exists email_log_email_idx on public.email_log (to_email, created_at desc);
create index if not exists email_log_failed_idx on public.email_log (created_at desc)
  where status = 'failed';

-- ---------------------------------------------------------------------------
-- rate_limits — fixed-window counters, used instead of a separate Redis
-- ---------------------------------------------------------------------------

create table if not exists public.rate_limits (
  bucket       text not null,
  window_start timestamptz not null,
  count        integer not null default 0,
  primary key (bucket, window_start)
);

create index if not exists rate_limits_window_idx on public.rate_limits (window_start);

comment on table public.rate_limits is
  'Swept by public.prune_rate_limits(); schedule it with pg_cron or call it from a Vercel cron route.';

-- ---------------------------------------------------------------------------
-- Sequence backing human-readable order numbers
-- ---------------------------------------------------------------------------

create sequence if not exists public.order_number_seq as bigint start with 1000 increment by 1;
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
-- ============================================================================
-- BookishBae — 0003_policies.sql
-- Row Level Security, table grants and column grants.
--
-- Two layers are in play and both matter:
--
--   GRANTS decide which *columns* a role may touch at all. RLS cannot restrict
--   columns, so anything that must never reach a browser — `products.main_pdf_key`
--   above all — is withheld here rather than filtered in a policy.
--
--   POLICIES decide which *rows* a role may see or change.
--
-- Supabase ships permissive defaults (anon and authenticated get ALL on every
-- table in `public`), so the first thing this file does is take that away and
-- grant back only what each screen actually needs.
--
-- `service_role` has BYPASSRLS. Every write that needs to see across users —
-- order fulfilment, download claims, webhook processing — runs with that key
-- from a server route, never from the browser.
-- ============================================================================

set search_path = public;

-- ---------------------------------------------------------------------------
-- 1. Strip the permissive defaults
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

-- Stop future migrations from silently re-granting everything. This needs the
-- role that set the defaults in the first place, so tolerate failure rather
-- than blocking the migration.
do $$
begin
  execute 'alter default privileges in schema public revoke all on tables from anon, authenticated';
  execute 'alter default privileges in schema public revoke all on functions from anon, authenticated';
  execute 'alter default privileges in schema public revoke all on sequences from anon, authenticated';
exception when insufficient_privilege or others then
  raise notice 'Could not alter default privileges; run this block as the postgres role. New tables will need explicit REVOKEs.';
end $$;

grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant all on all functions in schema public to service_role;

-- ---------------------------------------------------------------------------
-- 2. Enable RLS everywhere
-- ---------------------------------------------------------------------------

alter table public.profiles               enable row level security;
alter table public.categories             enable row level security;
alter table public.products               enable row level security;
alter table public.coupons                enable row level security;
alter table public.orders                 enable row level security;
alter table public.order_items            enable row level security;
alter table public.payments               enable row level security;
alter table public.webhook_events         enable row level security;
alter table public.downloads              enable row level security;
alter table public.coupon_redemptions     enable row level security;
alter table public.reviews                enable row level security;
alter table public.testimonials           enable row level security;
alter table public.site_settings          enable row level security;
alter table public.newsletter_subscribers enable row level security;
alter table public.email_log              enable row level security;
alter table public.rate_limits            enable row level security;

-- ---------------------------------------------------------------------------
-- 3. profiles
--
-- A buyer may read and edit their own row, but `role` is not in the UPDATE
-- grant, so no amount of crafted PATCH traffic can self-promote to admin.
-- Role changes go through public.set_user_role().
-- ---------------------------------------------------------------------------

grant select (id, email, full_name, avatar_url, phone, role, marketing_opt_in, created_at, updated_at)
  on public.profiles to authenticated;
grant update (full_name, avatar_url, phone, marketing_opt_in)
  on public.profiles to authenticated;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- No INSERT or DELETE policy: rows are created by the auth trigger and removed
-- by the cascade from auth.users.

-- ---------------------------------------------------------------------------
-- 4. categories — public reference data
-- ---------------------------------------------------------------------------

grant select on public.categories to anon, authenticated;
grant insert, update, delete on public.categories to authenticated;

drop policy if exists categories_select_all on public.categories;
create policy categories_select_all on public.categories
  for select to anon, authenticated
  using (true);

drop policy if exists categories_admin_write on public.categories;
create policy categories_admin_write on public.categories
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 5. products
--
-- The column list below is the security boundary for file delivery. Compare it
-- against the table definition before adding a column: `main_pdf_key`,
-- `sample_pdf_key`, `main_pdf_bytes`, `main_pdf_sha256`, `watermark_enabled`
-- and `download_limit` are deliberately absent.
-- ---------------------------------------------------------------------------

grant select (
  id, slug, title, subtitle, description, excerpt, author_name, category_id,
  price_paise, discount_price_paise, currency,
  cover_key, cover_width, cover_height, cover_alt,
  page_count, language, isbn, status, is_featured,
  sales_count, rating_avg, rating_count,
  meta_title, meta_description, published_at, created_at, updated_at,
  search_vector
) on public.products to anon, authenticated;

-- Admins manage the catalogue. RLS keeps everyone else out of these verbs.
grant insert, update, delete on public.products to authenticated;

drop policy if exists products_select_published on public.products;
create policy products_select_published on public.products
  for select to anon, authenticated
  using (status = 'published' or public.is_admin());

drop policy if exists products_admin_write on public.products;
create policy products_admin_write on public.products
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- The safe projection. Owner-rights view, published rows only.
grant select on public.products_public to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. coupons — admin-only, with no public read path
--
-- Visitors never SELECT this table; they call public.validate_coupon() through
-- a rate-limited API route. Without that, every coupon code in the store would
-- be enumerable from the browser.
-- ---------------------------------------------------------------------------

grant select, insert, update, delete on public.coupons to authenticated;

drop policy if exists coupons_admin_only on public.coupons;
create policy coupons_admin_only on public.coupons
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 7. orders — read-only to their owner, written only by the server
-- ---------------------------------------------------------------------------

grant select (
  id, order_number, user_id, email, full_name, status, currency,
  subtotal_paise, discount_paise, total_paise, coupon_code,
  paid_at, refunded_at, created_at, updated_at
) on public.orders to authenticated;

-- Admin screens need the gateway ids and metadata too.
grant select (razorpay_order_id, metadata, failed_at, coupon_id, ip_hash, user_agent)
  on public.orders to authenticated;

drop policy if exists orders_select_own on public.orders;
create policy orders_select_own on public.orders
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists orders_admin_update on public.orders;
create policy orders_admin_update on public.orders
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant update on public.orders to authenticated;

-- No INSERT grant for any browser role. Orders are created server-side in
-- /api/checkout with the service role, so a client can never invent an order
-- or set its own total.

-- ---------------------------------------------------------------------------
-- 8. order_items — the buyer's library
-- ---------------------------------------------------------------------------

grant select on public.order_items to authenticated;
grant update (download_limit_override) on public.order_items to authenticated;

drop policy if exists order_items_select_own on public.order_items;
create policy order_items_select_own on public.order_items
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.orders o
      where o.id = order_items.order_id and o.user_id = auth.uid()
    )
  );

-- Admin download-limit override.
drop policy if exists order_items_admin_update on public.order_items;
create policy order_items_admin_update on public.order_items
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 9. payments
--
-- `gateway_snapshot` is withheld from browsers entirely: even redacted, a
-- gateway entity is not something to ship to a customer's device.
-- ---------------------------------------------------------------------------

grant select (
  id, order_id, razorpay_payment_id, status, method,
  amount_paise, currency, error_code, error_description,
  refund_id, refunded_amount_paise, created_at
) on public.payments to authenticated;

drop policy if exists payments_select_own on public.payments;
create policy payments_select_own on public.payments
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.orders o
      where o.id = payments.order_id and o.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 10. webhook_events — admin visibility, service-role writes
-- ---------------------------------------------------------------------------

grant select (id, provider, event_id, event_type, received_at, processed_at, attempts, error)
  on public.webhook_events to authenticated;

drop policy if exists webhook_events_admin_select on public.webhook_events;
create policy webhook_events_admin_select on public.webhook_events
  for select to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- 11. downloads — append-only audit log
-- ---------------------------------------------------------------------------

grant select (id, user_id, order_id, order_item_id, product_id, kind, succeeded, refusal_reason, created_at)
  on public.downloads to authenticated;

drop policy if exists downloads_select_own on public.downloads;
create policy downloads_select_own on public.downloads
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- No INSERT grant: only /api/download writes here, with the service role.
-- `object_key`, `ip_hash` and `user_agent` are not readable by any browser role.

-- ---------------------------------------------------------------------------
-- 12. coupon_redemptions
-- ---------------------------------------------------------------------------

grant select on public.coupon_redemptions to authenticated;

drop policy if exists coupon_redemptions_select_own on public.coupon_redemptions;
create policy coupon_redemptions_select_own on public.coupon_redemptions
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------------
-- 13. reviews
--
-- Approved reviews are public. Customers see their own pending ones so the UI
-- can say "awaiting moderation". Writes go through /api/reviews, which checks
-- for a verified purchase and rate-limits submissions.
-- ---------------------------------------------------------------------------

grant select (
  id, product_id, user_id, author_name, rating, title, body,
  status, is_verified_purchase, created_at
) on public.reviews to anon, authenticated;

grant insert, update, delete on public.reviews to authenticated;

drop policy if exists reviews_select_approved on public.reviews;
create policy reviews_select_approved on public.reviews
  for select to anon, authenticated
  using (status = 'approved');

drop policy if exists reviews_select_own on public.reviews;
create policy reviews_select_own on public.reviews
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists reviews_admin_write on public.reviews;
create policy reviews_admin_write on public.reviews
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- A customer may withdraw their own review.
drop policy if exists reviews_delete_own on public.reviews;
create policy reviews_delete_own on public.reviews
  for delete to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 14. testimonials
-- ---------------------------------------------------------------------------

grant select on public.testimonials to anon, authenticated;
grant insert, update, delete on public.testimonials to authenticated;

drop policy if exists testimonials_select_published on public.testimonials;
create policy testimonials_select_published on public.testimonials
  for select to anon, authenticated
  using (is_published or public.is_admin());

drop policy if exists testimonials_admin_write on public.testimonials;
create policy testimonials_admin_write on public.testimonials
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 15. site_settings
--
-- The `is_public` flag is the allowlist. `admin_bootstrap_emails` is stored
-- here with is_public = false and must stay that way.
-- ---------------------------------------------------------------------------

grant select (key, value, is_public, updated_at) on public.site_settings to anon, authenticated;
grant insert, update, delete on public.site_settings to authenticated;

drop policy if exists site_settings_select_public on public.site_settings;
create policy site_settings_select_public on public.site_settings
  for select to anon, authenticated
  using (is_public or public.is_admin());

drop policy if exists site_settings_admin_write on public.site_settings;
create policy site_settings_admin_write on public.site_settings
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 16. newsletter_subscribers — write-only from the public site
--
-- No SELECT for anyone but admins: an open subscriber list is an email-harvest
-- endpoint. Signups are inserted by /api/newsletter with the service role so
-- the route can rate-limit and normalise first.
-- ---------------------------------------------------------------------------

grant select (id, email, source, confirmed_at, unsubscribed_at, created_at)
  on public.newsletter_subscribers to authenticated;

drop policy if exists newsletter_admin_select on public.newsletter_subscribers;
create policy newsletter_admin_select on public.newsletter_subscribers
  for select to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- 17. email_log — admin only
-- ---------------------------------------------------------------------------

grant select (id, to_email, template, subject, order_id, status, error, created_at)
  on public.email_log to authenticated;

drop policy if exists email_log_admin_select on public.email_log;
create policy email_log_admin_select on public.email_log
  for select to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- 18. rate_limits — service role only
--
-- Deliberately no grants. If a client could read these counters it would know
-- exactly how much budget it had left; if it could write them, the limiter
-- would be decorative. RLS is enabled with zero policies, which denies
-- everything for anon and authenticated even if a grant is added by mistake.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 19. Function execution
--
-- Functions default to EXECUTE for PUBLIC, so each one must be revoked
-- explicitly. The rule: if a function can act across users, only service_role
-- may call it. The two exceptions check public.is_admin() internally.
-- ---------------------------------------------------------------------------

-- Used inside RLS policy expressions, which are evaluated as the caller.
grant execute on function public.is_admin() to anon, authenticated, service_role;

-- Self-guarding admin functions, safe to call from an authenticated session.
revoke all on function public.set_user_role(uuid, public.user_role) from public;
grant execute on function public.set_user_role(uuid, public.user_role) to authenticated, service_role;

revoke all on function public.admin_dashboard_stats(integer) from public;
grant execute on function public.admin_dashboard_stats(integer) to authenticated, service_role;

-- Server-only. A browser must never reach these.
revoke all on function public.claim_download(uuid, uuid) from public;
grant execute on function public.claim_download(uuid, uuid) to service_role;

revoke all on function public.release_download(uuid) from public;
grant execute on function public.release_download(uuid) to service_role;

revoke all on function public.mark_order_paid(uuid, timestamptz) from public;
grant execute on function public.mark_order_paid(uuid, timestamptz) to service_role;

revoke all on function public.refund_order(uuid, timestamptz) from public;
grant execute on function public.refund_order(uuid, timestamptz) to service_role;

-- Exposed to anon it would be a coupon-code oracle with no rate limit.
revoke all on function public.validate_coupon(text, integer, uuid, text, uuid) from public;
grant execute on function public.validate_coupon(text, integer, uuid, text, uuid) to service_role;

revoke all on function public.consume_rate_limit(text, integer, integer) from public;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;

revoke all on function public.prune_rate_limits(interval) from public;
grant execute on function public.prune_rate_limits(interval) to service_role;

revoke all on function public.hash_ip(text, text) from public;
grant execute on function public.hash_ip(text, text) to service_role;

-- Trigger bodies. Nothing should call these directly.
revoke all on function public.touch_updated_at() from public;
revoke all on function public.set_order_number() from public;
revoke all on function public.recalc_product_rating() from public;
revoke all on function public.handle_new_user() from public;
revoke all on function public.handle_user_email_change() from public;

-- The order-number trigger runs as whichever role inserted the order, and that
-- is always service_role.
grant usage, select on sequence public.order_number_seq to service_role;
-- ============================================================================
-- BookishBae — 0004_bootstrap.sql
-- Editable content blocks and starter categories.
--
-- Safe to re-run: every insert is ON CONFLICT DO NOTHING, so applying this
-- again will not overwrite copy that Annu has since edited in the admin panel.
--
-- IMPORTANT — before you run this, put your own email in the
-- `admin_bootstrap_emails` array below. The first account created with a
-- listed email becomes an admin automatically (see public.handle_new_user).
-- Emails must be lowercase.
-- ============================================================================

set search_path = public;

-- ---------------------------------------------------------------------------
-- Who gets to be an admin. is_public = false: this must never be readable from
-- the browser.
-- ---------------------------------------------------------------------------

insert into public.site_settings (key, value, is_public) values (
  'admin_bootstrap_emails',
  '["admin@appnix.info"]'::jsonb,
  false
) on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Public content blocks, edited from /admin/settings
-- ---------------------------------------------------------------------------

insert into public.site_settings (key, value, is_public) values (
  'brand',
  jsonb_build_object(
    'name', 'BookishBae',
    'tagline', 'Stories that stay with you.',
    'author_name', 'Annu',
    'support_email', 'hello@bookishbae.com'
  ),
  true
) on conflict (key) do nothing;

insert into public.site_settings (key, value, is_public) values (
  'hero',
  jsonb_build_object(
    'eyebrow', 'New from Annu',
    'heading', 'Stories that stay with you.',
    'subheading', 'Quiet, unhurried fiction about the people we almost become. Delivered to your inbox the moment you buy.',
    'primary_cta_label', 'Browse the shelf',
    'primary_cta_href', '/shop',
    'secondary_cta_label', 'Read a sample',
    'secondary_cta_href', '/shop',
    'featured_product_slug', null
  ),
  true
) on conflict (key) do nothing;

insert into public.site_settings (key, value, is_public) values (
  'author',
  jsonb_build_object(
    'name', 'Annu',
    'photo_url', null,
    'short_bio', 'Annu writes about longing, family and the small rooms where big decisions get made.',
    'long_bio', 'Annu has been writing since a school notebook she still refuses to show anyone. Her stories tend to begin with a single overheard sentence and end somewhere she did not plan. She lives in India, reads mostly in translation, and believes a short book you finish beats a long one you admire.',
    'socials', jsonb_build_array(
      jsonb_build_object('label', 'Instagram', 'href', 'https://instagram.com/'),
      jsonb_build_object('label', 'Goodreads', 'href', 'https://goodreads.com/')
    )
  ),
  true
) on conflict (key) do nothing;

insert into public.site_settings (key, value, is_public) values (
  'faq',
  jsonb_build_array(
    jsonb_build_object(
      'question', 'What format are the e-books in?',
      'answer', 'Every title is a DRM-free PDF, readable on a phone, tablet, laptop or e-reader.'
    ),
    jsonb_build_object(
      'question', 'How do I get my book after paying?',
      'answer', 'Instantly. You will land on a confirmation page with a download button, and an email with a link to your library arrives within a minute.'
    ),
    jsonb_build_object(
      'question', 'Can I re-download later?',
      'answer', 'Yes. Sign in with the email you bought with and your library is there. Each purchase allows five downloads; write to us if you need more and we will raise it.'
    ),
    jsonb_build_object(
      'question', 'Do you offer refunds?',
      'answer', 'Digital files cannot be returned, so sales are final once downloaded. If a file is corrupt or you were charged twice, email us and we will sort it out.'
    ),
    jsonb_build_object(
      'question', 'Which payment methods work?',
      'answer', 'UPI, all major Indian credit and debit cards, net banking and popular wallets, through Razorpay.'
    )
  ),
  true
) on conflict (key) do nothing;

insert into public.site_settings (key, value, is_public) values (
  'social_links',
  jsonb_build_array(
    jsonb_build_object('label', 'Instagram', 'href', 'https://instagram.com/'),
    jsonb_build_object('label', 'X', 'href', 'https://x.com/'),
    jsonb_build_object('label', 'Goodreads', 'href', 'https://goodreads.com/')
  ),
  true
) on conflict (key) do nothing;

insert into public.site_settings (key, value, is_public) values (
  'announcement',
  jsonb_build_object('enabled', false, 'text', '', 'href', null),
  true
) on conflict (key) do nothing;

insert into public.site_settings (key, value, is_public) values (
  'legal',
  jsonb_build_object(
    'business_name', 'BookishBae',
    'business_address', '',
    'contact_email', 'hello@bookishbae.com',
    'contact_phone', '',
    'gstin', null,
    'jurisdiction', 'India'
  ),
  true
) on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Starter categories
-- ---------------------------------------------------------------------------

insert into public.categories (slug, name, description, sort_order) values
  ('literary-fiction', 'Literary Fiction', 'Character-led stories that take their time.', 10),
  ('short-stories',    'Short Stories',    'Collections to finish in an afternoon.', 20),
  ('romance',          'Romance',          'Love, in its complicated shapes.', 30),
  ('poetry',           'Poetry',           'Small pieces that hit hard.', 40),
  ('non-fiction',      'Non-Fiction',      'Essays and reflections.', 50)
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- Placeholder testimonials, so the home page is not empty before the first
-- real review arrives. Replace or unpublish them from /admin/settings.
-- ---------------------------------------------------------------------------

insert into public.testimonials (author_name, author_title, quote, rating, sort_order, is_published) values
  ('Jitendra Kumar.',   'Reader, Lucknow',      'I started it on the metro and missed my stop. That has not happened to me in years.', 5, 10, true),
  ('Ritesh S.',  'Reader, Bengaluru', 'Annu writes the kind of sentences you put your thumb over and read twice.', 5, 20, true),
  ('Fatima A.',  'Book club host',    'We argued about the ending for a full hour. Best meeting we have had.', 5, 30, true)
on conflict do nothing;
-- Keep seeded FAQ content aligned with the active Cashfree integration.
-- This is additive and safe for projects that already applied 0004.
update public.site_settings as settings
set value = (
  select jsonb_agg(
    case
      when item.value ->> 'question' = 'Which payment methods work?'
        then jsonb_set(
          item.value,
          '{answer}',
          to_jsonb('UPI, all major Indian credit and debit cards, net banking and popular wallets, through Cashfree.'::text),
          true
        )
      else item.value
    end
    order by item.ordinality
  )
  from jsonb_array_elements(settings.value) with ordinality as item(value, ordinality)
)
where key = 'faq'
  and jsonb_typeof(value) = 'array';
-- Dashboard totals need database-backed aggregates; process memory is neither
-- shared between instances nor durable, so it is not a production source.
create or replace function public.admin_dashboard_metrics()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'catalogue_titles', (select count(*) from public.products),
    'workspace_drafts', (select count(*) from public.products where status = 'draft'),
    'revenue_paise', (select coalesce(sum(total_paise), 0) from public.orders where status = 'paid'),
    'order_count', (select count(*) from public.orders)
  );
$$;

revoke all on function public.admin_dashboard_metrics() from public, anon, authenticated;
grant execute on function public.admin_dashboard_metrics() to service_role;


-- Additive upgrade; apply manually after 0007. Never run at application startup.
begin;
create table public.admin_users (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admin_users enable row level security;
revoke all on public.admin_users from public, anon, authenticated;
grant all on public.admin_users to service_role;
-- Preserve administrators configured before this migration.
insert into public.admin_users(user_id) select id from public.profiles where role='admin' on conflict do nothing;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles p join public.admin_users a on a.user_id=p.id where p.id=auth.uid() and p.role='admin');
$$;

-- New users always start as customers. Promotion requires the operator seed or
-- the existing audited role function; client metadata/email allowlists cannot grant it.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_email text := lower(new.email);
begin
  insert into public.profiles(id,email,full_name,avatar_url,role)
  values(new.id,v_email,coalesce(new.raw_user_meta_data->>'full_name',new.raw_user_meta_data->>'name'),new.raw_user_meta_data->>'avatar_url','customer')
  on conflict(id) do update set email=excluded.email,
    full_name=coalesce(public.profiles.full_name,excluded.full_name),
    avatar_url=coalesce(excluded.avatar_url,public.profiles.avatar_url),updated_at=now();
  update public.orders set user_id=new.id,updated_at=now() where user_id is null and email=v_email;
  update public.coupon_redemptions set user_id=new.id where user_id is null and email=v_email;
  return new;
end;
$$;

-- Keep admin membership in step with authorized role changes.
create or replace function public.sync_admin_membership() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.role='admin' then
    insert into public.admin_users(user_id) values(new.id) on conflict do nothing;
  else
    delete from public.admin_users where user_id=new.id;
  end if;
  return new;
end;
$$;
revoke all on function public.sync_admin_membership() from public,anon,authenticated;
create trigger profiles_sync_admin after insert or update of role on public.profiles
for each row execute function public.sync_admin_membership();
commit;
