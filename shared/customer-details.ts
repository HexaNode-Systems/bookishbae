import { z } from 'zod';

/** Customer fields shared by checkout's form and its strict API schema. */
export const customerDetailsSchema = z.object({
  fullName: z.string().trim().min(1, 'Please tell us your name.').max(80)
    .transform((value) => value.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '').trim())
    .refine((value) => value.length > 0, 'Please tell us your name.'),
  email: z.string().trim().max(254).email('Please enter a valid email address.')
    .transform((value) => value.toLowerCase()),
  phone: z.string().trim().max(30)
    .transform((value) => value.replace(/[\s()-]/g, '').replace(/^(?:\+91|91)(?=\d{10}$)/, ''))
    .refine((value) => !value || /^\d{10}$/.test(value), 'Enter a 10-digit phone number, optionally prefixed with +91.')
    .transform((value) => value || undefined).optional(),
});

/** Cashfree requires a real customer phone; never substitute a dummy number. */
export const paymentCustomerSchema = customerDetailsSchema.extend({
  phone: customerDetailsSchema.shape.phone.refine(value => !!value, 'Enter your phone number to continue to Cashfree.'),
});
