import { v2 as cloudinary } from 'cloudinary';
import { Writable } from 'node:stream';
import { readFile } from 'node:fs/promises';

/** Test-only storage transport: real uploaded bytes, no developer credentials. */
export const storedObjects = new Map<string, Buffer>();

export function installStorageFixture() {
  cloudinary.uploader.upload_stream = ((options: any, callback: any) => {
    const chunks: Buffer[] = [];
    return new Writable({
      write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); },
      final(done) {
        storedObjects.set(options.public_id, Buffer.concat(chunks));
        callback(null, {
          public_id: options.public_id,
          secure_url: cloudinary.url(options.public_id, {
            secure: true, resource_type: options.resource_type, type: options.type, force_version: false, analytics: false,
            ...(options.resource_type === 'image' ? { format: options.public_id.split('.').pop() } : {}),
          }),
        });
        done();
      },
    });
  }) as typeof cloudinary.uploader.upload_stream;

  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname === 'supabase.test.invalid' && url.pathname === '/rest/v1/rpc/validate_coupon') {
      const body = JSON.parse(String(init?.body));
      const code = String(body.p_code).toLowerCase();
      const percent = code === 'launch50';
      return Response.json(['launch50', 'read100'].includes(code) ? {
        valid: true, coupon_id: percent ? '10000000-0000-0000-0000-000000000001' : '10000000-0000-0000-0000-000000000002',
        discount_type: percent ? 'percent' : 'flat', discount_value: percent ? 50 : 10000,
        discount_paise: percent ? Math.floor(body.p_subtotal_paise / 2) : Math.min(10000, body.p_subtotal_paise),
      } : { valid: false, reason: 'not_found' });
    }
    if (url.hostname === 'api.cloudinary.com' && url.pathname.endsWith('/download')) {
      const bytes = storedObjects.get(url.searchParams.get('public_id') || '');
      return new Response(bytes ? Uint8Array.from(bytes) : null, { status: bytes ? 200 : 404 });
    }
    if (url.origin === 'http://localhost:3000' && /^\/samples\/(the-long-afternoon|letters-i-never-sent|everything-we-didnt-say)-sample\.pdf$/.test(url.pathname)) {
      return new Response(Uint8Array.from(await readFile(new URL(`../../frontend/public${url.pathname}`, import.meta.url))), {
        headers: { 'content-type': 'application/pdf' },
      });
    }
    return new Response(JSON.stringify({ message: 'External services are disabled in tests.', code: 'TEST_NETWORK_DISABLED' }), {
      status: 400, headers: { 'content-type': 'application/json' },
    });
  };
}
