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
