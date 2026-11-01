import { installStorageFixture } from './storage-fixture';
import { configureTestEnvironment } from './test-environment';
import { installPaymentFixture } from './payment-fixture';

async function main() {
  /** Never load developer credentials or allow HTTP requests from tests. */
  globalThis.fetch = async () => new Response(
    JSON.stringify({ message: 'External services are disabled in tests.', code: 'TEST_NETWORK_DISABLED' }),
    { status: 400, headers: { 'content-type': 'application/json' } },
  );

  configureTestEnvironment();

  installStorageFixture();
  await installPaymentFixture();

  await import('./backend.test');
  await import('./author-commerce.test');
  await import('./download-entitlement.test');
}

void main();
