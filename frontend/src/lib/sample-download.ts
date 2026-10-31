import type { Book } from './books';

/** Validate bytes before creating a download, including proxy HTML errors. */
export async function fetchSamplePdf(book: Pick<Book, 'id' | 'slug'>): Promise<{ blob: Blob; filename: string }> {
  let productId = book.id;
  if (!productId) {
    const response = await fetch(`/api/products/${encodeURIComponent(book.slug)}`);
    if (!response.ok) throw new Error('Could not load this book’s sample. Please try again.');
    productId = (await response.json()).product?.id;
  }
  if (!productId) throw new Error('This book has no sample available.');
  const response = await fetch('/api/download', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId, kind: 'sample' }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error?.message || 'The sample could not be downloaded. Please try again.');
  }
  if (response.headers.get('content-type')?.split(';')[0] !== 'application/pdf') {
    throw new Error('The store did not return a PDF sample. Please try again shortly.');
  }
  const blob = await response.blob();
  if (await blob.slice(0, 5).text() !== '%PDF-') {
    throw new Error('The sample file is not a valid PDF. Please contact the author.');
  }
  const filename = response.headers.get('content-disposition')?.match(/filename="([^"]+\.pdf)"/i)?.[1] || `${book.slug}-sample.pdf`;
  return { blob, filename };
}
