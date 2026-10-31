/**
 * Next.js configuration for BookishBae Frontend.
 *
 * Security headers live in two places on purpose:
 *   - Content-Security-Policy is emitted per-request from `src/middleware.ts`
 *     because it carries a fresh nonce for Next's inline bootstrap scripts.
 *   - Every other header is static, so it is declared here and applied by the
 *     edge/CDN for all routes including static assets.
 */

/** Parse an https origin out of an env var without throwing on bad input. */
function hostnameOf(value) {
  if (!value) return null;
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

const supabaseHost = hostnameOf(process.env.NEXT_PUBLIC_SUPABASE_URL);
const isProductionBuild = process.env.NEXT_PHASE === 'phase-production-build';
const backendValue = process.env.BACKEND_URL || (!isProductionBuild ? 'http://localhost:5000' : '');
if (!backendValue && isProductionBuild) {
  throw new Error('BACKEND_URL must be set for production builds and deployments.');
}
let backendUrl = backendValue;
if (backendUrl) {
  let parsedBackendUrl;
  try {
    parsedBackendUrl = new URL(backendUrl);
  } catch {
    throw new Error('BACKEND_URL must be an absolute HTTP(S) URL.');
  }
  if (!['http:', 'https:'].includes(parsedBackendUrl.protocol)) {
    throw new Error('BACKEND_URL must use HTTP or HTTPS.');
  }
  if (isProductionBuild && parsedBackendUrl.protocol !== 'https:') {
    throw new Error('BACKEND_URL must use HTTPS in production.');
  }
  backendUrl = backendUrl.replace(/\/+$/, '');
}

/**
 * Static security headers.
 *
 * Strict-Transport-Security ("HSTS") is only honoured over https, so it is a
 * no-op during local development and takes effect on Vercel.
 */
const securityHeaders = [
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-site' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow verification servers/builds to avoid the running dev server's cache.
  distDir: process.env.BOOKISHBAE_BUILD_DIR || '.next',
  reactStrictMode: true,
  poweredByHeader: false,

  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: false },

  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'res.cloudinary.com', pathname: '/**' },
      ...(supabaseHost
        ? [{ protocol: 'https', hostname: supabaseHost, pathname: '/storage/v1/object/public/**' }]
        : []),
      { protocol: 'https', hostname: 'lh3.googleusercontent.com', pathname: '/**' },
    ],
    formats: ['image/avif', 'image/webp'],
  },

  experimental: {
    serverActions: {
      allowedOrigins: [hostnameOf(process.env.NEXT_PUBLIC_SITE_URL) ?? 'localhost:3000'],
    },
  },

  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${backendUrl}/api/:path*`,
      },
    ];
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
      {
        source: '/api/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate, private' },
          { key: 'Pragma', value: 'no-cache' },
        ],
      },
    ];
  },
};

export default nextConfig;
