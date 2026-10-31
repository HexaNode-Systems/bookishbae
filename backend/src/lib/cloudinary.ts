/**
 * Cloudinary storage and asset delivery.
 *
 * Replaces Cloudflare R2:
 *   PUBLIC  ('upload')        — Cover images and author photos. Served via Cloudinary CDN.
 *   PRIVATE ('authenticated') — E-book PDFs (books, samples, watermarked).
 *                               Accessible only via signed, expiring download URLs.
 */

import { v2 as cloudinary } from 'cloudinary';

import { env } from './env';
import { logger } from './logger';

// ---------------------------------------------------------------------------
// Client configuration
// ---------------------------------------------------------------------------

let configured = false;

export function getCloudinary() {
  if (!configured) {
    cloudinary.config({
      cloud_name: env.CLOUDINARY_CLOUD_NAME,
      api_key: env.CLOUDINARY_API_KEY,
      api_secret: env.CLOUDINARY_API_SECRET,
      secure: true,
    });
    configured = true;
  }
  return cloudinary;
}

/** Delivery types matching the public / private storage separation. */
export const PRIVATE_BUCKET = 'authenticated';
export const PUBLIC_BUCKET = 'upload';

// ---------------------------------------------------------------------------
// Upload policy & constraints
// ---------------------------------------------------------------------------

export const MAX_PDF_BYTES = 100 * 1024 * 1024; // 100 MB, per the spec
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

export const ALLOWED_PDF_TYPES = ['application/pdf'] as const;
export const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
] as const;

const EXTENSION_BY_TYPE: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

export type UploadPurpose = 'cover' | 'main_pdf' | 'sample_pdf' | 'author_photo' | 'avatar';

export interface PurposeRule {
  bucket: string;
  prefix: string;
  types: readonly string[];
  maxBytes: number;
  cacheControl: string;
}

const RULES: Record<UploadPurpose, PurposeRule> = {
  cover: {
    bucket: PUBLIC_BUCKET,
    prefix: 'covers',
    types: ALLOWED_IMAGE_TYPES,
    maxBytes: MAX_IMAGE_BYTES,
    cacheControl: 'public, max-age=31536000, immutable',
  },
  author_photo: {
    bucket: PUBLIC_BUCKET,
    prefix: 'author',
    types: ALLOWED_IMAGE_TYPES,
    maxBytes: MAX_IMAGE_BYTES,
    cacheControl: 'public, max-age=31536000, immutable',
  },
  avatar: {
    bucket: PUBLIC_BUCKET,
    prefix: 'avatars',
    types: ALLOWED_IMAGE_TYPES,
    maxBytes: MAX_IMAGE_BYTES,
    cacheControl: 'public, max-age=604800',
  },
  main_pdf: {
    bucket: PRIVATE_BUCKET,
    prefix: 'books',
    types: ALLOWED_PDF_TYPES,
    maxBytes: MAX_PDF_BYTES,
    cacheControl: 'private, no-store',
  },
  sample_pdf: {
    bucket: PRIVATE_BUCKET,
    prefix: 'samples',
    types: ALLOWED_PDF_TYPES,
    maxBytes: MAX_PDF_BYTES,
    cacheControl: 'private, no-store',
  },
};

export function ruleFor(purpose: UploadPurpose): PurposeRule {
  return RULES[purpose];
}

export interface UploadValidationError {
  code: 'unsupported_type' | 'too_large' | 'empty';
  message: string;
}

