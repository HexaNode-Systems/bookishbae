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
