-- Author-managed categories/previews/coupons and atomic checkout pricing.
-- Apply after 0006. Existing book/category/coupon data is preserved.
begin;
alter table public.products add column if not exists sample_preview jsonb not null default '[]'::jsonb;
alter table public.products add constraint products_sample_preview_array check (jsonb_typeof(sample_preview) = 'array' and jsonb_array_length(sample_preview) <= 30);
grant select (sample_preview) on public.products to anon, authenticated;
alter table public.products drop constraint if exists products_category_id_fkey;
alter table public.products add constraint products_category_id_fkey foreign key (category_id) references public.categories(id) on delete restrict;

create table public.coupon_products (
 coupon_id uuid not null references public.coupons(id) on delete cascade,
 product_id uuid not null references public.products(id) on delete cascade,
 primary key (coupon_id, product_id)
);
alter table public.coupon_products enable row level security;
grant all on public.coupon_products to service_role;
grant select, insert, update, delete on public.coupon_products to authenticated;
create policy coupon_products_admin on public.coupon_products for all to authenticated using(public.is_admin()) with check(public.is_admin());

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

  if v_coupon.usage_limit is not null and v_coupon.times_used + (
    select count(*) from public.orders where coupon_id = v_coupon.id and status = 'pending'
      and created_at > now() - interval '30 minutes'
  ) >= v_coupon.usage_limit then
    return jsonb_build_object('valid', false, 'reason', 'exhausted');
  end if;

  if v_coupon.product_id is not null
     and (p_product_id is null or v_coupon.product_id <> p_product_id) then
    return jsonb_build_object('valid', false, 'reason', 'not_applicable');
  end if;

  if exists (select 1 from public.coupon_products where coupon_id = v_coupon.id)
     and not exists (select 1 from public.coupon_products where coupon_id = v_coupon.id and product_id = p_product_id) then
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

    select v_used_by + count(*) into v_used_by from public.orders
      where coupon_id = v_coupon.id and status = 'pending' and created_at > now() - interval '30 minutes'
        and ((p_user_id is not null and user_id = p_user_id) or (p_email is not null and email = lower(p_email)));
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
    'discount_value', v_coupon.discount_value,
    'discount_paise', v_discount,
    'total_paise', p_subtotal_paise - v_discount
  );
end;
$$;

