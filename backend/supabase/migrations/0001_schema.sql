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
