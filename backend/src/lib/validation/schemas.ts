/**
 * Request schemas, one per API route.
 *
 * Kept together so the whole input surface of the application can be read in
 * one sitting — which is the only practical way to be sure nothing is
 * unvalidated.
 */

import { z } from 'zod';
import { paymentCustomerSchema } from '../../../../shared/customer-details';

import { MAX_ORDER_PAISE } from '@/lib/money';
import { ALLOWED_IMAGE_TYPES, ALLOWED_PDF_TYPES, MAX_IMAGE_BYTES, MAX_PDF_BYTES } from '@/lib/cloudinary';

import {
  couponCodeSchema,
  emailSchema,
  nameSchema,
  paginationSchema,
  paiseSchema,
  ratingSchema,
  slugSchema,
  textSchema,
  uuidSchema,
} from './common';

// ---------------------------------------------------------------------------
// Checkout and payment
// ---------------------------------------------------------------------------

/**
 * Note what is absent: any notion of price.
 *
 * The client says which book it wants and nothing about what it costs. The
 * server reads the price from the database. A request that tried to pass an
 * amount would have it ignored, because this schema is strict and would reject
 * the unknown key outright.
 */
export const checkoutRequestSchema = z
  .object({
    productId: uuidSchema,
    ...paymentCustomerSchema.shape,
    couponCode: couponCodeSchema.optional(),
    marketingOptIn: z.boolean().default(false),
    metadata: z
      .object({
        utm_source: z.string().max(60).optional(),
        utm_medium: z.string().max(60).optional(),
        utm_campaign: z.string().max(60).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type CheckoutRequest = z.infer<typeof checkoutRequestSchema>;

/**
 * The callback Razorpay Checkout fires in the browser.
 *
 * Verified against an HMAC, but still only used to decide what the success
 * page shows. Entitlement comes from the webhook.
 */
export const paymentCallbackSchema = z
  .object({
    razorpay_order_id: z.string().min(5).max(64),
    razorpay_payment_id: z.string().min(5).max(64),
    razorpay_signature: z.string().min(16).max(256),
  })
  .strict();

export const couponValidateSchema = z
  .object({
    code: couponCodeSchema,
    productId: uuidSchema,
    email: emailSchema.optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Downloads
// ---------------------------------------------------------------------------

export const downloadRequestSchema = z
  .object({
    productId: uuidSchema,
    /**
     * 'sample' needs no purchase; 'full' does. Keeping them on one endpoint
     * means one entitlement check to audit rather than two.
     */
    kind: z.enum(['full', 'sample']).default('full'),
    orderId: z.string().max(100).optional(),
    token: z.string().max(1000).optional(),
  })
  .strict();

export type DownloadRequest = z.infer<typeof downloadRequestSchema>;

// ---------------------------------------------------------------------------
// Reviews, newsletter, contact
// ---------------------------------------------------------------------------

export const reviewSubmitSchema = z
  .object({
    productId: uuidSchema,
    rating: ratingSchema,
    title: textSchema(120).optional(),
    body: textSchema(2000, 10),
    authorName: nameSchema.optional(),
  })
  .strict();

export const newsletterSubscribeSchema = z
  .object({
    email: emailSchema,
    source: z.string().max(40).optional(),
  })
  .strict();

export const contactSchema = z
  .object({
    name: nameSchema,
    email: emailSchema,
    subject: textSchema(140, 3),
    message: textSchema(4000, 20),
  })
  .strict();

// ---------------------------------------------------------------------------
// Shop browsing
// ---------------------------------------------------------------------------

export const shopQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(80).optional(),
  category: slugSchema.optional(),
  sort: z
    .enum(['newest', 'bestselling', 'price-asc', 'price-desc', 'rating'])
    .default('newest'),
});

export type ShopQuery = z.infer<typeof shopQuerySchema>;

// ---------------------------------------------------------------------------
// Admin: products
// ---------------------------------------------------------------------------

const productCore = {
  samplePreview: z.array(z.object({ heading: textSchema(200, 1), paragraphs: z.array(textSchema(10000, 1)).min(1).max(80) }).strict()).max(30).default([]),
  title: textSchema(160, 1),
  slug: slugSchema,
  subtitle: textSchema(160).optional().nullable(),
  excerpt: textSchema(300).optional().nullable(),
  description: textSchema(8000),
  authorName: textSchema(80, 1).default('Annu'),
  categoryId: uuidSchema.optional().nullable(),
  categorySlug: slugSchema.optional().nullable(),
  pricePaise: paiseSchema,
  discountPricePaise: paiseSchema.optional().nullable(),
  coverKey: z.string().max(300).optional().nullable(),
  coverWidth: z.number().int().min(1).max(10000).optional().nullable(),
  coverHeight: z.number().int().min(1).max(10000).optional().nullable(),
  coverAlt: textSchema(200).optional().nullable(),
  samplePdfKey: z.string().max(300).optional().nullable(),
  mainPdfKey: z.string().max(300).optional().nullable(),
  mainPdfBytes: z.number().int().min(0).max(MAX_PDF_BYTES).optional().nullable(),
  pageCount: z.number().int().min(1).max(5000).optional().nullable(),
  language: z.string().trim().min(2).max(10).default('en'),
  isbn: z.string().trim().max(20).optional().nullable(),
  status: z.enum(['draft', 'published', 'archived']).default('draft'),
  isFeatured: z.boolean().default(false),
  watermarkEnabled: z.boolean().default(false),
  downloadLimit: z.number().int().min(1).max(100).default(5),
  metaTitle: textSchema(70).optional().nullable(),
  metaDescription: textSchema(170).optional().nullable(),
};

export const productCreateSchema = z
  .object(productCore)
  .strict()
  .refine((value) => !value.samplePdfKey || value.samplePdfKey !== value.mainPdfKey, {
    message: 'The free sample must be a separate PDF from the full e-book.', path: ['samplePdfKey'],
  })
  .refine(
    (value) =>
      value.discountPricePaise == null || value.discountPricePaise < value.pricePaise,
    { message: 'The discounted price must be below the list price.', path: ['discountPricePaise'] },
  )
  .refine(
    (value) => value.status !== 'published' || (!!value.mainPdfKey && !!value.coverKey),
    {
      message: 'Upload a cover and the main PDF before publishing.',
      path: ['status'],
    },
  );

export const productUpdateSchema = z
  .object(productCore)
  .partial()
  .strict()
  .refine(
    (value) =>
      value.discountPricePaise == null ||
      value.pricePaise == null ||
      value.discountPricePaise < value.pricePaise,
    { message: 'The discounted price must be below the list price.', path: ['discountPricePaise'] },
  );

// ---------------------------------------------------------------------------
// Admin: uploads
// ---------------------------------------------------------------------------

export const uploadPresignSchema = z
  .object({
    purpose: z.enum(['cover', 'main_pdf', 'sample_pdf', 'author_photo']),
    productId: uuidSchema,
    contentType: z.string().min(3).max(100),
    contentLength: z.number().int().min(1).max(MAX_PDF_BYTES),
    filename: z.string().max(260).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const isImage = value.purpose === 'cover' || value.purpose === 'author_photo';
    const allowed: readonly string[] = isImage ? ALLOWED_IMAGE_TYPES : ALLOWED_PDF_TYPES;
    const maxBytes = isImage ? MAX_IMAGE_BYTES : MAX_PDF_BYTES;

    if (!allowed.includes(value.contentType)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['contentType'],
        message: `Allowed types: ${allowed.join(', ')}`,
      });
    }

    if (value.contentLength > maxBytes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['contentLength'],
        message: `Maximum size is ${Math.round(maxBytes / (1024 * 1024))} MB.`,
      });
    }
  });

