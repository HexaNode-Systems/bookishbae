// Real browser + real backend + real Cashfree SDK. Never replaces network responses.
// Opens hosted sandbox checkout; does not submit a card or complete a payment.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchChrome } from './chrome-driver.mjs';

const origin = process.env.BOOKISHBAE_BROWSER_ORIGIN || 'http://localhost:3000';
const configuration = await (await fetch(`${origin}/api/checkout`)).json();
assert.equal(configuration.paymentMode, 'sandbox', 'Refusing to open production checkout during verification');
assert.equal(configuration.configured, true, 'Sandbox credentials are not configured');
const catalogue = await (await fetch(`${origin}/api/products`)).json();
const selected = process.env.SANDBOX_BOOK_SLUG ? catalogue.products.find(book => book.slug === process.env.SANDBOX_BOOK_SLUG) : catalogue.products[0];
assert.ok(selected, 'A published book is required');
const browser = await launchChrome('bookishbae-real-sandbox-');
const evidence = { mode: 'sandbox', bookId: selected.id, realSdk: true, paymentCompleted: false };
try {
  await browser.call('Page.navigate', { url: `${origin}/checkout?book=${encodeURIComponent(selected.slug)}` });
  await browser.until("document.querySelector('.checkout-book-details h3') && typeof window.Cashfree === 'function'", 'checkout and real Cashfree SDK');
  await browser.fill('#fullName', 'Cashfree Sandbox Verification');
  await browser.fill('#email', 'sandbox-verification@example.com');
  await browser.fill('#phone', '9876543210');
  await browser.evaluate("document.querySelector('.checkout-pay-button').click()");
  await browser.until("location.hostname.endsWith('.cashfree.com') || document.querySelector('.checkout-notice.error')", 'Cashfree hosted checkout or a real backend error');
  const location = await browser.evaluate('location.href');
  if (new URL(location).hostname.endsWith('.cashfree.com')) {
    evidence.status = 'hosted_checkout_opened';
    evidence.host = new URL(location).hostname;
  } else {
    evidence.status = 'blocked';
    evidence.error = await browser.evaluate("document.querySelector('.checkout-notice.error')?.textContent.trim()");
    process.exitCode = 1;
  }
  evidence.screenshot = await browser.screenshot('sandbox-opening.png');
  await writeFile(path.join(browser.artifacts, 'result.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} finally { browser.close(); }
