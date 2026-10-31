'use client';

import { useState, type FormEvent } from 'react';
import Image from 'next/image';
import { LoaderCircle, Save, ShieldCheck, UserRound } from 'lucide-react';
import { allowedImageSource, type AdminIdentity } from './admin-types';

export function ProfilePanel({
  identity,
  onSaved,
  onDirtyChange,
}: {
  identity: AdminIdentity;
  onSaved: (identity: AdminIdentity) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [name, setName] = useState(identity.fullName);
  const [phone, setPhone] = useState(identity.phone);
  const [avatar, setAvatar] = useState(identity.avatarUrl);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const change = () => {
    onDirtyChange(true);
    setError('');
    setFieldErrors({});
  };
  const reset = () => {
    setName(identity.fullName);
    setPhone(identity.phone);
    setAvatar(identity.avatarUrl);
    setAvatarFailed(false);
    setFieldErrors({});
    setError('');
    onDirtyChange(false);
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const errors: Record<string, string> = {};
    if (!name.trim()) errors.name = 'Enter your full name.';
    if (
      phone.trim() &&
      (!/^\+?[\d\s().-]{7,30}$/.test(phone.trim()) ||
        phone.replace(/\D/g, '').length < 7)
    )
      errors.phone = 'Enter a valid phone number, or leave it blank.';
    if (avatar.trim() && (!allowedImageSource(avatar.trim()) || avatarFailed))
      errors.avatar =
        'Use a working image path or a URL from a configured image provider.';
    setFieldErrors(errors);
    if (Object.keys(errors).length) {
      document.getElementById(`profile-${Object.keys(errors)[0]}`)?.focus();
      return;
    }
    setSaving(true);
    setError('');
    const updated = {
      ...identity,
      fullName: name.trim(),
      phone: phone.trim(),
      avatarUrl: avatar.trim(),
    };
    try {
      if (!identity.preview && identity.id) {
        const { createClient } = await import('@/lib/supabase/client');
        // Use the existing RLS-scoped client and only columns already granted for profile updates.
        const { data, error: saveError } = await createClient()
          .schema('public')
          .from('profiles')
          .update({
            full_name: updated.fullName,
            phone: updated.phone || null,
            avatar_url: updated.avatarUrl || null,
          })
          .eq('id', identity.id)
          .select('id, full_name, phone, avatar_url')
          .single();
        if (saveError || !data) throw new Error('Profile save failed');
        updated.fullName = data.full_name ?? '';
        updated.phone = data.phone ?? '';
        updated.avatarUrl = data.avatar_url ?? '';
      }
      setName(updated.fullName);
      setPhone(updated.phone);
      setAvatar(updated.avatarUrl);
      onSaved(updated);
    } catch {
      setError(
        'Your profile could not be saved. Check your connection and account permissions, then try again.',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="admin-profile-layout">
      <form
        className="admin-panel admin-form-panel"
        onSubmit={submit}
        noValidate
        aria-busy={saving}
      >
        <div className="admin-form-section-title">
          <UserRound size={19} aria-hidden="true" />
          <div>
            <h2>Profile details</h2>
            <p>
              {identity.preview
                ? 'No authenticated profile is available in this development preview.'
                : 'Update the details on your existing account.'}
            </p>
          </div>
        </div>
        {identity.preview && (
          <div className="admin-inline-note">
            Preview only. Profile edits stay in this workspace and reset on
            reload.
          </div>
        )}
        <div className="admin-field">
          <label htmlFor="profile-name">
            Full name <span>Required</span>
          </label>
          <input
            id="profile-name"
            autoComplete="name"
            value={name}
            maxLength={80}
            required
            onChange={(event) => {
              setName(event.target.value);
              change();
            }}
            aria-invalid={!!fieldErrors.name}
            aria-describedby={
              fieldErrors.name ? 'profile-name-error' : undefined
            }
            disabled={saving}
          />
          {fieldErrors.name && (
            <p className="admin-field-error" id="profile-name-error">
              {fieldErrors.name}
            </p>
          )}
        </div>
        <div className="admin-field">
          <label htmlFor="profile-email">Email address</label>
          <input
            id="profile-email"
            type="email"
            value={identity.email ?? ''}
            placeholder="No authenticated email in preview"
            readOnly
            disabled
            aria-describedby="profile-email-help"
          />
          <p className="admin-field-help" id="profile-email-help">
            Account email changes are managed by your existing sign-in provider.
          </p>
        </div>
        <div className="admin-field">
          <label htmlFor="profile-phone">
            Phone number <span>Optional</span>
          </label>
          <input
            id="profile-phone"
            type="tel"
            autoComplete="tel"
            value={phone}
            maxLength={30}
            onChange={(event) => {
              setPhone(event.target.value);
              change();
            }}
            aria-invalid={!!fieldErrors.phone}
            aria-describedby={
              fieldErrors.phone ? 'profile-phone-error' : undefined
            }
            disabled={saving}
          />
          {fieldErrors.phone && (
            <p className="admin-field-error" id="profile-phone-error">
              {fieldErrors.phone}
            </p>
          )}
        </div>
        <div className="admin-field">
          <label htmlFor="profile-avatar">
            Profile image path <span>Optional</span>
          </label>
          <input
            id="profile-avatar"
            value={avatar}
            maxLength={500}
            onChange={(event) => {
              setAvatar(event.target.value);
              setAvatarFailed(false);
              change();
            }}
            aria-invalid={!!fieldErrors.avatar}
            aria-describedby="profile-avatar-help"
            placeholder="Existing image path or supported HTTPS URL"
            disabled={saving}
          />
          <p
            className={
              fieldErrors.avatar ? 'admin-field-error' : 'admin-field-help'
            }
            id="profile-avatar-help"
          >
            {fieldErrors.avatar ||
              'Use an image from a configured image provider or an existing local path.'}
          </p>
        </div>
        {error && (
          <p className="admin-form-summary" role="alert">
            {error}
          </p>
        )}
        <div className="admin-profile-actions">
          <button
            className="admin-button admin-button-secondary"
            type="button"
            onClick={reset}
            disabled={saving}
          >
            Cancel changes
          </button>
          <button className="admin-button" type="submit" disabled={saving}>
            {saving ? (
              <LoaderCircle
                size={16}
                className="admin-spin"
                aria-hidden="true"
              />
            ) : (
              <Save size={16} aria-hidden="true" />
            )}
            {saving
              ? 'Saving…'
              : identity.preview
                ? 'Save profile draft'
                : 'Save profile'}
          </button>
        </div>
      </form>
      <aside className="admin-panel admin-profile-card">
        <span className="admin-large-avatar">
          {avatar && allowedImageSource(avatar) && !avatarFailed ? (
            <Image
              src={avatar}
              alt="Your profile preview"
              fill
              sizes="80px"
              unoptimized
              onError={() => setAvatarFailed(true)}
            />
          ) : (
            <UserRound size={33} aria-hidden="true" />
          )}
        </span>
        <h2>{name.trim() || 'Your profile'}</h2>
        <p>{identity.email || 'No authenticated account in preview'}</p>
        <span className="admin-badge">
          {identity.preview ? 'Development preview' : 'Administrator'}
        </span>
        <div className="admin-profile-permissions">
          <ShieldCheck size={19} aria-hidden="true" />
          <p>
            Your account role, email, authentication, and access permissions are
            not editable here.
          </p>
        </div>
      </aside>
    </div>
  );
}
