// Read-only verification against the real configured backend, with no transports replaced.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchChrome } from './chrome-driver.mjs';

const origin = process.env.BOOKISHBAE_BROWSER_ORIGIN || 'http://localhost:3100';
const browser = await launchChrome('bookishbae-author-ui-');
const errors = [];
const network = [];
browser.on('Runtime.exceptionThrown', event => errors.push(event.exceptionDetails.exception?.description || event.exceptionDetails.text));
browser.on('Network.responseReceived', event => { if (event.response.url.includes('/api/')) network.push({ url: event.response.url, status: event.response.status }); });
try {
  await browser.call('Page.navigate', { url: `${origin}/admin` });
  await browser.until("Object.keys(document.querySelector('nav button') || {}).some(k => k.startsWith('__reactProps$'))", 'admin hydration');
  await browser.clickText('Categories');
  await browser.until("document.querySelector('#category-name')", 'category form');
  await browser.until("!document.body.innerText.includes('Loading categories…')", 'database categories');
  assert.equal(await browser.evaluate("document.querySelector('[role=alert]')?.textContent || ''"), '');
  const categoriesScreenshot = await browser.screenshot('categories.png');
  await browser.clickText('Coupons');
  await browser.until("document.querySelector('#coupon-code')", 'coupon form');
  await browser.until("!document.body.innerText.includes('Loading coupons…')", 'coupon API response');
  const couponError = await browser.evaluate("document.querySelector('[role=alert]')?.textContent || ''");
  const couponsScreenshot = await browser.screenshot('coupons.png');
  const products = await (await fetch(`${origin}/api/products`)).json();
  const selected = products.products.find(book => book.status === 'published') || products.products[0];
  assert.ok(selected, 'A published book is needed for checkout verification');
  const configuration = await (await fetch(`${origin}/api/checkout`)).json();
  assert.equal(configuration.paymentMode, 'sandbox', 'Production verification is explicitly forbidden');
  assert.equal(configuration.configured, true);
  await browser.call('Page.navigate', { url: `${origin}/checkout?book=${encodeURIComponent(selected.slug)}` });
  await browser.until("document.querySelector('.checkout-book-details h3')", 'checkout product');
  await browser.until("typeof window.Cashfree === 'function' || !!document.querySelector('[role=alert]')", 'real Cashfree SDK load');
  const checkoutError = await browser.evaluate("[...document.querySelectorAll('[role=alert]')].map(e=>e.textContent).join(' ')");
  assert.equal(checkoutError, '');
  assert.equal(await browser.evaluate('typeof window.Cashfree'), 'function');
  const checkoutScreenshot = await browser.screenshot('checkout-sdk-ready.png');
  assert.deepEqual(errors, []);
  await writeFile(path.join(browser.artifacts, 'network.json'), JSON.stringify(network, null, 2));
  console.log(JSON.stringify({ categories: 'passed', couponForm: 'rendered', couponBackend: couponError || 'ready', realCashfreeSdk: 'loaded', mode: 'sandbox', browserExceptions: errors.length, screenshots: [categoriesScreenshot, couponsScreenshot, checkoutScreenshot], artifacts: browser.artifacts }, null, 2));
} finally { browser.close(); }
