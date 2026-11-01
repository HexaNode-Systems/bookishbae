import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { AdminWorkspace } from '../src/components/admin/admin-workspace';
import { profilePhotoError } from '../src/lib/admin-profile';
import type { AdminIdentity } from '../src/components/admin/admin-types';

const identity: AdminIdentity = {
  id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', email: 'author@example.test', fullName: 'Test Author', phone: '9876543210',
  avatarUrl: '', authenticated: true, preview: false,
};
const avatarUrl = `https://res.cloudinary.com/test-cloud/image/upload/avatars/${identity.id}/cccccccc-cccc-4ccc-cccc-cccccccccccc.png.png`;
const photo = () => new File(['image fixture'], 'photo.png', { type: 'image/png' });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function text(node: ReactTestInstance): string { return node.children.map(child => typeof child === 'string' ? child : text(child)).join(''); }
function button(view: ReactTestRenderer, label: string) { return view.root.findAllByType('button').find(node => text(node) === label)!; }
const field = (view: ReactTestRenderer, id: string) => view.root.findByProps({ id });
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

async function workspace(t: TestContext, transport?: (url: string, init?: RequestInit) => Promise<Response>, initialIdentity = identity) {
  const listeners = new Map<string, (event: any) => void>();
  const windowBefore = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const documentBefore = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const selfBefore = Object.getOwnPropertyDescriptor(globalThis, 'self');
  const mockWindow = {
    location: { href: 'http://localhost:3000/admin' },
    addEventListener: (name: string, callback: (event: any) => void) => listeners.set(name, callback),
    removeEventListener: (name: string, callback: (event: any) => void) => { if (listeners.get(name) === callback) listeners.delete(name); },
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    requestIdleCallback: (cb: any) => setTimeout(cb, 1),
    cancelIdleCallback: (id: any) => clearTimeout(id),
  };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: mockWindow });
  Object.defineProperty(globalThis, 'self', { configurable: true, value: mockWindow });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { getElementById: () => ({ focus() {} }) } });
  let nextUrl = 0;
  const revoked: string[] = [];
  t.mock.method(URL, 'createObjectURL', () => `blob:profile-preview-${++nextUrl}`);
  t.mock.method(URL, 'revokeObjectURL', (url: string) => { revoked.push(url); });
  const requests: { url: string; init?: RequestInit }[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, init });
    if (url.startsWith('/api/admin/products')) return Response.json({ products: [], total: 0 });
    if (url === '/api/admin/stats') return Response.json({ catalogueTitles: 0, workspaceDrafts: 0, revenuePaise: 0, orderCount: 0, recentOrders: [] });
    if (transport) return transport(url, init);
    throw new Error('Unexpected API request');
  });
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(<AdminWorkspace initialIdentity={initialIdentity} />, { createNodeMock: element => {
      if (element.type === 'h1') return { focus() {} };
      if (element.type === 'input') return { value: '' };
      return null;
    } });
  });
  await act(async () => view.root.findByProps({ 'aria-label': 'Open admin profile' }).props.onClick());
  t.after(() => {
    act(() => view.unmount());
    if (windowBefore) Object.defineProperty(globalThis, 'window', windowBefore); else Reflect.deleteProperty(globalThis, 'window');
    if (selfBefore) Object.defineProperty(globalThis, 'self', selfBefore); else Reflect.deleteProperty(globalThis, 'self');
    if (documentBefore) Object.defineProperty(globalThis, 'document', documentBefore); else Reflect.deleteProperty(globalThis, 'document');
  });
  return { view, requests, revoked, listeners };
}
async function fill(view: ReactTestRenderer, id: string, value: string) {
  await act(async () => field(view, id).props.onChange({ target: { value } }));
}
async function choose(view: ReactTestRenderer, file = photo()) {
  await act(async () => field(view, 'profile-avatar').props.onChange({ currentTarget: { files: [file], value: file.name } }));
}
const saveResponse = (body: { fullName: string; phone: string; avatarUrl: string }) => Response.json({ profile: {
  id: identity.id, full_name: body.fullName.trim(), phone: body.phone.trim() || null, avatar_url: body.avatarUrl || null,
} });