// ---------------------------------------------------------------------------
// Admin: coupons
// ---------------------------------------------------------------------------

export const couponUpsertSchema = z
  .object({
    code: couponCodeSchema,
    description: textSchema(200).optional().nullable(),
    discountType: z.enum(['percent', 'flat']),
    /** Percent: 1–100. Flat: paise. */
    discountValue: z.number().int().min(1).max(MAX_ORDER_PAISE),
    maxDiscountPaise: paiseSchema.optional().nullable(),
    minOrderPaise: paiseSchema.default(0),
    usageLimit: z.number().int().min(1).max(1_000_000).optional().nullable(),
    usageLimitPerUser: z.number().int().min(1).max(100).optional().nullable(),
    startsAt: z.string().datetime().optional(),
    expiresAt: z.string().datetime().optional().nullable(),
    productId: uuidSchema.optional().nullable(),
    productIds: z.array(uuidSchema).max(200).default([]),
    isActive: z.boolean().default(true),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.discountType === 'percent' && value.discountValue > 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['discountValue'],
        message: 'A percentage discount cannot exceed 100.',
      });
    }
    if (value.expiresAt && value.startsAt && value.expiresAt <= value.startsAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expiresAt'],
        message: 'The expiry must be after the start date.',
      });
    }
  });

export const categorySchema = z.object({
  name: textSchema(100, 1), slug: slugSchema,
  description: textSchema(500).optional().nullable(),
  sortOrder: z.number().int().min(0).max(10000).default(0),
}).strict();

