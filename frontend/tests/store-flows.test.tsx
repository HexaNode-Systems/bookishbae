import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BookCover } from '../src/components/book-cover';
import { mapProductToBook } from '../src/lib/product-book';
import { fetchSamplePdf } from '../src/lib/sample-download';
import { paymentCustomerSchema } from '../../shared/customer-details';

const product = {
  id: 'fc3b1d64-124a-4e84-8ef0-659b80888f7b', slug: 'new-independent-edition', title: 'New independent edition',
  price_paise: 24975, discount_price_paise: 19950,
  cover_key: 'covers/new-book/unique.jpg', cover_url: 'https://res.cloudinary.com/test-cloud/image/upload/covers/new-book/unique.jpg.jpg',
};

test('New book mapping and cover rendering preserve the server cover, identity and exact price after reload', () => {
  const book = mapProductToBook(JSON.parse(JSON.stringify(product)));
  assert.equal(book.id, product.id);
  assert.equal(book.title, product.title);
  assert.equal(book.pricePaise, 19950);
  assert.equal(book.priceRupees, 199.5);
  assert.equal(book.originalPriceRupees, 249.75);
  assert.equal(book.coverImage, product.cover_url);
  const html = renderToStaticMarkup(<BookCover src={book.coverImage} alt={`${book.title} cover`} />);
  assert.ok(html.includes(`src="${product.cover_url}"`));
  assert.ok(!html.includes('the-long-afternoon'));
  assert.ok(!html.includes('cover-placeholder.svg'));
});

test('Covers: seed paths stay local; missing covers use a neutral placeholder and never another book', () => {
  assert.equal(mapProductToBook({ ...product, cover_url: '/covers/seed.png' }).coverImage, '/covers/seed.png');
  const missing = mapProductToBook({ ...product, cover_url: null, cover_key: null });
  const html = renderToStaticMarkup(<BookCover src={missing.coverImage} alt="Missing cover" />);
  assert.ok(html.includes('cover-placeholder.svg'));
  assert.equal(mapProductToBook({ ...product, cover_url: null }).coverImage, '', 'A raw storage key must not become a local URL');
  assert.throws(() => mapProductToBook({ ...product, price_paise: NaN, discount_price_paise: null }));
});

test('Sample download uses the selected product ID and verifies PDF headers, filename and bytes', async (t) => {
  const bytes = '%PDF-1.7\nActual sample bytes\n%%EOF';
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(url, '/api/download');
    assert.deepEqual(JSON.parse(init.body as string), { productId: product.id, kind: 'sample' });
    return new Response(bytes, { headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="Selected-book-sample.pdf"' } });
  });
  const downloaded = await fetchSamplePdf(product);
  assert.equal(downloaded.filename, 'Selected-book-sample.pdf');
  assert.equal(await downloaded.blob.text(), bytes);
});

test('Sample failures never produce downloadable HTML or corrupt PDFs', async (t) => {
  for (const response of [
    new Response('<html>Fallback</html>', { headers: { 'content-type': 'text/html' } }),
    new Response('<html>Storage error</html>', { headers: { 'content-type': 'application/pdf' } }),
    Response.json({ error: { message: 'Sample is missing.' } }, { status: 404 }),
    new Response('Bad gateway', { status: 502 }),
  ]) {
    const mocked = t.mock.method(globalThis, 'fetch', async () => response);
    await assert.rejects(fetchSamplePdf(product), /PDF|missing|downloaded/);
    mocked.mock.restore();
  }
});

test('Checkout customer validation normalizes real phone and rejects incomplete customer details', () => {
  const parsed = paymentCustomerSchema.parse({ fullName: '  New Reader  ', email: 'NEW@example.com', phone: '+91 98765-43210' });
  assert.deepEqual(parsed, { fullName: 'New Reader', email: 'new@example.com', phone: '9876543210' });
  for (const changes of [{ fullName: '' }, { fullName: 'a'.repeat(81) }, { email: 'bad' }, { phone: 'incorrect' }, { phone: '' }, { phone: undefined }]) {
    assert.equal(paymentCustomerSchema.safeParse({ fullName: 'Reader', email: 'reader@example.com', phone: '9876543210', ...changes }).success, false);
  }
});

test('Author preview text and arbitrary database category relationships replace seeded editorial content', () => {
  const preview = [{ heading: 'Author story', paragraphs: ['A paragraph written by the author.', 'Another author paragraph.'] }];
  const categoryId = crypto.randomUUID();
  const book = mapProductToBook({ ...product, category_id: categoryId, category_slug: 'author-created-genre', category: 'Author-created genre', sample_preview: preview });
  assert.equal(book.categoryId, categoryId);
  assert.equal(book.categorySlug, 'author-created-genre');
  assert.deepEqual(book.sampleText, preview);
  assert.deepEqual(mapProductToBook({ ...product }).sampleText, []);
  assert.equal(mapProductToBook({ ...product }).categoryId, null);
  assert.equal(mapProductToBook({ ...product }).categorySlug, '');
  assert.equal(mapProductToBook({ ...product }).category, 'Uncategorized');
});
