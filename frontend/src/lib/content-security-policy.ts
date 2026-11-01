/**
 * Builds the Content-Security-Policy.
 *
 * `'strict-dynamic'` is the important part: it means a script trusted by its
 * nonce can load further scripts, which is how payment gateways bootstrap
 * themselves, while an injected `<script>` in a review body still gets nothing.
 * Host allowlists are kept alongside it for browsers without strict-dynamic
 * support, where they are honoured instead.
 *
 * `style-src` has to carry `'unsafe-inline'`: both Next and Framer Motion write
 * inline styles, and a nonce cannot cover style attributes. That is a real but
 * narrow concession — it permits styling, not execution.
 */
export function contentSecurityPolicy(nonce: string, isDev: boolean): string {
  const supabaseOrigin = (() => {
    try {
      return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').origin;
    } catch {
      return '';
    }
  })();

  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],

    'script-src': [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      'https://sdk.cashfree.com',
      // React Refresh compiles components with eval during development only.
      ...(isDev ? ["'unsafe-eval'"] : []),
    ],

    'style-src': ["'self'", "'unsafe-inline'"],

    // next/font self-hosts Playfair Display and Inter at build time, so no
    // Google Fonts origin is needed at runtime.
    'font-src': ["'self'", 'data:'],

    'img-src': [
      "'self'",
      'data:',
      'blob:',
      'https://res.cloudinary.com',
      ...(supabaseOrigin ? [supabaseOrigin] : []),
      'https://lh3.googleusercontent.com',
    ],

    'connect-src': [
      "'self'",
      ...(supabaseOrigin ? [supabaseOrigin, supabaseOrigin.replace('https://', 'wss://')] : []),
      'https://api.cashfree.com',
      'https://sandbox.cashfree.com',
      'https://*.cashfree.com',
      'https://api.cloudinary.com',
      'https://res.cloudinary.com',
      ...(isDev ? ['ws://localhost:*', 'http://localhost:*'] : []),
    ],

    // Cashfree Checkout renders inside an iframe or modal.
    'frame-src': [
      "'self'",
      'https://sdk.cashfree.com',
      'https://api.cashfree.com',
      'https://sandbox.cashfree.com',
      'https://*.cashfree.com',
    ],

    'worker-src': ["'self'", 'blob:'],
    'media-src': ["'self'", 'blob:', 'https://res.cloudinary.com'],
    'manifest-src': ["'self'"],

    // Nothing may frame us; the modern counterpart to X-Frame-Options: DENY.
    'frame-ancestors': ["'none'"],
    // Cashfree hosted checkout submits a form to the configured gateway.
    'form-action': ["'self'", 'https://sandbox.cashfree.com', 'https://api.cashfree.com'],
    'base-uri': ["'self'"],
    'object-src': ["'none'"],
  };

  const policy = Object.entries(directives)
    .map(([directive, values]) => `${directive} ${values.join(' ')}`)
    .join('; ');

  return isDev ? policy : `${policy}; upgrade-insecure-requests`;
}

