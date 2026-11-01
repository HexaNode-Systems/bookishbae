import { installStorageFixture } from './storage-fixture';
import { configureTestEnvironment } from './test-environment';
import { installPaymentFixture } from './payment-fixture';
import { describe } from 'node:test';

async function main() {
  /** Never load developer credentials or allow HTTP requests from tests. */
  globalThis.fetch = async () => new Response(
    JSON.stringify({ message: 'External services are disabled in tests.', code: 'TEST_NETWORK_DISABLED' }),
    { status: 400, headers: { 'content-type': 'application/json' } },
  );

  configureTestEnvironment();

  const { installDatabaseFixture } = await import('./database-fixture');
  await installDatabaseFixture();

  installStorageFixture();
  await installPaymentFixture();
  const { installAuthFixture } = await import('./auth-fixture');
  installAuthFixture();

  await import('./backend.test');
  await import('./author-commerce.test');
  await import('./download-entitlement.test');
  await import('./postgres.test');
  await import('./admin-profile.test');
}

void describe('Backend PostgreSQL and API integration', main);
