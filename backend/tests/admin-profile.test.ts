import assert from 'node:assert/strict';
import test from 'node:test';
import { Writable } from 'node:stream';
import { NextRequest } from 'next/server';
import { v2 as cloudinary } from 'cloudinary';
import * as uploads from '../src/api/admin/uploads/route';
import * as profile from '../src/api/admin/profile/route';
import * as me from '../src/api/auth/me/route';
import { db, getPool } from '../src/lib/db/postgres';
import { getProfile } from '../src/lib/db/profiles';
import { env } from '../src/lib/env';
import { ADMIN_ID, CUSTOMER_ID } from './database-fixture';
import { storedObjects } from './storage-fixture';

const imageBytes: Record<string, Buffer> = {
  'image/jpeg': Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70]),
  'image/png': Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6B9sAAAAASUVORK5CYII=', 'base64'),
  'image/webp': Buffer.from('RIFF\x14\x00\x00\x00WEBPVP8 test-avatar'),
  'image/avif': Buffer.from('\x00\x00\x00\x20ftypavif\x00\x00\x00\x00avifmif1'),
};
function upload(type = 'image/png', bytes = imageBytes[type]!, role = 'admin', name = 'avatar.png', origin = 'http://localhost:3000') {
  const body = new FormData();
  body.set('purpose', 'avatar');
  body.set('productId', CUSTOMER_ID); // The server must ignore a client-supplied owner.
  body.set('file', new File([Uint8Array.from(bytes)], name, { type }));
  return uploads.POST(new NextRequest('http://localhost:3000/api/admin/uploads', {
    method: 'POST', body, headers: { origin, ...(role !== 'none' ? { authorization: `Bearer fixture-${role}-token` } : {}) },
  }));
}
function patch(body: unknown, role = 'admin') {
  return profile.PATCH(new NextRequest('http://localhost:3000/api/admin/profile', {
    method: 'PATCH', headers: { origin: 'http://localhost:3000', 'content-type': 'application/json', ...(role !== 'none' ? { authorization: `Bearer fixture-${role}-token` } : {}) },
    body: JSON.stringify(body),
  }));
}

test('Admin profile and avatar upload enforce 401/403 and same-origin requests', async () => {
  for (const [role, status] of [['none', 401], ['customer', 403]] as const) {
    assert.equal((await patch({ fullName: 'Forbidden change' }, role)).status, status);
    assert.equal((await upload('image/png', imageBytes['image/png'], role)).status, status);
  }
  assert.equal((await upload('image/png', imageBytes['image/png'], 'admin', 'avatar.png', 'https://attacker.invalid')).status, 403);
});

