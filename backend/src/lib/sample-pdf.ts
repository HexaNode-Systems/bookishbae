import { ApiError, notFound } from './api/errors';
import { getObjectBytes, MAX_PDF_BYTES } from './cloudinary';
import { env } from './env';
import { LOCAL_SAMPLE_KEYS } from './product-assets';

export async function readSamplePdf(product: { sample_pdf_key: string | null; main_pdf_key: string | null; status: string }) {
  const key = product.sample_pdf_key;
  if (product.status !== 'published' || !key || key === product.main_pdf_key) {
    throw notFound('A free sample is not available for this book.');
  }
  let bytes: Uint8Array;
  if (key.startsWith('/') || LOCAL_SAMPLE_KEYS.has(key) || key.startsWith('https://')) {
    const url = new URL(key.startsWith('samples/') ? `/${key}` : key, env.NEXT_PUBLIC_SITE_URL);
    const site = new URL(env.NEXT_PUBLIC_SITE_URL);
    const isLocalSample = url.origin === site.origin && /^\/samples\/[^/]+\.pdf$/i.test(url.pathname);
    const isCloudinarySample = url.protocol === 'https:' && url.hostname === 'res.cloudinary.com'
      && url.pathname.startsWith(`/${env.CLOUDINARY_CLOUD_NAME}/raw/upload/`)
      && /\/samples\//.test(url.pathname);
    if (!isLocalSample && !isCloudinarySample) throw notFound('This book has no valid sample PDF configured.');
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(20_000) });
    if (response.status === 404) throw notFound('The sample PDF is missing. Please contact the author.');
    if (!response.ok) throw new ApiError('upstream_error', 'The sample PDF could not be loaded. Please try again shortly.');
    bytes = new Uint8Array(await response.arrayBuffer());
  } else {
    if (!key.startsWith('samples/') || key.includes('..')) throw notFound('This book has no valid sample PDF configured.');
    bytes = await getObjectBytes(key);
  }
  if (bytes.length > MAX_PDF_BYTES || Buffer.from(bytes.subarray(0, 5)).toString() !== '%PDF-') {
    throw new ApiError('upstream_error', 'Sample storage did not return a PDF. Please contact the author.');
  }
  return bytes;
}
