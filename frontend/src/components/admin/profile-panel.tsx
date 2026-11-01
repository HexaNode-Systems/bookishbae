'use client';

import React, { useEffect, useRef, useState, type FormEvent } from 'react';
import Image from 'next/image';
import { LoaderCircle, Save, ShieldCheck, Trash2, UserRound } from 'lucide-react';
import { allowedImageSource, type AdminIdentity } from './admin-types';
import { adminProfileSchema, profilePhotoError, uploadProfilePhoto, saveAdminProfile, PROFILE_PHOTO_TYPES } from '@/lib/admin-profile';

export function ProfilePanel({ identity, onSaved, onDirtyChange, onSavingChange }: {
  identity: AdminIdentity;
  onSaved: (identity: AdminIdentity) => void;
  onDirtyChange: (dirty: boolean) => void;
  onSavingChange?: (saving: boolean) => void;
}) {
  const [name, setName] = useState(identity.fullName);
  const [phone, setPhone] = useState(identity.phone);
  const [avatar, setAvatar] = useState(identity.avatarUrl);
  const [preview, setPreview] = useState('');
  const [photoName, setPhotoName] = useState('');
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const input = useRef<HTMLInputElement>(null);
  const selectedFile = useRef<File | null>(null);
  const uploadController = useRef<AbortController | null>(null);
  const uploadVersion = useRef(0);
  const mounted = useRef(true);
  const editable = identity.authenticated && !identity.preview && !!identity.id;
  const dirty = name !== identity.fullName || phone !== identity.phone || avatar !== identity.avatarUrl || !!preview || uploading;

  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; uploadController.current?.abort(); };
  }, []);

  const clearFeedback = () => { setError(''); setFieldErrors({}); };
  const clearPhotoSelection = () => {
    uploadVersion.current++;
    uploadController.current?.abort();
    uploadController.current = null;
    selectedFile.current = null;
    setUploading(false);
    setPreview('');
    setPhotoName('');
    setUploadError('');
    setAvatarFailed(false);
    if (input.current) input.current.value = '';
  };
  const reset = () => {
    clearPhotoSelection();
    setName(identity.fullName);
    setPhone(identity.phone);
    setAvatar(identity.avatarUrl);
    clearFeedback();
  };
  const upload = async (file: File) => {
    clearFeedback();
    setUploadError('');
    const problem = profilePhotoError(file);
    if (problem) { setUploadError(problem); return; }
    uploadController.current?.abort();
    const version = ++uploadVersion.current;
    const controller = new AbortController();
    uploadController.current = controller;
    selectedFile.current = file;
    setPhotoName(file.name);
    setPreview(URL.createObjectURL(file));
    setAvatarFailed(false);
    setUploading(true);
    try {
      const url = await uploadProfilePhoto(file, controller.signal);
      if (mounted.current && version === uploadVersion.current) setAvatar(url);
    } catch (failure) {
      if (mounted.current && version === uploadVersion.current) {
        setUploadError(failure instanceof Error ? failure.message : 'Your photo could not be uploaded. Please try again.');
      }
    } finally {
      if (mounted.current && version === uploadVersion.current) {
        uploadController.current = null;
        setUploading(false);
      }
    }
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editable || uploading || saving || uploadError) return;
    const parsed = adminProfileSchema.safeParse({ fullName: name, phone, avatarUrl: avatar });
    const errors: Record<string, string> = {};
    if (!parsed.success) for (const issue of parsed.error.issues) {
      const key = issue.path[0] === 'fullName' ? 'name' : issue.path[0] === 'avatarUrl' ? 'avatar' : 'phone';
      errors[key] ??= issue.message;
    }
    if (avatarFailed) errors.avatar = 'This photo could not be displayed. Choose another image or remove it.';
    setFieldErrors(errors);
    if (Object.keys(errors).length) { document.getElementById(`profile-${Object.keys(errors)[0]}`)?.focus(); return; }
    setSaving(true);
    onSavingChange?.(true);
    setError('');
    try {
      const data = await saveAdminProfile({ fullName: name, phone, avatarUrl: avatar });
      if (!mounted.current) return;
      if (data.id !== identity.id) throw new Error('Your profile save could not be confirmed. Please try again.');
      const updated = { ...identity, fullName: data.full_name, phone: data.phone ?? '', avatarUrl: data.avatar_url ?? '' };
      clearPhotoSelection();
      setName(updated.fullName);
      setPhone(updated.phone);
      setAvatar(updated.avatarUrl);
      onSaved(updated);
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : 'Your profile could not be saved. Please try again.');
    } finally {
      if (mounted.current) { setSaving(false); onSavingChange?.(false); }
    }
  };
  const photo = preview || avatar;

  return (
    <div className="admin-profile-layout">
      <form className="admin-panel admin-form-panel" onSubmit={submit} noValidate aria-busy={saving || uploading}>
        <div className="admin-form-section-title">
          <UserRound size={19} aria-hidden="true" />
          <div><h2>Profile details</h2><p>Update the details on your existing account.</p></div>
        </div>
        {!editable && <p className="admin-inline-note">Sign in with an admin account to update your profile.</p>}
        <div className="admin-field">
          <label htmlFor="profile-name">Full name <span>Required</span></label>
          <input id="profile-name" autoComplete="name" value={name} maxLength={80} required
            onChange={event => { setName(event.target.value); clearFeedback(); }}
            aria-invalid={!!fieldErrors.name} aria-describedby={fieldErrors.name ? 'profile-name-error' : undefined} disabled={saving || !editable} />
          {fieldErrors.name && <p className="admin-field-error" id="profile-name-error">{fieldErrors.name}</p>}
        </div>
        <div className="admin-field">
          <label htmlFor="profile-email">Email address</label>
          <input id="profile-email" type="email" value={identity.email ?? ''} readOnly disabled aria-describedby="profile-email-help" />
          <p className="admin-field-help" id="profile-email-help">Account email changes are managed by your existing sign-in provider.</p>
        </div>
        <div className="admin-field">
          <label htmlFor="profile-phone">Phone number <span>Optional</span></label>
          <input id="profile-phone" type="tel" autoComplete="tel" value={phone} maxLength={30}
            onChange={event => { setPhone(event.target.value); clearFeedback(); }}
            aria-invalid={!!fieldErrors.phone} aria-describedby={fieldErrors.phone ? 'profile-phone-error' : undefined} disabled={saving || !editable} />
          {fieldErrors.phone && <p className="admin-field-error" id="profile-phone-error">{fieldErrors.phone}</p>}
        </div>
        <div className="admin-field">
          <label htmlFor="profile-avatar">Profile photo <span>Optional</span></label>
          <input ref={input} id="profile-avatar" type="file" accept={PROFILE_PHOTO_TYPES.join(',')}
            disabled={saving || uploading || !editable} aria-invalid={!!(uploadError || fieldErrors.avatar)} aria-describedby="profile-avatar-help"
            onChange={event => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (file) void upload(file);
            }} />
          <p className="admin-field-help" id="profile-avatar-help">JPG, PNG, WEBP or AVIF, up to 5 MB. Choose another file to replace your photo, then save your profile.</p>
          {uploading && <p className="admin-selected-file" role="status"><LoaderCircle size={15} className="admin-spin" aria-hidden="true" />Uploading photo…</p>}
          {photoName && !uploading && !uploadError && <p className="admin-selected-file">{photoName} — ready to save</p>}
          {(uploadError || fieldErrors.avatar) && <p className="admin-field-error" role="alert">{uploadError || fieldErrors.avatar}</p>}
          <div className="admin-photo-actions">
            {uploadError && selectedFile.current && <button type="button" className="admin-text-button" disabled={saving || uploading}
              onClick={() => { if (selectedFile.current) void upload(selectedFile.current); }}>Retry photo upload</button>}
            {(photo || photoName) && <button type="button" className="admin-text-button" disabled={saving || !editable}
              onClick={() => { clearPhotoSelection(); setAvatar(''); clearFeedback(); }}><Trash2 size={14} aria-hidden="true" />Remove photo</button>}
          </div>
        </div>
        {error && <p className="admin-form-summary" role="alert">{error}</p>}
        <div className="admin-profile-actions">
          <button className="admin-button admin-button-secondary" type="button" onClick={reset} disabled={saving}>Cancel changes</button>
          <button className="admin-button" type="submit" disabled={saving || uploading || !!uploadError || !editable || !dirty}>
            {saving ? <LoaderCircle size={16} className="admin-spin" aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}
            {saving ? 'Saving…' : 'Save profile'}
          </button>
        </div>
      </form>
      <aside className="admin-panel admin-profile-card">
        <span className="admin-large-avatar">
          {photo && allowedImageSource(photo) && !avatarFailed ? <Image src={photo} alt="Your profile preview" fill sizes="80px" unoptimized
            onError={() => { setAvatarFailed(true); setFieldErrors(current => ({ ...current, avatar: 'This photo could not be displayed. Choose another image or remove it.' })); }} />
            : <UserRound size={33} aria-hidden="true" />}
        </span>
        <h2>{name.trim() || 'Your profile'}</h2>
        <p>{identity.email}</p>
        {phone && <p>{phone}</p>}
        <span className="admin-badge">Administrator</span>
        <div className="admin-profile-permissions"><ShieldCheck size={19} aria-hidden="true" />
          <p>Your account role, email, password, and access permissions are not editable here.</p>
        </div>
      </aside>
    </div>
  );
}
