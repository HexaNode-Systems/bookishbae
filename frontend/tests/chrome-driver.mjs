import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export async function launchChrome(prefix = 'bookishbae-verification-') {
  const artifacts = await mkdtemp(path.join(tmpdir(), prefix));
  const browser = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0',
    `--user-data-dir=${path.join(artifacts, 'profile')}`, 'about:blank',
  ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  const endpoint = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(Error('Chrome did not start.')), 20_000);
    browser.once('error', reject);
    browser.stderr.on('data', data => { output += data; const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
  });
  const socket = new WebSocket(endpoint);
  await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
  const pending = new Map(); const listeners = new Map(); let nextId = 0;
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) { const item = pending.get(message.id); pending.delete(message.id); if (message.error) item?.reject(Error(JSON.stringify(message.error))); else item?.resolve(message.result); }
    else for (const listener of listeners.get(message.method) || []) listener(message.params, message.sessionId);
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`DevTools timed out: ${method}`)); }, 45_000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const call = (method, params) => send(method, params, sessionId);
  await call('Page.enable'); await call('Runtime.enable'); await call('Network.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 960, deviceScaleFactor: 1, mobile: false });
  const evaluate = async (expression, contextId) => {
    const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, ...(contextId ? { contextId } : {}) });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const until = async (expression, label, timeout = 60_000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) { if (await evaluate(`Boolean(${expression})`)) return; await new Promise(resolve => setTimeout(resolve, 250)); }
    throw Error(`Timed out: ${label}\n${await evaluate('document.body.innerText.slice(0, 1800)')}`);
  };
  const fill = (selector, value) => evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) throw Error('Missing field: ' + ${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(e.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : e.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value').set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event(e.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); })()`);
  const clickText = text => evaluate(`[...document.querySelectorAll('button,a')].find(e => e.textContent.trim() === ${JSON.stringify(text)})?.click()`);
  const screenshot = async name => { const result = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); const file = path.join(artifacts, name); await writeFile(file, Buffer.from(result.data, 'base64')); return file; };
  const close = () => { socket.close(); browser.kill(); };
  process.once('SIGINT', () => { close(); process.exit(130); });
  return { artifacts, send, call, evaluate, until, fill, clickText, screenshot, close, on: (name, listener) => { const items = listeners.get(name) || []; items.push(listener); listeners.set(name, items); } };
}
