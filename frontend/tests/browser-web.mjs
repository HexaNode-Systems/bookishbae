// Keep the browser regression's Next output and API transport separate from dev.
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import next from 'next';

process.env.BOOKISHBAE_BUILD_DIR = '.next-browser';
process.env.BACKEND_URL = process.env.BOOKISHBAE_BROWSER_BACKEND || 'http://127.0.0.1:5100';
const app = next({ dev: true, dir: fileURLToPath(new URL('../', import.meta.url)) });
await app.prepare();
createServer(app.getRequestHandler()).listen(3100, '127.0.0.1', () => console.log('Browser regression frontend ready on http://localhost:3100'));
