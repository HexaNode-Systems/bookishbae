import { db } from './postgres';
import type { Profile } from '../../types/database';
export async function getProfile(userId: string): Promise<(Profile & {
  is_admin: boolean;
}) | null> {
  // notes and membership metadata are never sent to the client.
  const [profile] = await db.query<Profile & {
    is_admin: boolean;
  }>(`SELECT p.id,p.email,p.full_name,p.avatar_url,p.phone,p.role,p.marketing_opt_in,p.created_at,p.updated_at,
    (p.role='admin' AND EXISTS(SELECT 1 FROM public.admin_users a WHERE a.user_id=p.id)) AS is_admin FROM public.profiles p WHERE p.id=$1`, [userId]);
  return profile ?? null;
}
export async function updateOwnProfile(userId: string, values: {
  fullName: string;
  phone?: string | null;
  avatarUrl?: string | null;
}) {
  const [profile] = await db.query(`UPDATE public.profiles SET full_name=$2,
    phone=CASE WHEN $3::boolean THEN $4::text ELSE phone END,
    avatar_url=CASE WHEN $5::boolean THEN $6::text ELSE avatar_url END
    WHERE id=$1 RETURNING id,full_name,phone,avatar_url`,
  [userId, values.fullName, values.phone !== undefined, values.phone || null, values.avatarUrl !== undefined, values.avatarUrl || null]);
  return profile ?? null;
}
