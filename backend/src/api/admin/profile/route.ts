import { createHandler } from '../../../lib/api/handler';
import { badRequest, notFound } from '../../../lib/api/errors';
import { updateOwnProfile } from '../../../lib/db/profiles';
import { env } from '../../../lib/env';
import { adminProfileSchema } from '../../../../../shared/admin-profile';

function isOwnAvatar(url: string, userId: string) {
  try {
    const parsed = new URL(url);
    const prefix = `/${env.CLOUDINARY_CLOUD_NAME}/image/upload/`;
    if (parsed.origin !== 'https://res.cloudinary.com' || parsed.username || parsed.password ||
      parsed.search || parsed.hash || !parsed.pathname.startsWith(prefix)) return false;
    const path = parsed.pathname.slice(prefix.length).replace(/^v\d+\//, '');
    const parts = path.split('/');
    return parts.length === 3 && parts[0] === 'avatars' && parts[1] === userId &&
      /^[a-f0-9-]+\.(?:jpe?g|png|webp|avif)(?:\.(?:jpe?g|png|webp|avif))?$/i.test(parts[2]!);
  } catch { return false; }
}

export const PATCH = createHandler({
  auth: 'admin', rateLimit: { name: 'adminWrite', by: 'user' }, body: adminProfileSchema,
}, async ({ user, profile: existing, body }) => {
  if (body.avatarUrl && body.avatarUrl !== existing?.avatar_url && !isOwnAvatar(body.avatarUrl, user!.id)) {
    throw badRequest('Upload a profile photo using your account before saving it.');
  }
  const profile = await updateOwnProfile(user!.id, body);
  if (!profile)
    throw notFound();
  return { profile };
});
