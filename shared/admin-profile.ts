import { z } from 'zod';

export const PROFILE_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'] as const;
export const MAX_PROFILE_PHOTO_BYTES = 5 * 1024 * 1024;

export const adminProfileSchema = z.object({
  fullName: z.string().trim().min(1, 'Enter your full name.').max(80, 'Use 80 characters or fewer.'),
  phone: z.string().trim().max(30).refine(value => !value ||
    (/^\+?[\d\s().-]{7,30}$/.test(value) && value.replace(/\D/g, '').length >= 7),
  'Enter a valid phone number, or leave it blank.').optional(),
  avatarUrl: z.string().trim().max(500).refine(value => {
    if (!value) return true;
    if (value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')) return true;
    try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; }
    catch { return false; }
  }, 'Choose a valid profile photo.').optional(),
}).strict();
