import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, ShieldCheck } from 'lucide-react';

import { getAuth, normaliseEmail } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { SignInForm, type SignInState } from './sign-in-form';
import styles from './sign-in.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Admin sign in',
  robots: { index: false, follow: false },
  alternates: { canonical: '/sign-in' },
};

function adminDestination(next: string | string[] | undefined): string {
  if (typeof next !== 'string' || !/^\/admin(?:[/?#]|$)/.test(next) || /[\\\u0000-\u0020\u007f]/.test(next)) {
    return '/admin';
  }
  try {
    const url = new URL(next, 'https://bookishbae.invalid');
    if (url.origin !== 'https://bookishbae.invalid' ||
      !(url.pathname === '/admin' || url.pathname.startsWith('/admin/'))) return '/admin';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/admin';
  }
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: { next?: string | string[] };
}) {
  const destination = adminDestination(searchParams.next);
  const auth = await getAuth();
  if (auth.user && auth.isAdmin) redirect(destination);

  async function signIn(_previous: SignInState, formData: FormData): Promise<SignInState> {
    'use server';

    const emailValue = formData.get('email');
    const password = formData.get('password');
    if (typeof emailValue !== 'string' || typeof password !== 'string' ||
      !normaliseEmail(emailValue) || !password) {
      return { error: 'Enter your email address and password.' };
    }

    const supabase = createClient();
    let verifiedAdmin = false;
    let signedIn = false;
    let message = 'Could not sign in. Please check your connection and try again.';

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: normaliseEmail(emailValue),
        password,
      });
      if (error) {
        return { error: error.status === 429
          ? 'Too many sign-in attempts. Please wait a moment and try again.'
          : error.code === 'invalid_credentials'
            ? 'The email address or password is incorrect.'
            : 'Could not sign in. Check your credentials and try again.' };
      }
      signedIn = true;
      const verified = await getAuth();
      verifiedAdmin = !!verified.user && verified.isAdmin;
      message = 'This account does not have admin access.';
    } catch {
      message = 'Could not verify admin access. Please try again.';
    }

    if (verifiedAdmin) redirect(destination);

    if (signedIn) {
      try {
        const { error } = await supabase.auth.signOut({ scope: 'local' });
        if (error) return { error: `${message} Sign-out could not be completed. Please try again.` };
      } catch {
        return { error: `${message} Sign-out could not be completed. Please try again.` };
      }
    }
    return { error: message };
  }

  return (
    <main id="main" className={styles.page}>
      <div className={styles.content}>
        <Link href="/" className={styles.brand} aria-label="BookishBae home">
          <Image
            src="/assets/BookishBae logo on transparent background-1.png"
            alt="BookishBae — Stories by Annu"
            width={2172}
            height={724}
            sizes="220px"
            priority
          />
        </Link>
        <section className={styles.card} aria-labelledby="sign-in-heading">
          <span className={styles.badge}><ShieldCheck size={15} aria-hidden="true" /> Author workspace</span>
          <h1 id="sign-in-heading">Welcome back</h1>
          <p className={styles.intro}>Sign in to your BookishBae admin account.</p>
          <SignInForm action={signIn} />
          <p className={styles.note}>For authorized administrators only.</p>
        </section>
        <Link href="/" className={styles.back}><ArrowLeft size={15} aria-hidden="true" /> Back to the bookstore</Link>
      </div>
    </main>
  );
}
