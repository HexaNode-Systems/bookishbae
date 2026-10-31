import type { Book } from './books';

export interface ApiProduct {
  id: string;
  slug: string;
  title: string;
  price_paise: number;
  discount_price_paise?: number | null;
  cover_url?: string | null;
  cover_key?: string | null;
  subtitle?: string | null;
  excerpt?: string | null;
  description?: string | null;
  category?: string | null;
  category_id?: string | null;
  sample_preview?: Book['sampleText'];
  category_slug?: Book['categorySlug'] | null;
  page_count?: number | null;
  is_featured?: boolean;
  rating_avg?: number | null;
  rating_count?: number | null;
  published_at?: string | null;
}

/** Only the API resolves storage keys; a Cloudinary key is not a local path. */
export function productCover(product: Pick<ApiProduct, 'cover_url' | 'cover_key'>): string {
  const source = product.cover_url || product.cover_key || '';
  if ((source.startsWith('/') && !source.startsWith('//')) || /^https?:\/\//.test(source)) return source;
  return '';
}

export function mapProductToBook(product: ApiProduct, editorial?: Book): Book {
  const price = product.discount_price_paise ?? product.price_paise;
  if (!product.id || !product.slug || !product.title || !Number.isInteger(price) || price < 0) {
    throw new Error('The book details returned by the store are incomplete. Please try again.');
  }
  return {
    id: product.id,
    slug: product.slug,
    title: product.title,
    subtitle: product.subtitle ?? '',
    excerpt: product.excerpt ?? '',
    description: product.description ?? '',
    category: product.category || 'Uncategorized',
    categoryId: product.category_id ?? null,
    categorySlug: product.category_slug ?? '',
    pricePaise: price,
    priceRupees: price / 100,
    originalPriceRupees: product.discount_price_paise != null ? product.price_paise / 100 : undefined,
    coverImage: productCover(product),
    // Samples are downloaded through the API using this product's ID.
    samplePdfUrl: '',
    pageCount: product.page_count ?? 0,
    isFeatured: product.is_featured ?? false,
    rating: product.rating_avg ?? 0,
    reviewCount: product.rating_count ?? 0,
    publishedDate: product.published_at ?? '',
    sampleText: product.sample_preview ?? [],
    reviews: editorial?.reviews ?? [],
  };
}
