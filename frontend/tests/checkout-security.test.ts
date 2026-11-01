import assert from 'node:assert/strict';
import test from 'node:test';
import { contentSecurityPolicy } from '../src/lib/content-security-policy';

test('Cashfree hosted form submissions are allowed in sandbox and production with other destinations restricted', () => {
  for (const development of [false, true]) {
    const policy = contentSecurityPolicy('checkout-test-nonce', development);
    const directives = new Map(policy.split(';').map(value => {
      const [name, ...sources] = value.trim().split(/\s+/);
      return [name, sources];
    }));
    assert.deepEqual(directives.get('form-action'), ["'self'", 'https://sandbox.cashfree.com', 'https://api.cashfree.com']);
    assert.ok(directives.get('script-src')?.includes("'nonce-checkout-test-nonce'"));
    assert.deepEqual(directives.get('frame-ancestors'), ["'none'"]);
    assert.deepEqual(directives.get('base-uri'), ["'self'"]);
    assert.deepEqual(directives.get('object-src'), ["'none'"]);
    assert.equal(directives.has('upgrade-insecure-requests'), !development);
  }
});
