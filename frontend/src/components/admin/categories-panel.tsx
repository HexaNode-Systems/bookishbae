'use client';

import { useEffect, useState, type FormEvent } from 'react';
import type { Category } from '@/types/database';
import { safeReadApiResponse } from './admin-types';

export async function adminRequest(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(path, { method, headers: { 'x-dev-admin': 'true', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = await safeReadApiResponse(response);
  if (!result.ok) throw new Error(result.error || 'The operation failed. Please retry.');
  return result.data;
}

export function CategoriesPanel() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [sortOrder, setSortOrder] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const load = async () => { try { const data = await adminRequest('/api/admin/categories'); setCategories(data.categories); } catch (error) { setError((error as Error).message); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, []);
  const reset = () => { setEditing(null); setName(''); setSlug(''); setDescription(''); setSortOrder(0); };
  const save = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await adminRequest(`/api/admin/categories${editing ? `/${editing}` : ''}`, editing ? 'PATCH' : 'POST', { name, slug, description, sortOrder });
      reset(); await load();
    } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  };
  const remove = async (category: Category) => {
    if (!confirm(`Delete category “${category.name}”? Categories used by books must be reassigned first.`)) return;
    setBusy(true); setError('');
    try { await adminRequest(`/api/admin/categories/${category.id}`, 'DELETE'); if (editing === category.id) reset(); await load(); }
    catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  };
  return <div className="admin-editor-main">
    {error && <p className="admin-form-summary" role="alert">{error}</p>}
    <form className="admin-panel admin-form-panel" onSubmit={save}>
      <h2>{editing ? 'Edit category' : 'Create category'}</h2>
      <p className="admin-section-description">Categories belong to your catalogue. Reassign books before deleting a category.</p>
      <div className="admin-form-grid">
        <div className="admin-field"><label htmlFor="category-name">Name</label><input id="category-name" required maxLength={100} value={name} onChange={e => { const value = e.target.value; setName(value); if (!editing) setSlug(value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')); }} /></div>
        <div className="admin-field"><label htmlFor="category-slug">Slug</label><input id="category-slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={80} value={slug} onChange={e => setSlug(e.target.value)} /></div>
      </div>
      <div className="admin-field"><label htmlFor="category-description">Description</label><textarea id="category-description" maxLength={500} value={description} onChange={e => setDescription(e.target.value)} /></div>
      <div className="admin-field"><label htmlFor="category-order">Display order</label><input id="category-order" type="number" min={0} max={10000} value={sortOrder} onChange={e => setSortOrder(Number(e.target.value))} /></div>
      <div className="admin-profile-actions"><button className="admin-button" disabled={busy}>{busy ? 'Saving…' : 'Save category'}</button>{editing && <button type="button" className="admin-button admin-button-secondary" onClick={reset}>Cancel</button>}</div>
    </form>
    <section className="admin-panel"><div className="admin-panel-heading"><h2>Your categories</h2></div>
      {loading ? <p className="admin-form-panel" role="status">Loading categories…</p> : !categories.length ? <p className="admin-form-panel">No categories yet. Create your first category above.</p> : categories.map(category => <div className="admin-filter-summary" key={category.id}>
        <span>{category.name} <small>/{category.slug}</small></span><div className="admin-profile-actions">
          <button className="admin-text-button" disabled={busy} onClick={() => { setEditing(category.id); setName(category.name); setSlug(category.slug); setDescription(category.description || ''); setSortOrder(category.sort_order); }}>Edit</button>
          <button className="admin-text-button" disabled={busy} onClick={() => void remove(category)}>Delete</button></div>
      </div>)}
    </section>
  </div>;
}
