import type { Book } from '@/lib/books';

export type AdminSection =
  | 'dashboard'
  | 'catalogue'
  | 'orders'
  | 'coupons'
  | 'categories'
  | 'profile';
export interface AdminIdentity {
  id: string | null;
  email: string | null;
  fullName: string;
  phone: string;
  avatarUrl: string;
  preview: boolean;
  authenticated: boolean;
}

export type CatalogueBook = Pick<
  Book,
  | 'slug'
  | 'title'
  | 'subtitle'
  | 'description'
  | 'excerpt'
  | 'category'
  | 'categorySlug'
  | 'categoryId'
  | 'sampleText'
  | 'priceRupees'
  | 'originalPriceRupees'
  | 'coverImage'
  | 'pageCount'
  | 'samplePdfUrl'
  | 'publishedDate'
  | 'isFeatured'
> & {
  id?: string;
  status?: 'draft' | 'published' | 'archived';
  coverKey?: string | null;
  mainPdfKey?: string | null;
  samplePdfKey?: string | null;
  mainPdfBytes?: number | null;
  workspaceDraft?: boolean;
};

export type Notice = { kind: 'success' | 'error'; text: string } | null;

export function allowedImageSource(value: string) {
  if (!value) return false;
  if (value.startsWith('blob:') || value.startsWith('data:')) return true;
  if (value.startsWith('/') && !value.startsWith('//') && !value.includes('\\'))
    return true;
  try {
    const url = new URL(value);
    const storageHost = process.env.NEXT_PUBLIC_SUPABASE_URL
      ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
      : '';
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      ['res.cloudinary.com', 'lh3.googleusercontent.com', 'localhost', '127.0.0.1', storageHost].includes(
        url.hostname,
      )
    );
  } catch {
    return false;
  }
}

export const currency = (value: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(value);

/** Safe helper to parse backend API responses and never throw JSON parse syntax errors */
export async function safeReadApiResponse(res: Response): Promise<{ ok: boolean; data: any; error: string }> {
  let text = '';
  try {
    text = await res.text();
  } catch {
    text = '';
  }

  let data: any = null;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    // Plain text error from server/proxy (e.g. 500 Internal Server Error)
    const statusText = res.statusText || 'Server Error';
    const cleanText = text && text.length < 150 ? text.trim() : '';
    const message = cleanText || `Server returned ${res.status} (${statusText}). Please check backend connection.`;
    return { ok: false, data: null, error: message };
  }

  if (!res.ok) {
    const message =
      data?.error?.message ||
      data?.error?.issues?.[0]?.message ||
      data?.message ||
      data?.detail ||
      `Request failed with HTTP ${res.status}`;
    return { ok: false, data, error: message };
  }

  return { ok: true, data, error: '' };
}