export function validateUpload(
  purpose: UploadPurpose,
  contentType: string,
  contentLength: number,
): UploadValidationError | null {
  const rule = RULES[purpose];

  if (!rule.types.includes(contentType)) {
    return {
      code: 'unsupported_type',
      message: `${purpose} must be one of: ${rule.types.join(', ')}`,
    };
  }

  if (!Number.isFinite(contentLength) || contentLength <= 0) {
    return { code: 'empty', message: 'File appears to be empty.' };
  }

  if (contentLength > rule.maxBytes) {
    const mb = Math.round(rule.maxBytes / (1024 * 1024));
    return { code: 'too_large', message: `${purpose} must be ${mb} MB or smaller.` };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Keys & URLs
// ---------------------------------------------------------------------------

export function buildKey(purpose: UploadPurpose, productId: string, contentType: string): string {
  const rule = RULES[purpose];
  const ext = EXTENSION_BY_TYPE[contentType] ?? 'bin';
  return `${rule.prefix}/${productId}/${crypto.randomUUID()}.${ext}`;
}

/** Where a per-buyer watermarked copy is stored, keyed by order item. */
export function watermarkedKey(orderItemId: string, productId: string): string {
  return `watermarked/${productId}/${orderItemId}.pdf`;
}

/** Public URL for an image in Cloudinary or local seed assets. */
export function publicUrl(key: string | null | undefined): string | null {
  if (!key) return null;
  if (key.startsWith('http://') || key.startsWith('https://')) return key;
  if (key.startsWith('/')) return key;
  // Seed book covers live in frontend/public/covers/
  if (
    key === 'covers/the-long-afternoon-cover.png' ||
    key === 'covers/letters-i-never-sent-cover.png' ||
    key === 'covers/everything-we-didnt-say-cover.png'
  ) {
    return `/${key}`;
  }
  const cleanKey = key.replace(/^\/+/, '');
  // Image public IDs supplied with an extension retain it as part of the ID.
  // Cloudinary appends the delivery format as well (e.g. cover.jpg.jpg).
  const format = cleanKey.match(/\.(jpe?g|png|webp|avif)$/i)?.[1];
  return getCloudinary().url(cleanKey, { secure: true, resource_type: 'image', type: 'upload', force_version: false, analytics: false, ...(format ? { format } : {}) });
}

export function downloadFilename(title: string, suffix?: string): string {
  const base =
    title
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 80) || 'bookishbae';
  return `${base}${suffix ? `-${suffix}` : ''}.pdf`;
}

// ---------------------------------------------------------------------------
// Presigning
// ---------------------------------------------------------------------------

export interface PresignedUpload {
  url: string;
  key: string;
  bucket: string;
  expiresIn: number;
  requiredHeaders: Record<string, string>;
  fields?: Record<string, string>;
}

/**
 * Generates signed upload parameters for direct client/browser uploads to Cloudinary.
 */
export async function presignUpload(params: {
  purpose: UploadPurpose;
  productId: string;
  contentType: string;
  contentLength: number;
}): Promise<PresignedUpload> {
  const cld = getCloudinary();
  const rule = RULES[params.purpose];
  const key = buildKey(params.purpose, params.productId, params.contentType);
  const isPrivate = rule.bucket === PRIVATE_BUCKET;
  const resourceType = isPrivate ? 'raw' : 'image';
  const type = isPrivate ? 'authenticated' : 'upload';
  const timestamp = Math.floor(Date.now() / 1000);
  const expiresIn = env.UPLOAD_URL_TTL_SECONDS;

  const paramsToSign: Record<string, string | number> = {
    public_id: key,
    timestamp,
    type,
  };

  const signature = cld.utils.api_sign_request(paramsToSign, env.CLOUDINARY_API_SECRET);

  return {
    url: `https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/${resourceType}/upload`,
    key,
    bucket: rule.bucket,
    expiresIn,
    requiredHeaders: {},
    fields: {
      api_key: env.CLOUDINARY_API_KEY,
      timestamp: String(timestamp),
      public_id: key,
      type,
      signature,
    },
  };
}

/**
 * Mints an authenticated, expiring download URL for a private PDF.
 */
export async function presignDownload(params: {
  key: string;
  filename: string;
  bucket?: string;
  expiresIn?: number;
  inline?: boolean;
}): Promise<{ url: string; expiresIn: number; expiresAt: string }> {
  const cld = getCloudinary();
  const expiresIn = params.expiresIn ?? env.DOWNLOAD_URL_TTL_SECONDS;
  const expiresAtEpoch = Math.floor(Date.now() / 1000) + expiresIn;

  const url = cld.utils.private_download_url(params.key, '', {
    resource_type: 'raw',
    type: 'authenticated',
    expires_at: expiresAtEpoch,
    attachment: !params.inline,
  });

  return {
    url,
    expiresIn,
    expiresAt: new Date(expiresAtEpoch * 1000).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Direct operations (server-side only)
// ---------------------------------------------------------------------------

export async function objectExists(
  key: string,
  bucket: string = PRIVATE_BUCKET,
): Promise<{ exists: boolean; size?: number; contentType?: string }> {
  const cld = getCloudinary();
  try {
    const isPdf = key.endsWith('.pdf');
    const resourceType = isPdf ? 'raw' : 'image';
    const type =
      bucket === PRIVATE_BUCKET || bucket === 'authenticated' ? 'authenticated' : 'upload';

    const result = (await cld.api.resource(key, {
      resource_type: resourceType,
      type,
    })) as { bytes: number; format?: string };

    return {
      exists: true,
      size: result.bytes,
      contentType: isPdf ? 'application/pdf' : `image/${result.format || 'png'}`,
    };
  } catch (error: unknown) {
    const err = error as { http_code?: number; error?: { http_code?: number } };
    if (err?.http_code === 404 || err?.error?.http_code === 404) {
      return { exists: false };
    }
    throw error;
  }
}

/**
 * Reads an object's bytes into memory.
 */
export async function getObjectBytes(
  key: string,
  bucket: string = PRIVATE_BUCKET,
): Promise<Uint8Array> {
  const cld = getCloudinary();
  const isPdf = key.endsWith('.pdf');
  const type =
    bucket === PRIVATE_BUCKET || bucket === 'authenticated' ? 'authenticated' : 'upload';

  let downloadUrl: string;
  if (type === 'authenticated') {
    const expiresAt = Math.floor(Date.now() / 1000) + 300;
    downloadUrl = cld.utils.private_download_url(key, '', {
      resource_type: isPdf ? 'raw' : 'image',
      type: 'authenticated',
      expires_at: expiresAt,
    });
  } else {
    downloadUrl = publicUrl(key) ?? '';
  }

  const response = await fetch(downloadUrl, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) {
    throw new Error(`Cloudinary object ${key} fetch failed with HTTP ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}

export async function putObject(params: {
  key: string;
  body: Uint8Array | Buffer | string;
  contentType: string;
  bucket?: string;
  cacheControl?: string;
}): Promise<{ key: string; url?: string }> {
  const cld = getCloudinary();
  const isPdf = params.contentType === 'application/pdf' || params.key.endsWith('.pdf');
  const isPrivate = params.bucket === PRIVATE_BUCKET || params.bucket === 'authenticated' || isPdf;
  const resourceType = isPdf ? 'raw' : 'image';
  const type = isPrivate ? 'authenticated' : 'upload';

  const buffer = Buffer.isBuffer(params.body)
    ? params.body
    : typeof params.body === 'string'
      ? Buffer.from(params.body)
      : Buffer.from(params.body);

  return new Promise((resolve, reject) => {
    const uploadStream = cld.uploader.upload_stream(
      {
        public_id: params.key,
        resource_type: resourceType,
        type,
        overwrite: true,
        invalidate: true,
        use_filename: false,
        unique_filename: false,
      },
      (error, result) => {
        if (error) {
          reject(error);
        } else if (result?.public_id && result.secure_url) {
          resolve({ key: result.public_id, ...(isPrivate ? {} : { url: result.secure_url }) });
        } else {
          reject(new Error('Storage did not confirm the uploaded asset.'));
        }
      },
    );
    uploadStream.end(buffer);
  });
}

/**
 * Deletes an object quietly from Cloudinary.
 */
export async function deleteObjectQuietly(
  key: string,
  bucket: string = PRIVATE_BUCKET,
): Promise<void> {
  const cld = getCloudinary();
  const isPdf = key.endsWith('.pdf');
  const resourceType = isPdf ? 'raw' : 'image';
  const type =
    bucket === PRIVATE_BUCKET || bucket === 'authenticated' ? 'authenticated' : 'upload';

  try {
    await cld.uploader.destroy(key, {
      resource_type: resourceType,
      type,
      invalidate: true,
    });
  } catch (error) {
    logger.warn('Cloudinary delete failed', { key, bucket, error });
  }
}