test('Profile photo validation supports four image formats and rejects empty, unsupported and oversized files', () => {
  for (const type of ['image/jpeg', 'image/png', 'image/webp', 'image/avif']) {
    assert.equal(profilePhotoError({ name: 'photo', type, size: 5 * 1024 * 1024 }), null);
  }
  assert.equal(profilePhotoError({ name: 'photo.avif', type: '', size: 123 }), null);
  assert.match(profilePhotoError({ name: 'image.svg', type: 'image/svg+xml', size: 100 })!, /JPG, PNG, WEBP or AVIF/);
  assert.match(profilePhotoError({ name: 'photo.png', type: 'image/png', size: 0 })!, /empty/);
  assert.match(profilePhotoError({ name: 'photo.png', type: 'image/png', size: 5 * 1024 * 1024 + 1 })!, /5 MB/);
});

test('Photo previews immediately; save persists only editable fields and updates profile card/header and reload state', async t => {
  const uploading = deferred<Response>(), saving = deferred<Response>();
  let saved: any;
  const { view, requests, revoked } = await workspace(t, async (url, init) => {
    if (url === '/api/admin/uploads') {
      const body = init!.body as FormData;
      assert.equal(body.get('purpose'), 'avatar');
      assert.equal((body.get('file') as File).name, 'photo.png');
      assert.equal(body.has('productId'), false);
      return uploading.promise;
    }
    if (url === '/api/admin/profile') { saved = JSON.parse(init!.body as string); return saving.promise; }
    throw Error('Unexpected request');
  });
  assert.equal(field(view, 'profile-email').props.disabled, true);
  assert.equal(view.root.findAllByType('input').some(node => ['password', 'role', 'permissions'].includes(node.props.name)), false);
  await fill(view, 'profile-name', '  Updated Author  ');
  await fill(view, 'profile-phone', '+91 98765-43210');
  await choose(view);
  assert.equal(view.root.findByProps({ alt: 'Your profile preview', sizes: '80px' }).props.src, 'blob:profile-preview-1');
  assert.equal(button(view, 'Save profile').props.disabled, true);
  assert.match(text(view.root), /Uploading photo/);
  await act(async () => { uploading.resolve(Response.json({ url: avatarUrl })); await tick(); });
  assert.equal(button(view, 'Save profile').props.disabled, false);
  let pending!: Promise<void>;
  act(() => { pending = view.root.findByType('form').props.onSubmit({ preventDefault() {} }); });
  assert.equal(button(view, 'Saving…').props.disabled, true);
  assert.equal(field(view, 'profile-name').props.disabled, true);
  await act(async () => { saving.resolve(saveResponse(saved)); await pending; });
  assert.deepEqual(saved, { fullName: 'Updated Author', phone: '+91 98765-43210', avatarUrl });
  assert.equal(view.root.findByProps({ 'aria-label': 'Open admin profile' }).findByType('strong').children[0], 'Updated Author');
  assert.equal(view.root.findByProps({ className: 'admin-avatar' }).findByType('img').props.src, avatarUrl);
  assert.equal(view.root.findByProps({ alt: 'Your profile preview', sizes: '80px' }).props.src, avatarUrl);
  assert.match(text(view.root), /Your profile details have been saved/);
  assert.ok(revoked.includes('blob:profile-preview-1'));
  assert.equal(requests.some(request => /supabase|rest\/v1/.test(request.url)), false);
  // A new mount receives the persisted profile, just as a server-rendered reload does.
  await act(async () => view.update(<AdminWorkspace key="reloaded" initialIdentity={{ ...identity, ...saved }} />));
  await act(async () => view.root.findByProps({ 'aria-label': 'Open admin profile' }).props.onClick());
  assert.equal(field(view, 'profile-name').props.value, 'Updated Author');
  assert.equal(field(view, 'profile-phone').props.value, '+91 98765-43210');
  assert.equal(view.root.findByProps({ className: 'admin-avatar' }).findByType('img').props.src, avatarUrl);
});