test('Avatar upload accepts JPG, PNG, WEBP and AVIF in the authenticated admin folder', async () => {
  for (const [type, bytes] of Object.entries(imageBytes)) {
    const response = await upload(type, bytes);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.ok(result.key.startsWith(`avatars/${ADMIN_ID}/`));
    assert.equal(result.key.includes(CUSTOMER_ID), false);
    assert.match(result.url, /^https:\/\/res\.cloudinary\.com\/test-cloud\/image\/upload\//);
    assert.deepEqual(storedObjects.get(result.key), bytes);
    for (const secret of [env.SUPABASE_SERVICE_ROLE_KEY, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, env.CLOUDINARY_API_SECRET, env.DATABASE_URL]) {
      assert.equal(JSON.stringify(result).includes(secret), false);
    }
  }
  const fallback = await upload('', imageBytes['image/avif'], 'admin', 'avatar.avif');
  assert.equal(fallback.status, 200, 'Files with a missing MIME type use the supported filename extension');
});

test('Avatar policy rejects empty, oversized, unsupported and disguised files before storing them', async () => {
  const before = storedObjects.size;
  for (const [type, bytes] of [
    ['image/png', Buffer.alloc(0)], ['image/png', Buffer.alloc(5 * 1024 * 1024 + 1)],
    ['image/svg+xml', Buffer.from('<svg></svg>')], ['image/gif', Buffer.from('GIF89a')],
    ['image/jpeg', Buffer.from('<html>not an image</html>')], ['image/png', imageBytes['image/jpeg']!],
  ] as const) assert.equal((await upload(type, bytes)).status, 400);
  assert.equal(storedObjects.size, before);
  const exactLimit = Buffer.alloc(5 * 1024 * 1024);
  imageBytes['image/png']!.copy(exactLimit);
  assert.equal((await upload('image/png', exactLimit)).status, 200);
});

test('Profile name, phone and uploaded photo persist through fresh authenticated reads, replacement and removal', async () => {
  const [customerBefore] = await db.query('SELECT * FROM public.profiles WHERE id=$1', [CUSTOMER_ID]);
  const uploaded = await (await upload()).json();
  const result = await patch({ fullName: '  Updated Author  ', phone: ' +91 98765-43210 ', avatarUrl: uploaded.url });
  assert.equal(result.status, 200);
  assert.deepEqual((await result.json()).profile, { id: ADMIN_ID, full_name: 'Updated Author', phone: '+91 98765-43210', avatar_url: uploaded.url });
  const fresh = await me.GET(new NextRequest('http://localhost:3000/api/auth/me', { headers: { authorization: 'Bearer fixture-admin-token' } }));
  const reloaded = await fresh.json();
  assert.equal(reloaded.profile.full_name, 'Updated Author');
  assert.equal(reloaded.profile.phone, '+91 98765-43210');
  assert.equal(reloaded.profile.avatar_url, uploaded.url);
  assert.equal(reloaded.isAdmin, true);
  assert.equal((await patch({ fullName: 'Author name only' })).status, 200);
  assert.equal((await getProfile(ADMIN_ID))?.avatar_url, uploaded.url, 'Omitted fields must not erase the saved avatar');
  assert.equal((await getProfile(ADMIN_ID))?.phone, '+91 98765-43210');
  const replacement = await (await upload('image/webp')).json();
  assert.equal((await patch({ fullName: 'Author name only', avatarUrl: replacement.url })).status, 200);
  assert.equal((await getProfile(ADMIN_ID))?.avatar_url, replacement.url);
  assert.equal((await patch({ fullName: 'Author name only', phone: '', avatarUrl: '' })).status, 200);
  assert.equal((await getProfile(ADMIN_ID))?.avatar_url, null);
  assert.equal((await getProfile(ADMIN_ID))?.phone, null);
  assert.deepEqual((await db.query('SELECT * FROM public.profiles WHERE id=$1', [CUSTOMER_ID]))[0], customerBefore);
});

test('Profile edits reject privilege fields, invalid names/phones and foreign or unsafe photo URLs', async () => {
  const before = await getProfile(ADMIN_ID);
  for (const extra of [{ email: 'other@example.com' }, { role: 'admin' }, { password: 'uneditable' }, { permissions: [] }, { id: CUSTOMER_ID }]) {
    assert.equal((await patch({ fullName: 'Attempt', ...extra })).status, 422);
  }
  for (const values of [{ fullName: ' ' }, { fullName: 'x'.repeat(81) }, { fullName: 'Author', phone: '+ ( ). -' }, { fullName: 'Author', phone: 'invalid' }]) {
    assert.equal((await patch(values)).status, 422);
  }
  for (const avatarUrl of ['data:image/png;base64,abcd', 'blob:local', '//attacker.invalid/image.png', 'https://attacker.invalid/a.png',
    `https://res.cloudinary.com/test-cloud/image/upload/avatars/${CUSTOMER_ID}/abc.png`, '/covers/book.png',
    `https://res.cloudinary.com@attacker.invalid/test-cloud/image/upload/avatars/${ADMIN_ID}/abc.png`]) {
    const response = await patch({ fullName: 'Attempt', avatarUrl });
    assert.ok([400, 422].includes(response.status));
  }
  assert.deepEqual(await getProfile(ADMIN_ID), before);
});

test('Upload/storage and profile database failures return safe errors without changing saved profile', async t => {
  const before = await getProfile(ADMIN_ID);
  const secret = 'server-only-storage-error-fixture';
  const storageMock = t.mock.method(cloudinary.uploader, 'upload_stream', ((_options: unknown, callback: (error: Error) => void) => {
    const stream = new Writable({ write(_chunk, _encoding, done) { done(); } });
    queueMicrotask(() => callback(new Error(`Credentials ${secret} ${env.CLOUDINARY_API_SECRET}`)));
    return stream;
  }) as typeof cloudinary.uploader.upload_stream);
  const uploadFailure = await upload();
  assert.equal(uploadFailure.status, 502);
  const body = await uploadFailure.text();
  assert.equal(body.includes(secret), false);
  assert.equal(body.includes(env.CLOUDINARY_API_SECRET), false);
  storageMock.mock.restore();
  const query = getPool().query.bind(getPool());
  const dbMock = t.mock.method(getPool(), 'query', async (sql: string, values: unknown[]) => {
    if (sql.startsWith('UPDATE public.profiles')) throw new Error('database unavailable');
    return query(sql, values);
  });
  assert.equal((await patch({ fullName: 'Must not persist' })).status, 502);
  dbMock.mock.restore();
  assert.deepEqual(await getProfile(ADMIN_ID), before);
});
