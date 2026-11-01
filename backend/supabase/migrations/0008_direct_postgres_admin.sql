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
