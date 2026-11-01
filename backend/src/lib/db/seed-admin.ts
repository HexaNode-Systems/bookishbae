import type { SupabaseClient, User } from '@supabase/supabase-js';
import { transaction } from './postgres';
type AdminAuth = Pick<SupabaseClient['auth']['admin'], 'listUsers' | 'createUser' | 'updateUserById'>;
export type AdminSeedStage = 'database connection' | 'Supabase Auth user lookup' | 'Supabase Auth user create' | 'Supabase Auth user update' | 'database upsert';
export interface BootstrapOptions {
  email: string;
  password?: string;
  resetPassword?: boolean;
}
/** Auth owns credentials; public records contain only UUID, email and role. */
export async function seedAdmin(auth: AdminAuth, options: BootstrapOptions, onFailure?: (stage: AdminSeedStage, error: unknown) => void) {
  const email = options.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error('ADMIN_BOOTSTRAP_EMAIL must be a valid email.');
  if (options.password !== undefined && options.password.length < 12)
    throw new Error('ADMIN_BOOTSTRAP_PASSWORD must have at least 12 characters.');
  let stage: AdminSeedStage = 'database connection';
  return transaction(async (sql) => {
    // Serialize concurrent seeds, including Auth creation, across backend instances.
    await sql.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`bookishbae-admin:${email}`]);
    // Verify the expected schema before contacting Auth. Migrations are never automatic.
    await sql.query('SELECT p.id,p.email,p.role,a.user_id FROM public.profiles p LEFT JOIN public.admin_users a ON a.user_id=p.id LIMIT 0');
    let user: User | undefined;
    for (let page = 1; ; page++) {
      stage = 'Supabase Auth user lookup';
      const result = await auth.listUsers({ page, perPage: 1000 });
      if (result.error)
        throw new Error('Supabase Auth could not list users. Check the backend Auth configuration.', { cause: result.error });
      user = result.data.users.find(candidate => candidate.email?.toLowerCase() === email);
      if (user || result.data.users.length < 1000)
        break;
    }
    const existed = !!user;
    if (!user) {
      if (!options.password)
        throw new Error('ADMIN_BOOTSTRAP_PASSWORD is required to create an admin.');
      stage = 'Supabase Auth user create';
      const created = await auth.createUser({ email, password: options.password, email_confirm: true });
      if (created.error || !created.data.user)
        throw new Error('Supabase Auth could not create the admin. Check Auth settings and password policy.', { cause: created.error });
      user = created.data.user;
    }
    else if (!user.email_confirmed_at || options.resetPassword) {
      if (options.resetPassword && !options.password)
        throw new Error('ADMIN_BOOTSTRAP_PASSWORD is required for an explicit password reset.');
      stage = 'Supabase Auth user update';
      const updated = await auth.updateUserById(user.id, {
        email_confirm: true, ...(options.resetPassword ? { password: options.password } : {}),
      });
      if (updated.error || !updated.data.user)
        throw new Error('Supabase Auth could not update the admin.', { cause: updated.error });
      user = updated.data.user;
    }
    if (user.email?.toLowerCase() !== email)
      throw new Error('Supabase Auth returned a different identity. No admin access granted.');
    stage = 'database upsert';
    await sql.query(`INSERT INTO public.profiles(id,email,role) VALUES($1,$2,'admin')
      ON CONFLICT(id) DO UPDATE SET email=excluded.email,role='admin'`, [user.id, email]);
    await sql.query('INSERT INTO public.admin_users(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING', [user.id]);
    return { existed, passwordChanged: existed && !!options.resetPassword };
  }, error => onFailure?.(stage, error));
}
