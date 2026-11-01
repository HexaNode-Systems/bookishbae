import { randomUUID, timingSafeEqual, createHash } from 'node:crypto';
import type { User } from '@supabase/supabase-js';
import { ADMIN_ID, CUSTOMER_ID, engine } from './database-fixture';
const users = new Map<string, User>();
const passwords = new Map<string, Buffer>();
export const tokens = new Map<string, string>([['fixture-admin-token', ADMIN_ID], ['fixture-customer-token', CUSTOMER_ID]]);
export const authWrites: Record<string, unknown>[] = [];
const digest = (password: string) => createHash('sha256').update(password).digest();
export function installAuthFixture() {
  users.set(ADMIN_ID, { id: ADMIN_ID, email: 'admin@bookishbae.com', email_confirmed_at: new Date().toISOString() } as User);
  users.set(CUSTOMER_ID, { id: CUSTOMER_ID, email: 'buyer@example.com', email_confirmed_at: new Date().toISOString() } as User);
  const transport = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname !== 'supabase.test.invalid') return transport(input, init);
    if (url.pathname.startsWith('/rest/v1/')) throw new Error('PostgREST database requests are forbidden in tests.');
    const headers = new Headers(init?.headers);
    const method = init?.method || 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (url.pathname === '/auth/v1/user') {
      const id = tokens.get(headers.get('authorization')?.replace(/^Bearer /, '') || '');
      return id ? Response.json(users.get(id)) : Response.json({ message: 'Invalid token' }, { status: 401 });
    }
    if (url.pathname === '/auth/v1/token') {
      const user = [...users.values()].find(user => user.email === body.email);
      const expected = user && passwords.get(user.id);
      if (!user || !expected || !timingSafeEqual(expected, digest(body.password || ''))) return Response.json({ error_code: 'invalid_credentials', msg: 'Invalid credentials' }, { status: 400 });
      const token = `fixture-${randomUUID()}`;
      tokens.set(token, user.id);
      return Response.json({ access_token: token, refresh_token: randomUUID(), expires_in: 3600, token_type: 'bearer', user });
    }
    if (url.pathname === '/auth/v1/admin/users' && method === 'GET') return Response.json({ users: [...users.values()], total: users.size });
    if (url.pathname === '/auth/v1/admin/users' && method === 'POST') {
      if ([...users.values()].some(u => u.email === body.email)) return Response.json({ msg: 'Already exists' }, { status: 422 });
      const user = { id: randomUUID(), email: body.email, email_confirmed_at: body.email_confirm ? new Date().toISOString() : undefined } as User;
      // Only this Auth API stand-in writes auth.users. Production code never does.
      await engine.query('INSERT INTO auth.users(id,email) VALUES($1,$2)', [user.id,user.email]);
      users.set(user.id, user); passwords.set(user.id, digest(body.password));
      authWrites.push({ action: 'create', id: user.id });
      return Response.json(user);
    }
    if (url.pathname.startsWith('/auth/v1/admin/users/') && method === 'PUT') {
      const user = users.get(url.pathname.split('/').at(-1)!);
      if (!user) return Response.json({ msg: 'Missing user' }, { status: 404 });
      if (body.email_confirm) user.email_confirmed_at = new Date().toISOString();
      if (body.password) passwords.set(user.id, digest(body.password));
      authWrites.push({ action: 'update', id: user.id, reset: !!body.password });
      return Response.json(user);
    }
    return transport(input, init);
  };
}
