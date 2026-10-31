// Opens an existing BB-VERIFY sandbox session using the real hosted SDK.
// Never submits a payment and never replaces application network responses.
import { Cashfree, CFEnvironment } from 'cashfree-pg';
import { launchChrome } from '../../frontend/tests/chrome-driver.mjs';

if (process.env.CASHFREE_ENVIRONMENT !== 'TEST') throw Error('Production checkout verification is forbidden.');
const reference = process.argv[2];
if (!reference?.startsWith('BB-VERIFY-')) throw Error('Supply an unpaid BB-VERIFY sandbox probe order reference.');
const origin = process.env.BOOKISHBAE_BROWSER_ORIGIN || 'http://localhost:3100';
const mode = await (await fetch(`${origin}/api/checkout`)).json();
if (mode.paymentMode !== 'sandbox') throw Error('The application backend must also be in sandbox mode.');
const client = new Cashfree(CFEnvironment.SANDBOX, process.env.CASHFREE_APP_ID, process.env.CASHFREE_SECRET_KEY);
let session;
try { session = (await client.PGFetchOrder(reference)).data; }
catch (error) { console.error(JSON.stringify({ message: error.message, status: error.response?.status, code: error.response?.data?.code })); process.exit(1); }
if (session.order_status !== 'ACTIVE' || !session.payment_session_id) throw Error('The probe order has no active sandbox session.');
const catalogue = await (await fetch(`${origin}/api/products`)).json();
const browser = await launchChrome('bookishbae-hosted-sandbox-');
const browserErrors = [];
const requests = [];
await browser.call('Log.enable');
browser.on('Log.entryAdded', event => { if (event.entry.level === 'error') browserErrors.push(event.entry.text.slice(0, 600)); });
browser.on('Network.responseReceived', event => { const url = new URL(event.response.url); if (url.hostname.endsWith('.cashfree.com')) requests.push({ host: url.hostname, path: url.pathname, status: event.response.status }); });
try {
  await browser.call('Page.navigate', { url: `${origin}/checkout?book=${encodeURIComponent(catalogue.products[0].slug)}` });
  await browser.until("typeof window.Cashfree === 'function'", 'real Cashfree SDK');
  const invoked = await browser.call('Runtime.evaluate', { expression: `Promise.resolve(window.Cashfree({mode:'sandbox'}).checkout({paymentSessionId:${JSON.stringify(session.payment_session_id)},redirectTarget:'_self'})).then(result => { if(result?.error) window.__cashfreeError = result.error.message || JSON.stringify(result.error); }).catch(error => { window.__cashfreeError = error.message || String(error); })`, userGesture: true, awaitPromise: false });
  if (invoked.exceptionDetails) throw Error(invoked.exceptionDetails.exception?.description || invoked.exceptionDetails.text);
  try { await browser.until("location.hostname.endsWith('.cashfree.com') || window.__cashfreeError", 'real hosted sandbox navigation', 25000); }
  catch (error) { console.log(JSON.stringify({ browserErrors, requests, screenshot: await browser.screenshot('hosted-error.png') }, null, 2)); throw error; }
  const host = await browser.evaluate('location.hostname');
  const error = await browser.evaluate("window.__cashfreeError || ''");
  const screenshot = await browser.screenshot('hosted-sandbox.png');
  const text = await browser.evaluate('document.body.innerText.slice(0, 1200)');
  console.log(JSON.stringify({ mode: 'sandbox', orderReference: reference, host, error, browserErrors, requests, screenshot, pageText: text, paymentSubmitted: false }, null, 2));
  if (error || !host.endsWith('.cashfree.com')) process.exitCode = 1;
} finally { browser.close(); }
