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
-- Categories are created by the author through the admin panel.

-- ---------------------------------------------------------------------------
-- Placeholder testimonials, so the home page is not empty before the first
-- real review arrives. Replace or unpublish them from /admin/settings.
-- ---------------------------------------------------------------------------

insert into public.testimonials (author_name, author_title, quote, rating, sort_order, is_published) values
  ('Jitendra Kumar.',   'Reader, Lucknow',      'I started it on the metro and missed my stop. That has not happened to me in years.', 5, 10, true),
  ('Ritesh S.',  'Reader, Bengaluru', 'Annu writes the kind of sentences you put your thumb over and read twice.', 5, 20, true),
  ('Fatima A.',  'Book club host',    'We argued about the ending for a full hour. Best meeting we have had.', 5, 30, true)
on conflict do nothing;
