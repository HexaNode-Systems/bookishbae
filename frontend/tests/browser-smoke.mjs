// Run against Next dev on :3000 and backend/tests/browser-server.ts on :5100.
// Chrome DevTools drives the real UI; only external transports are isolated.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, copyFile, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const artifacts = await mkdtemp(path.join(tmpdir(), 'bookishbae-browser-'));
const chromePath = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${path.join(artifacts, 'profile')}`, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
process.once('SIGINT', () => { browser.kill(); process.exit(130); });
let socket;
try {
  const endpoint = await new Promise((resolve, reject) => {
    let stderr = '';
    const timer = setTimeout(() => reject(Error('Chrome did not start')), 20_000);
    browser.once('error', reject);
    browser.stderr.on('data', (data) => {
      stderr += data;
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  socket = new WebSocket(endpoint);
  await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }));
  let counter = 0;
  const pending = new Map();
  const events = new Map();
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const promise = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) promise?.reject(Error(JSON.stringify(message.error))); else promise?.resolve(message.result);
    } else for (const listener of events.get(message.method) || []) listener(message.params);
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++counter;
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`DevTools command timed out: ${method}`)); }, 45_000);
    pending.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const call = (method, params) => send(method, params, sessionId);
  await call('Page.enable');
  await call('Runtime.enable');
  await call('Network.enable');
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: artifacts });
  // Payment is never sent to a live gateway during this browser regression.
  await call('Page.addScriptToEvaluateOnNewDocument', { source: 'window.Cashfree = () => ({ checkout: async (options) => { window.__paymentOptions = options; } });' });
  const requests = [];
  const networkRequests = new Map();
  const responses = new Map();
  events.set('Network.requestWillBeSent', [(event) => networkRequests.set(event.requestId, event.request)]);
  events.set('Network.responseReceived', [(event) => {
    const request = networkRequests.get(event.requestId);
    const url = new URL(event.response.url);
    if (!url.pathname.startsWith('/api/')) return;
    const record = { path: url.pathname, method: request?.method, status: event.response.status,
      contentType: event.response.mimeType, requestBody: request?.postData };
    requests.push(record);
    responses.set(event.requestId, record);
  }]);
  events.set('Network.loadingFinished', [async (event) => {
    const record = responses.get(event.requestId);
    if (record?.contentType?.includes('json')) {
      try { const { body, base64Encoded } = await call('Network.getResponseBody', { requestId: event.requestId });
        record.responseBody = base64Encoded ? Buffer.from(body, 'base64').toString() : body;
      } catch (error) { failures.push(error.message); }
    }
  }]);
  const failures = [];
  events.set('Runtime.exceptionThrown', [(event) => failures.push(event.exceptionDetails.exception?.description || event.exceptionDetails.text)]);
  events.set('Fetch.requestPaused', [async ({ requestId, request }) => {
    try {
      const url = new URL(request.url);
      const asset = url.hostname === 'res.cloudinary.com';
      const target = asset ? `http://127.0.0.1:5100/fixtures/asset?url=${encodeURIComponent(request.url)}` : `http://127.0.0.1:5100${url.pathname}${url.search}`;
      const headers = new Headers(request.headers);
      headers.delete('host'); headers.delete('content-length');
      const response = await fetch(target, { method: request.method, headers, ...(request.postData ? { body: request.postData } : {}) });
      const body = Buffer.from(await response.arrayBuffer());
      requests.push({ path: url.pathname, method: request.method, status: response.status, contentType: response.headers.get('content-type'), requestBody: request.postData, responseBody: response.headers.get('content-type')?.includes('json') ? body.toString() : undefined });
      await call('Fetch.fulfillRequest', { requestId, responseCode: response.status,
        responseHeaders: [...response.headers].filter(([name]) => !['transfer-encoding', 'content-encoding', 'content-length'].includes(name)).map(([name, value]) => ({ name, value })), body: body.toString('base64') });
    } catch (error) { failures.push(error.message); await call('Fetch.failRequest', { requestId, errorReason: 'Failed' }); }
  }]);
  // Only app API and test-cloud image transports are substituted.
  await call('Fetch.enable', { patterns: [{ urlPattern: 'https://res.cloudinary.com/test-cloud/*' }] });
  const evaluate = async (expression) => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const until = async (expression, label, milliseconds = 90_000) => {
    const deadline = Date.now() + milliseconds;
    while (Date.now() < deadline) {
      if (await evaluate(`Boolean(${expression})`)) return;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    throw Error(`Timed out: ${label}\n${await evaluate('document.body.innerText.slice(0, 1800)')}`);
  };
  const clickText = (text) => evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)})?.click()`);
  const fill = (selector, value) => evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) throw Error('Missing field'); Object.getOwnPropertyDescriptor(e.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : e.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value').set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event(e.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); })()`);
  const upload = async (selector, file) => {
    const before = requests.filter((r) => r.path === '/api/admin/uploads').length;
    const { root: document } = await call('DOM.getDocument');
    const { nodeId } = await call('DOM.querySelector', { nodeId: document.nodeId, selector });
    await call('DOM.setFileInputFiles', { nodeId, files: [file] });
    const deadline = Date.now() + 20_000;
    while (requests.filter((r) => r.path === '/api/admin/uploads').length === before && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(requests.filter((r) => r.path === '/api/admin/uploads').at(-1)?.status, 200);
  };
  await call('Page.navigate', { url: 'http://localhost:3100/admin' });
  console.log('Browser: opened admin.');
  await until("document.querySelector('[aria-label=\"Admin navigation\"]')", 'admin loaded');
  await until("Object.keys(document.querySelector('nav button') || {}).some(k => k.startsWith('__reactProps$'))", 'admin hydrated');
  assert.equal(await evaluate("document.body.innerText.includes('Integrations & Settings')"), false);
  await clickText('Add book');
  await until("document.querySelector('#book-title')", 'book editor loaded');
  console.log('Browser: book editor loaded.');
  const title = `Browser regression ${Date.now()}`;
  const slug = title.toLowerCase().replaceAll(' ', '-');
  await fill('#book-title', title);
  await fill('#book-description', 'A newly created book for cover, sample, and checkout regression verification.');
  await fill('#book-price', '199.50');
  await fill('#book-status', 'published');
  const coverFile = path.join(artifacts, 'new-cover.png');
  await copyFile(path.join(root, 'public/covers/letters-i-never-sent-cover.png'), coverFile);
  const fullFile = path.join(artifacts, 'full.pdf');
  const sampleFile = path.join(artifacts, 'sample.pdf');
  await writeFile(fullFile, '%PDF-1.7\nPrivate complete book\n%%EOF');
  await copyFile(path.join(root, 'public/samples/letters-i-never-sent-sample.pdf'), sampleFile);
  await upload('#book-cover', coverFile);
  await upload('#book-main-pdf', fullFile);
  await upload('#book-sample-pdf', sampleFile);
  await clickText('Save book');
  console.log('Browser: uploaded cover, full PDF, and sample; saving new book.');
  await until(`document.querySelector('h1')?.textContent === 'Catalogue' && document.body.innerText.includes(${JSON.stringify(title)})`, 'new book saved');
  const save = requests.findLast((r) => r.path === '/api/admin/products' && r.method === 'POST');
  assert.equal(save.status, 200);
  const { product } = JSON.parse(save.responseBody);
  assert.notEqual(product.sample_pdf_key, product.main_pdf_key);
  const coverUrl = product.cover_url;
  await call('Page.reload');
  await until("document.querySelector('[aria-label=\"Admin navigation\"]')", 'admin reloaded');
  await until("Object.keys(document.querySelector('nav button') || {}).some(k => k.startsWith('__reactProps$'))", 'admin reload hydrated');
  await evaluate("[...document.querySelectorAll('nav button')].find(b => b.textContent.includes('Catalogue'))?.click()");
  await until(`document.querySelector('img[src=${JSON.stringify(coverUrl)}]')?.naturalWidth > 0`, 'saved cover after admin reload');
  await call('Page.navigate', { url: 'http://localhost:3100/' });
  await until(`document.querySelector('#title-${slug}')`, 'new storefront card');
  await evaluate(`document.querySelector('#title-${slug}').closest('article').scrollIntoView()`);
  await until(`document.querySelector('#title-${slug}').closest('article').querySelector('img').naturalWidth > 0`, 'new storefront cover');
  assert.equal(await evaluate(`document.querySelector('#title-${slug}').closest('article').querySelector('img').getAttribute('src')`), coverUrl);
  await call('Page.reload');
  await until(`document.querySelector('#title-${slug}')`, 'storefront reload');
  await evaluate(`document.querySelector('#title-${slug}').closest('article').scrollIntoView()`);
  await until(`document.querySelector('#title-${slug}').closest('article').querySelector('img').naturalWidth > 0`, 'cover loaded after reload');
  await evaluate(`document.querySelector('#title-${slug}').closest('article').querySelector('img').dispatchEvent(new Event('error'))`);
  await until(`new URL(document.querySelector('#title-${slug}').closest('article').querySelector('img').src).pathname === '/cover-placeholder.svg'`, 'clean fallback on cover failure');
  await evaluate(`document.querySelector('#title-${slug}').closest('article').querySelector('.book-actions button').click()`);
  await until("document.querySelector('dialog[open]')", 'sample modal opened');
  await clickText('Download sample');
  await until("!document.body.innerText.includes('Downloading…')", 'sample response received');
  const sampleResponse = requests.findLast((r) => r.path === '/api/download');
  assert.equal(sampleResponse.status, 200);
  assert.equal(sampleResponse.contentType, 'application/pdf');
  let downloaded;
  for (let i = 0; i < 40; i++) {
    downloaded = (await readdir(artifacts)).find((f) => f.endsWith('-sample.pdf'));
    if (downloaded) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(downloaded, 'Browser saved a PDF attachment');
  assert.equal((await readFile(path.join(artifacts, downloaded))).subarray(0, 5).toString(), '%PDF-');
  // A missing sample must be shown as an error, without creating another file.
  const missingSample = await fetch(`http://127.0.0.1:5100/api/admin/products/${product.id}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json', origin: 'http://localhost:3100', 'x-dev-admin': 'true' },
    body: JSON.stringify({ samplePdfKey: null }),
  });
  assert.equal(missingSample.status, 200);
  await clickText('Download sample');
  await until("document.querySelector('dialog[open] [role=alert]')?.textContent.includes('not available')", 'missing sample shown as a useful error');
  assert.equal(requests.findLast((r) => r.path === '/api/download').status, 404);
  assert.equal((await readdir(artifacts)).filter((f) => f.endsWith('-sample.pdf')).length, 1);
  await call('Page.navigate', { url: `http://localhost:3100/checkout?book=${slug}` });
  await until(`document.querySelector('.checkout-book-details h3')?.textContent === ${JSON.stringify(title)}`, 'checkout actual product');
  await until("document.querySelector('.checkout-book-cover img')?.naturalWidth > 0", 'checkout actual cover');
  assert.equal(await evaluate("document.querySelector('.checkout-book-cover img').getAttribute('src')"), coverUrl);
  assert.equal(await evaluate("document.querySelector('.checkout-price-total').textContent.includes('199.5')"), true);
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.header-inner')).display"), 'flex');
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.footer-grid')).display"), 'grid');
  assert.equal(await evaluate("document.querySelector('.shop-header a[href=\"/#bookshelf\"]') !== null"), true);
  await fill('#fullName', 'New Reader');
  await fill('#email', 'new.reader@example.invalid');
  await fill('#phone', '+91 98765 43210');
  await evaluate("document.querySelector('.checkout-pay-button').click()");
  await until('window.__paymentOptions', 'checkout request accepted');
  const checkout = requests.findLast((r) => r.path === '/api/checkout');
  assert.equal(checkout.status, 200);
  assert.equal(JSON.parse(checkout.requestBody).productId, product.id);
  assert.equal(JSON.parse(checkout.requestBody).phone, '9876543210');
  assert.equal(await evaluate("document.body.innerText.includes('Payment successful')"), false);
  await writeFile(path.join(artifacts, 'checkout.png'), Buffer.from((await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })).data, 'base64'));
  assert.deepEqual(failures, []);
  await writeFile(path.join(artifacts, 'network.json'), JSON.stringify(requests, null, 2));
  console.log(JSON.stringify({ result: 'passed', newBook: slug, checks: ['admin upload/save/reload', 'storefront cover/reload', 'clean cover failure fallback', 'real PDF browser attachment', 'missing sample error without a download', 'checkout identity/cover/server price', 'shared header/footer styles and links', 'customer phone request', 'no browser exceptions'], artifacts }, null, 2));
} finally {
  socket?.close();
  browser.kill();
}
