/**
 * Shared Zod primitives.
 *
 * Validation here is about rejecting shapes the database would reject anyway,
 * early and with a readable message. The constraints mirror the CHECKs in
 * `0001_schema.sql` — when you change one, change the other.
 */

import { z } from 'zod';

import { MAX_ORDER_PAISE } from '@/lib/money';
import { cleanText } from '@/lib/utils';

/** Lowercased, trimmed email. Matches the `*_email_lowercase` CHECKs. */
export const emailSchema = z
  .string()
  .trim()
  .min(3)
  .max(254)
  .email('That does not look like an email address.')
  .transform((value) => value.toLowerCase());

export const uuidSchema = z.string().uuid('Expected an id.');

/** Matches the `*_slug_shape` CHECKs: lowercase, hyphen-separated. */
export const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and single hyphens.');

/** Free text, stripped of control and bidi characters. */
export const textSchema = (max: number, min = 0) =>
  z
    .string()
    .max(max * 2, 'That is much longer than expected.')
    .transform(cleanText)
    .pipe(z.string().min(min).max(max));

export const nameSchema = z
  .string()
  .trim()
  .min(1, 'Please tell us your name.')
  .max(80)
  .transform(cleanText)
  .refine((value) => value.length > 0, 'Please tell us your name.');

export const paiseSchema = z
  .number()
  .int('Amounts must be a whole number of paise.')
  .min(0)
  .max(MAX_ORDER_PAISE);

export const couponCodeSchema = z
  .string()
  .trim()
  .min(2)
  .max(32)
  .transform((value) => value.toLowerCase())
  .pipe(z.string().regex(/^[a-z0-9][a-z0-9_-]{1,31}$/, 'That coupon code is not valid.'));

export const ratingSchema = z.coerce.number().int().min(1).max(5);

/** Page/limit pair, as they arrive from a query string. */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(500).default(1),
  limit: z.coerce.number().int().min(1).max(60).default(12),
});

/**
 * A caller-supplied redirect target.
 *
 * Only site-relative paths are accepted. Without this, `?next=https://evil.tld`
 * turns our own sign-in page into an open redirect that phishes our buyers.
 */
export const internalPathSchema = z
  .string()
  .max(512)
  .refine(
    (value) => value.startsWith('/') && !value.startsWith('//') && !value.includes('\\'),
    'Redirect must be a path on this site.',
  );

export function safeInternalPath(value: string | null | undefined, fallback = '/'): string {
  if (!value) return fallback;
  const result = internalPathSchema.safeParse(value);
  return result.success ? result.data : fallback;
}
