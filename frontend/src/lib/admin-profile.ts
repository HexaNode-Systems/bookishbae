import { adminProfileSchema, MAX_PROFILE_PHOTO_BYTES, PROFILE_PHOTO_TYPES } from '../../../shared/admin-profile';
import { safeReadApiResponse } from '../components/admin/admin-types';

export { adminProfileSchema, MAX_PROFILE_PHOTO_BYTES, PROFILE_PHOTO_TYPES };

export function profilePhotoError(file: Pick<File, 'name' | 'type' | 'size'>): string | null {
  const extensions: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif' };
  const type = file.type || extensions[file.name.split('.').pop()?.toLowerCase() || ''];
  if (!(PROFILE_PHOTO_TYPES as readonly string[]).includes(type || '')) return 'Choose a JPG, PNG, WEBP or AVIF image.';
  if (!file.size) return 'Choose an image that is not empty.';
  if (file.size > MAX_PROFILE_PHOTO_BYTES) return 'Your profile photo must be 5 MB or smaller.';
  return null;
}

export async function uploadProfilePhoto(file: File, signal: AbortSignal): Promise<string> {
  const problem = profilePhotoError(file);
  if (problem) throw new Error(problem);
  const form = new FormData();
  form.set('purpose', 'avatar');
  form.set('file', file);
  const response = await fetch('/api/admin/uploads', { method: 'POST', body: form, signal });
  const { ok, data, error } = await safeReadApiResponse(response);
  if (!ok) throw new Error(error || 'Your photo could not be uploaded. Please try again.');
  try {
    const url = new URL(data?.url);
    if (url.origin === 'https://res.cloudinary.com' && !url.username && !url.password) return url.toString();
  } catch { /* Missing/invalid storage confirmation is an upload failure. */ }
  throw new Error('The upload did not return a valid photo. Please try again.');
}

export async function saveAdminProfile(values: { fullName: string; phone: string; avatarUrl: string }) {
  const body = adminProfileSchema.parse(values);
  const response = await fetch('/api/admin/profile', {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const { ok, data, error } = await safeReadApiResponse(response);
  if (!ok) throw new Error(error || 'Your profile could not be saved. Please try again.');
  const profile = data?.profile;
  if (!profile || typeof profile.id !== 'string' || typeof profile.full_name !== 'string' ||
    !(profile.phone === null || typeof profile.phone === 'string') ||
    !(profile.avatar_url === null || typeof profile.avatar_url === 'string')) {
    throw new Error('Your profile save could not be confirmed. Please try again.');
  }
  return profile as { id: string; full_name: string; phone: string | null; avatar_url: string | null };
}