create or replace function public.mark_order_paid(p_order_id uuid, p_paid_at timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order  public.orders;
  v_items  jsonb;
  v_coupon public.coupons;
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

  if v_order.coupon_id is not null then
    select * into v_coupon from public.coupons where id = v_order.coupon_id for update;
    if v_coupon.usage_limit is not null and v_coupon.times_used >= v_coupon.usage_limit then
      return jsonb_build_object('ok', false, 'reason', 'coupon_limit_reached');
    end if;
    if v_coupon.usage_limit_per_user is not null and (
      select count(*) from public.coupon_redemptions where coupon_id=v_coupon.id
        and (email=v_order.email or (v_order.user_id is not null and user_id=v_order.user_id))
    ) >= v_coupon.usage_limit_per_user then
      return jsonb_build_object('ok', false, 'reason', 'coupon_customer_limit_reached');
    end if;
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


create or replace function public.save_coupon(p_id uuid, p_coupon jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid := coalesce(p_id, gen_random_uuid()); v_coupon public.coupons; v_products uuid[];
begin
 if p_id is not null then
   perform 1 from public.coupons where id = p_id for update;
   if not found then raise exception 'Coupon not found' using errcode = 'P0002'; end if;
 end if;
 select coalesce(array_agg(distinct value::uuid), '{}'::uuid[]) into v_products from jsonb_array_elements_text(coalesce(p_coupon->'productIds','[]'::jsonb));
 if coalesce(p_coupon->>'productId','') <> '' then v_products := array_append(v_products,(p_coupon->>'productId')::uuid); end if;
 if exists(select 1 from unnest(v_products) id where not exists(select 1 from public.products p where p.id = id)) then
   raise exception 'An applicable book no longer exists' using errcode = '22023';
 end if;
 insert into public.coupons(id,code,description,discount_type,discount_value,max_discount_paise,min_order_paise,usage_limit,usage_limit_per_user,starts_at,expires_at,product_id,is_active)
 values(v_id,lower(trim(p_coupon->>'code')),p_coupon->>'description',(p_coupon->>'discountType')::public.discount_type,
   (p_coupon->>'discountValue')::integer,(p_coupon->>'maxDiscountPaise')::integer,coalesce((p_coupon->>'minOrderPaise')::integer,0),
   (p_coupon->>'usageLimit')::integer,(p_coupon->>'usageLimitPerUser')::integer,coalesce((p_coupon->>'startsAt')::timestamptz,now()),
   (p_coupon->>'expiresAt')::timestamptz,null,coalesce((p_coupon->>'isActive')::boolean,true))
 on conflict(id) do update set code=excluded.code,description=excluded.description,discount_type=excluded.discount_type,
   discount_value=excluded.discount_value,max_discount_paise=excluded.max_discount_paise,min_order_paise=excluded.min_order_paise,
   usage_limit=excluded.usage_limit,usage_limit_per_user=excluded.usage_limit_per_user,starts_at=excluded.starts_at,
   expires_at=excluded.expires_at,product_id=null,is_active=excluded.is_active,updated_at=now()
 returning * into v_coupon;
 delete from public.coupon_products where coupon_id = v_id;
 insert into public.coupon_products(coupon_id,product_id) select v_id,id from (select distinct unnest(v_products) id) t;
 return to_jsonb(v_coupon) || jsonb_build_object('product_ids',to_jsonb(v_products));
end; $$;

create or replace function public.delete_coupon(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
 perform 1 from public.coupons where id = p_id for update;
 if not found then raise exception 'Coupon not found' using errcode = 'P0002'; end if;
 if exists(select 1 from public.orders where coupon_id = p_id) or exists(select 1 from public.coupon_redemptions where coupon_id = p_id) then
   raise exception 'This coupon has order history. Disable it instead.' using errcode = '23503';
 end if;
 delete from public.coupons where id = p_id;
 return jsonb_build_object('ok',true);
end; $$;

create or replace function public.create_checkout_order(
 p_product_id uuid,p_email text,p_full_name text,p_coupon_code text default null,p_user_id uuid default null,
 p_metadata jsonb default '{}'::jsonb,p_ip_hash text default null,p_user_agent text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_product public.products; v_coupon_id uuid; v_validation jsonb; v_subtotal integer; v_discount integer := 0; v_order public.orders; v_item public.order_items;
begin
 select * into v_product from public.products where id = p_product_id and status = 'published' for share;
 if v_product.id is null then raise exception 'This book is unavailable.' using errcode = '22023'; end if;
 v_subtotal := coalesce(v_product.discount_price_paise,v_product.price_paise);
 if nullif(trim(p_coupon_code),'') is not null then
   select id into v_coupon_id from public.coupons where code = lower(trim(p_coupon_code)) for update;
   v_validation := public.validate_coupon(p_coupon_code,v_subtotal,p_product_id,p_email,p_user_id);
   if not coalesce((v_validation->>'valid')::boolean,false) then
     raise exception 'Coupon cannot be applied: %',v_validation->>'reason' using errcode = '22023';
   end if;
   v_discount := (v_validation->>'discount_paise')::integer;
 end if;
 if v_subtotal-v_discount < 100 then raise exception 'Cashfree orders must total at least one rupee. Adjust the coupon.' using errcode = '22023'; end if;
 insert into public.orders(order_number,user_id,email,full_name,status,currency,subtotal_paise,discount_paise,total_paise,coupon_id,coupon_code,metadata,ip_hash,user_agent)
 values('',p_user_id,lower(trim(p_email)),trim(p_full_name),'pending','INR',v_subtotal,v_discount,v_subtotal-v_discount,
   v_coupon_id,case when v_coupon_id is null then null else lower(trim(p_coupon_code)) end,coalesce(p_metadata,'{}'::jsonb),p_ip_hash,p_user_agent)
 returning * into v_order;
 insert into public.order_items(order_id,product_id,title_snapshot,slug_snapshot,unit_price_paise,quantity,total_paise,download_limit)
 values(v_order.id,v_product.id,v_product.title,v_product.slug,v_subtotal,1,v_subtotal-v_discount,v_product.download_limit)
 returning * into v_item;
 return jsonb_build_object('order',to_jsonb(v_order),'orderItem',to_jsonb(v_item));
end; $$;

revoke all on function public.save_coupon(uuid,jsonb), public.delete_coupon(uuid), public.create_checkout_order(uuid,text,text,text,uuid,jsonb,text,text) from public, anon, authenticated;
grant execute on function public.save_coupon(uuid,jsonb), public.delete_coupon(uuid), public.create_checkout_order(uuid,text,text,text,uuid,jsonb,text,text) to service_role;
-- validate_coupon and mark_order_paid retain their existing service-role-only grants.
notify pgrst, 'reload schema';
commit;
