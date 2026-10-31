/** Isolated API/database/storage transports for the browser regression. */
import { createServer } from 'node:http';
import { configureTestEnvironment } from './test-environment';
import { installStorageFixture, storedObjects } from './storage-fixture';
import { installPaymentFixture } from './payment-fixture';

async function main() {
  configureTestEnvironment();
  process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3100';
  installStorageFixture();
  await installPaymentFixture();
  const { getProducts } = await import('../src/lib/db/repository');
  const { publicUrl } = await import('../src/lib/cloudinary');
  const { server } = await import('../src/server');
  const { products } = await getProducts({ publicView: false });
  const rows = new Map(products.map((product) => [product.id!, product]));
  const transport = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname === 'supabase.test.invalid' && ['/rest/v1/categories', '/rest/v1/coupons', '/rest/v1/coupon_products'].includes(url.pathname)) return Response.json([]);
    if (url.hostname !== 'supabase.test.invalid' || url.pathname !== '/rest/v1/products') return transport(input, init);
    const method = init?.method || 'GET';
    const id = url.searchParams.get('id')?.replace(/^eq\./, '');
    let row = [...rows.values()].find((row) => (!id || row.id === id) && (!url.searchParams.has('slug') || url.searchParams.get('slug') === `eq.${row.slug}`));
    if (method === 'POST') {
      row = JSON.parse(String(init?.body));
      rows.set(row!.id!, row!);
    } else if (method === 'PATCH' && row) {
      row = { ...row, ...JSON.parse(String(init?.body)) };
      rows.set(row!.id!, row!);
    } else if (method === 'DELETE' && id) {
      rows.delete(id);
      return new Response(null, { status: 204 });
    }
    const single = new Headers(init?.headers).get('accept')?.includes('vnd.pgrst.object');
    return Response.json(single ? row || null : [...rows.values()].filter((p) => url.searchParams.get('status') !== 'eq.published' || p.status === 'published'), {
      status: method === 'POST' ? 201 : 200, headers: { 'content-range': `0-${rows.size - 1}/${rows.size}` },
    });
  };
  createServer((req, res) => {
    const url = new URL(req.url!, 'http://localhost:5100');
    if (url.pathname === '/fixtures/asset') {
      const key = [...storedObjects.keys()].find((key) => publicUrl(key) === url.searchParams.get('url'));
      const bytes = key && storedObjects.get(key);
      res.writeHead(bytes ? 200 : 404, { 'content-type': 'image/png' });
      res.end(bytes || 'Missing fixture asset');
      return;
    }
    if (req.headers['x-dev-admin'] === 'true') req.headers['x-test-role'] = 'admin';
    server.emit('request', req, res);
  }).listen(5100, '127.0.0.1', () => console.log('Isolated browser API ready on 5100. No real database or gateway calls.'));
}

void main();
