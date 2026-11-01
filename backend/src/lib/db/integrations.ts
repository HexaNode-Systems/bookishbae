import { env } from '../env';

export function getIntegrationsStatus(): Record<
  string,
  { configured: boolean; setting: string; status: 'ready' | 'incomplete' }
> {
  const hasCashfree = Boolean(env.CASHFREE_APP_ID && env.CASHFREE_SECRET_KEY);
  const hasBrevo = Boolean(env.BREVO_API_KEY && env.EMAIL_FROM);
  const hasCloudinary = Boolean(
    env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET,
  );
  const hasSupabase = Boolean(
    env.NEXT_PUBLIC_SUPABASE_URL &&
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
      env.SUPABASE_SERVICE_ROLE_KEY,
  );

  return {
    cashfree: {
      configured: hasCashfree,
      setting: env.CASHFREE_ENVIRONMENT || 'TEST',
      status: hasCashfree ? 'ready' : 'incomplete',
    },
    brevo: {
      configured: hasBrevo,
      setting: env.EMAIL_FROM || 'Not configured',
      status: hasBrevo ? 'ready' : 'incomplete',
    },
    cloudinary: {
      configured: hasCloudinary,
      setting: env.CLOUDINARY_CLOUD_NAME || 'Not configured',
      status: hasCloudinary ? 'ready' : 'incomplete',
    },
    supabase: {
      configured: hasSupabase,
      setting: 'Connected',
      status: hasSupabase ? 'ready' : 'incomplete',
    },
  };
}
