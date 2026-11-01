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
  const { installDatabaseFixture } = await import('./database-fixture');
  await installDatabaseFixture(false);
  const { installAuthFixture } = await import('./auth-fixture');
  installAuthFixture();
  const { publicUrl } = await import('../src/lib/cloudinary');
  const { server } = await import('../src/server');
  createServer((req, res) => {
    const url = new URL(req.url!, 'http://localhost:5100');
    if (url.pathname === '/fixtures/asset') {
      const key = [...storedObjects.keys()].find((key) => publicUrl(key) === url.searchParams.get('url'));
      const bytes = key && storedObjects.get(key);
      res.writeHead(bytes ? 200 : 404, { 'content-type': 'image/png' });
      res.end(bytes || 'Missing fixture asset');
      return;
    }
    if (req.headers['x-dev-admin'] === 'true') req.headers.authorization = 'Bearer fixture-admin-token';
    server.emit('request', req, res);
  }).listen(5100, '127.0.0.1', () => console.log('Isolated browser API ready on 5100. No real database or gateway calls.'));
}

void main();