// ---------------------------------------------------------------------------
// Admin: orders, reviews, customers
// ---------------------------------------------------------------------------

export const orderListQuerySchema = paginationSchema.extend({
  status: z.enum(['pending', 'paid', 'failed', 'cancelled', 'refunded']).optional(),
  q: z.string().trim().max(120).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export const orderRefundSchema = z
  .object({
    orderId: uuidSchema,
    reason: textSchema(300).optional(),
    /** Omit to refund the full amount. */
    amountPaise: paiseSchema.optional(),
  })
  .strict();

export const resendDownloadEmailSchema = z.object({ orderId: uuidSchema }).strict();

export const downloadOverrideSchema = z
  .object({
    orderItemId: uuidSchema,
    downloadLimitOverride: z.number().int().min(0).max(1000).nullable(),
  })
  .strict();

export const reviewModerateSchema = z
  .object({
    reviewId: uuidSchema,
    status: z.enum(['approved', 'rejected', 'pending']),
  })
  .strict();

export const roleChangeSchema = z
  .object({
    userId: uuidSchema,
    role: z.enum(['customer', 'admin']),
  })
  .strict();

// ---------------------------------------------------------------------------
// Admin: site settings
// ---------------------------------------------------------------------------

export const settingsUpdateSchema = z
  .object({
    key: z
      .string()
      .trim()
      .min(1)
      .max(60)
      .regex(/^[a-z0-9_]+$/, 'Setting keys are lowercase with underscores.')
      // The bootstrap list decides who can become an admin. Editing it through
      // the generic settings endpoint would be a privilege-escalation path, so
      // it is only changeable in SQL.
      .refine((value) => value !== 'admin_bootstrap_emails', 'That setting is not editable here.'),
    value: z.unknown(),
  })
  .strict();

export const testimonialUpsertSchema = z
  .object({
    authorName: nameSchema,
    authorTitle: textSchema(80).optional().nullable(),
    avatarUrl: z.string().url().max(500).optional().nullable(),
    quote: textSchema(500, 10),
    rating: ratingSchema.optional().nullable(),
    sortOrder: z.number().int().min(0).max(9999).default(0),
    isPublished: z.boolean().default(true),
  })
  .strict();

export const categoryUpsertSchema = z
  .object({
    slug: slugSchema,
    name: textSchema(60, 1),
    description: textSchema(300).optional().nullable(),
    sortOrder: z.number().int().min(0).max(9999).default(0),
  })
  .strict();