test('Upload errors keep the draft, support retry/remove/replace, and cancel restores saved values', async t => {
  let uploads = 0;
  const { view, revoked } = await workspace(t, async () => {
    uploads++;
    return uploads === 1 ? Response.json({ error: { message: 'Photo upload unavailable.' } }, { status: 502 }) : Response.json({ url: avatarUrl });
  }, { ...identity, avatarUrl });
  await fill(view, 'profile-name', 'Unsaved name');
  await choose(view);
  assert.match(text(view.root), /Photo upload unavailable/);
  assert.equal(button(view, 'Save profile').props.disabled, true);
  await act(async () => button(view, 'Retry photo upload').props.onClick());
  assert.equal(uploads, 2);
  assert.match(text(view.root), /ready to save/);
  await choose(view, new File(['replacement'], 'new.webp', { type: 'image/webp' }));
  assert.equal(uploads, 3);
  assert.match(text(view.root), /new.webp/);
  await act(async () => button(view, 'Remove photo').props.onClick());
  assert.equal(view.root.findAllByType('img').some(node => node.props.alt === 'Your profile preview'), false);
  assert.equal(button(view, 'Save profile').props.disabled, false);
  await act(async () => button(view, 'Cancel changes').props.onClick());
  assert.equal(field(view, 'profile-name').props.value, identity.fullName);
  assert.equal(view.root.findByProps({ alt: 'Your profile preview', sizes: '80px' }).props.src, avatarUrl);
  assert.equal(button(view, 'Save profile').props.disabled, true);
  assert.equal(revoked.length, 3);
});

test('Cancel during an upload aborts it and ignores a late upload response', async t => {
  const response = deferred<Response>();
  let signal!: AbortSignal;
  const { view, revoked } = await workspace(t, async (_url, init) => { signal = init!.signal!; return response.promise; });
  await choose(view);
  await act(async () => button(view, 'Cancel changes').props.onClick());
  assert.equal(signal.aborted, true);
  await act(async () => { response.resolve(Response.json({ url: avatarUrl })); await tick(); });
  assert.equal(view.root.findAllByType('img').some(node => node.props.alt === 'Your profile preview'), false);
  assert.equal(button(view, 'Save profile').props.disabled, true);
  assert.deepEqual(revoked, ['blob:profile-preview-1']);
});

test('Validation blocks invalid profile fields/files and save failures retain editable drafts for retry', async t => {
  let attempts = 0;
  const { view, requests } = await workspace(t, async (_url, init) => {
    attempts++;
    return attempts === 1 ? Response.json({ error: { message: 'Profile database is unavailable.' } }, { status: 502 }) : saveResponse(JSON.parse(init!.body as string));
  });
  await fill(view, 'profile-name', ' ');
  await fill(view, 'profile-phone', '+ ( ). -');
  await act(async () => view.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  assert.match(text(view.root), /Enter your full name/);
  assert.match(text(view.root), /Enter a valid phone/);
  assert.equal(attempts, 0);
  await choose(view, new File(['svg'], 'bad.svg', { type: 'image/svg+xml' }));
  assert.equal(requests.some(request => request.url === '/api/admin/uploads'), false);
  assert.match(text(view.root), /Choose a JPG/);
  await act(async () => button(view, 'Cancel changes').props.onClick());
  await fill(view, 'profile-name', 'Retry Author');
  await act(async () => view.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  assert.match(text(view.root), /Profile database is unavailable/);
  assert.equal(field(view, 'profile-name').props.value, 'Retry Author');
  assert.equal(view.root.findByProps({ 'aria-label': 'Open admin profile' }).findByType('strong').children[0], identity.fullName);
  assert.equal(button(view, 'Save profile').props.disabled, false);
  await act(async () => view.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  assert.match(text(view.root), /Your profile details have been saved/);
  assert.equal(view.root.findByProps({ 'aria-label': 'Open admin profile' }).findByType('strong').children[0], 'Retry Author');
});

test('Unsaved profile changes guard navigation, reload and logout; discarding restores persisted state', async t => {
  const { view, listeners } = await workspace(t);
  await fill(view, 'profile-name', 'Unsaved Author');
  const event = { prevented: false, returnValue: undefined as string | undefined, preventDefault() { this.prevented = true; } };
  listeners.get('beforeunload')!(event);
  assert.equal(event.prevented, true);
  await act(async () => button(view, 'Logout').props.onClick());
  assert.match(text(view.root), /Save or cancel your unsaved changes/);
  await act(async () => button(view, 'Dashboard').props.onClick());
  assert.match(text(view.root), /Leave your unsaved changes/);
  await act(async () => button(view, 'Keep editing').props.onClick());
  assert.equal(field(view, 'profile-name').props.value, 'Unsaved Author');
  await act(async () => button(view, 'Dashboard').props.onClick());
  await act(async () => button(view, 'Discard changes').props.onClick());
  await act(async () => view.root.findByProps({ 'aria-label': 'Open admin profile' }).props.onClick());
  assert.equal(field(view, 'profile-name').props.value, identity.fullName);
});
