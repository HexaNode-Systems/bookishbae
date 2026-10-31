import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';

import { Toaster } from 'sonner';

import { cn } from '@/lib/utils';

import './globals.css';

/**
 * Typefaces are committed to the repository (src/assets/fonts, Latin subsets
 * from @fontsource) and loaded with next/font/local rather than
 * next/font/google.
 *
 * Three reasons. The build never reaches out to fonts.googleapis.com, so it
 * works offline and cannot fail because someone else's CDN is slow. The exact
 * font version is pinned, so a silent upstream metric change cannot reflow the
 * site. And the CSP needs no Google origin in `font-src`.
 *
 * Either way next/font self-hosts the files and generates the size-adjusted
 * fallback that keeps CLS at zero.
 */
const playfair = localFont({
  variable: '--font-playfair',
  display: 'swap',
  // Georgia is metrically closest to Playfair Display of the common system
  // serifs, which is what makes the pre-swap frame look almost identical.
  fallback: ['Georgia', 'Times New Roman', 'serif'],
  src: [
    { path: '../assets/fonts/playfair-display-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: '../assets/fonts/playfair-display-latin-400-italic.woff2', weight: '400', style: 'italic' },
    { path: '../assets/fonts/playfair-display-latin-500-normal.woff2', weight: '500', style: 'normal' },
    { path: '../assets/fonts/playfair-display-latin-600-normal.woff2', weight: '600', style: 'normal' },
    { path: '../assets/fonts/playfair-display-latin-700-normal.woff2', weight: '700', style: 'normal' },
  ],
});

const inter = localFont({
  variable: '--font-inter',
  display: 'swap',
  fallback: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
  src: [
    { path: '../assets/fonts/inter-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: '../assets/fonts/inter-latin-500-normal.woff2', weight: '500', style: 'normal' },
    { path: '../assets/fonts/inter-latin-600-normal.woff2', weight: '600', style: 'normal' },
    { path: '../assets/fonts/inter-latin-700-normal.woff2', weight: '700', style: 'normal' },
  ],
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'BookishBae — Stories that stay with you',
    template: '%s · BookishBae',
  },
  description:
    'Quiet, unhurried fiction by Annu. DRM-free e-books delivered the moment you buy them.',
  applicationName: 'BookishBae',
  icons: {
    icon: {
      url: '/assets/Plum book and quill favicon-2.png',
      type: 'image/png',
      sizes: '1254x1254',
    },
  },
  authors: [{ name: 'Annu' }],
  creator: 'Annu',
  publisher: 'BookishBae',
  keywords: ['e-books', 'Annu', 'literary fiction', 'short stories', 'Indian authors'],
  openGraph: {
    type: 'website',
    siteName: 'BookishBae',
    title: 'BookishBae — Stories that stay with you',
    description:
      'Quiet, unhurried fiction by Annu. DRM-free e-books delivered the moment you buy them.',
    url: siteUrl,
    locale: 'en_IN',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'BookishBae — Stories that stay with you',
    description: 'Quiet, unhurried fiction by Annu.',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large' },
  },
  alternates: { canonical: '/' },
  formatDetection: { email: false, telephone: false, address: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fdf8f2' },
    { media: '(prefers-color-scheme: dark)', color: '#19131a' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" suppressHydrationWarning>
      <body className={cn(inter.variable, playfair.variable, 'font-sans min-h-dvh')}>
        {/* First stop for keyboard and screen-reader users. */}
        <a
          href="#main"
          className="sr-only-focusable fixed left-4 top-4 z-50 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-lift"
        >
          Skip to content
        </a>

        {children}

        <Toaster
          position="top-center"
          closeButton
          richColors
          toastOptions={{
            classNames: {
              toast: 'font-sans rounded-xl border-border shadow-lift',
              title: 'text-sm font-medium',
              description: 'text-sm text-muted-foreground',
            },
          }}
        />
      </body>
    </html>
  );
}
