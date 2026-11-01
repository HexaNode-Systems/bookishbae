'use client';

import { useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { AlertCircle, ArrowRight, Eye, EyeOff, LoaderCircle } from 'lucide-react';
import styles from './sign-in.module.css';

export interface SignInState {
  error: string | null;
}

function Fields({ error }: SignInState) {
  const { pending } = useFormStatus();
  const [showPassword, setShowPassword] = useState(false);

  return (
    <>
      <fieldset disabled={pending} className={styles.fields}>
        <div className={styles.field}>
          <label htmlFor="email">Email address</label>
          <input id="email" name="email" type="email" autoComplete="username" required
            autoCapitalize="none" spellCheck={false} maxLength={254} aria-describedby={error ? 'sign-in-error' : undefined} />
        </div>
        <div className={styles.field}>
          <label htmlFor="password">Password</label>
          <div className={styles.password}>
            <input id="password" name="password" type={showPassword ? 'text' : 'password'}
              autoComplete="current-password" required aria-describedby={error ? 'sign-in-error' : undefined} />
            <button type="button" className={styles.visibility} onClick={() => setShowPassword(value => !value)}
              aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} aria-controls="password">
              {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
            </button>
          </div>
        </div>
      </fieldset>
      {error && !pending && <p id="sign-in-error" className={styles.error} role="alert"><AlertCircle size={17} aria-hidden="true" /><span>{error}</span></p>}
      <button type="submit" className={styles.submit} disabled={pending} aria-busy={pending}>
        {pending ? <><LoaderCircle size={18} className={styles.spinner} aria-hidden="true" /> Signing in…</>
          : <>Sign in <ArrowRight size={17} aria-hidden="true" /></>}
      </button>
      <span className="sr-only" role="status">{pending ? 'Signing in and verifying admin access.' : ''}</span>
    </>
  );
}

export function SignInForm({ action }: {
  action: (previous: SignInState, formData: FormData) => Promise<SignInState>;
}) {
  const [state, formAction] = useFormState(action, { error: null });
  return <form action={formAction} className={styles.form}><Fields error={state.error} /></form>;
}
