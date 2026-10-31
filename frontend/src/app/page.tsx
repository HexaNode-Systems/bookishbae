import Storefront from '@/components/storefront';

// The existing CSP uses a fresh nonce per request. Render the public page per
// request as well so Next can put that nonce on its scripts before hydration.
export const dynamic = 'force-dynamic';

export default function HomePage() {
  return <Storefront />;
}
