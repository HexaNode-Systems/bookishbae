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
