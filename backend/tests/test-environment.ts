export function configureTestEnvironment() {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://test@127.0.0.1:1/bookishbae_test',
    DATABASE_SSL_MODE: 'disable',
    NEXT_PUBLIC_SITE_URL: 'http://localhost:3000',
    NEXT_PUBLIC_SUPABASE_URL: 'https://supabase.test.invalid',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key-not-a-real-secret',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key-not-a-real-secret',
    CLOUDINARY_CLOUD_NAME: 'test-cloud',
    CLOUDINARY_API_KEY: 'test-cloudinary-key',
    CLOUDINARY_API_SECRET: 'test-cloudinary-secret',
    CASHFREE_APP_ID: 'TEST-APP-ID',
    CASHFREE_SECRET_KEY: 'test-cashfree-secret',
    CASHFREE_ENVIRONMENT: 'TEST',
    BREVO_API_KEY: 'test-brevo-key',
    EMAIL_FROM: 'BookishBae <test@example.invalid>',
    ADMIN_BOOTSTRAP_EMAILS: 'admin@example.invalid',
    IP_HASH_SALT: 'test-only-ip-hash-salt-not-secret',
    RATE_LIMIT_ENABLED: 'false',
  });
}
