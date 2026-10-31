import { requireAdmin } from '@/lib/auth';
import { AdminWorkspace } from '@/components/admin/admin-workspace';
import './admin.css';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const { user, profile } = await requireAdmin();
  const preview =
    user.id === 'dev-admin-id' ||
    profile.id === 'dev-admin-id' ||
    profile.role !== 'admin';

  return (
    <AdminWorkspace
      initialIdentity={{
        id: preview ? null : profile.id,
        email: preview ? null : profile.email,
        fullName: preview ? '' : (profile.full_name ?? ''),
        phone: preview ? '' : (profile.phone ?? ''),
        avatarUrl: preview ? '' : (profile.avatar_url ?? ''),
        preview,
        authenticated: user.id !== 'dev-admin-id',
      }}
    />
  );
}
