import { publicUrl } from './cloudinary';

/** These exact files ship with the storefront; uploaded keys use Cloudinary. */
export const LOCAL_SAMPLE_KEYS = new Set([
  'samples/the-long-afternoon-sample.pdf',
  'samples/letters-i-never-sent-sample.pdf',
  'samples/everything-we-didnt-say-sample.pdf',
]);

export function withProductAssets<T extends { cover_key?: string | null; sample_pdf_key?: string | null }>(product: T) {
  const sample = product.sample_pdf_key;
  return {
    ...product,
    cover_url: publicUrl(product.cover_key) ?? undefined,
    sample_pdf_url: sample?.startsWith('/') || sample?.startsWith('https://')
      ? sample
      : sample && LOCAL_SAMPLE_KEYS.has(sample) ? `/${sample}` : undefined,
  };
}
