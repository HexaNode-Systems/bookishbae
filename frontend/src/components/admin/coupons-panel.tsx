'use client';

import { useEffect, useState, type FormEvent } from 'react';
import type { Coupon } from '@/types/database';
import type { CatalogueBook } from './admin-types';
import { adminRequest } from './categories-panel';

type ManagedCoupon = Coupon & { product_ids: string[] };
type Values = { code: string; discountType: 'percent' | 'flat'; value: string; startsAt: string; expiresAt: string; usageLimit: string; usageLimitPerUser: string; maxDiscount: string; minimum: string; productIds: string[]; isActive: boolean };
const empty: Values = { code: '', discountType: 'percent', value: '', startsAt: '', expiresAt: '', usageLimit: '', usageLimitPerUser: '', maxDiscount: '', minimum: '', productIds: [], isActive: true };
function localDate(value: string | null) { if (!value) return ''; const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
function fromCoupon(coupon: ManagedCoupon): Values { return { code: coupon.code, discountType: coupon.discount_type, value: String(coupon.discount_type === 'flat' ? coupon.discount_value / 100 : coupon.discount_value), startsAt: localDate(coupon.starts_at), expiresAt: localDate(coupon.expires_at), usageLimit: coupon.usage_limit == null ? '' : String(coupon.usage_limit), usageLimitPerUser: coupon.usage_limit_per_user == null ? '' : String(coupon.usage_limit_per_user), maxDiscount: coupon.max_discount_paise == null ? '' : String(coupon.max_discount_paise / 100), minimum: String(coupon.min_order_paise / 100), productIds: coupon.product_ids, isActive: coupon.is_active }; }
function payload(values: Values) { return { code: values.code, discountType: values.discountType, discountValue: values.discountType === 'flat' ? Math.round(Number(values.value) * 100) : Number(values.value), startsAt: values.startsAt ? new Date(values.startsAt).toISOString() : undefined, expiresAt: values.expiresAt ? new Date(values.expiresAt).toISOString() : null, usageLimit: values.usageLimit ? Number(values.usageLimit) : null, usageLimitPerUser: values.usageLimitPerUser ? Number(values.usageLimitPerUser) : null, maxDiscountPaise: values.maxDiscount ? Math.round(Number(values.maxDiscount) * 100) : null, minOrderPaise: Math.round(Number(values.minimum || 0) * 100), productIds: values.productIds, isActive: values.isActive }; }

export function CouponsPanel({ books }: { books: CatalogueBook[] }) {
  const [coupons, setCoupons] = useState<ManagedCoupon[]>([]);
  const [values, setValues] = useState<Values>(empty);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const change = <K extends keyof Values>(key: K, value: Values[K]) => setValues(previous => ({ ...previous, [key]: value }));
  const load = async () => { try { setCoupons((await adminRequest('/api/admin/coupons')).coupons); } catch (error) { setError((error as Error).message); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, []);
  const mutate = async (action: () => Promise<unknown>) => { setBusy(true); setError(''); try { await action(); await load(); } catch (error) { setError((error as Error).message); } finally { setBusy(false); } };
  const save = (event: FormEvent) => { event.preventDefault(); void mutate(async () => { await adminRequest(`/api/admin/coupons${editing ? `/${editing}` : ''}`, editing ? 'PATCH' : 'POST', payload(values)); setEditing(null); setValues(empty); }); };
  return <div className="admin-editor-main">
    {error && <p role="alert" className="admin-form-summary">{error}</p>}
    <form className="admin-panel admin-form-panel" onSubmit={save}>
      <h2>{editing ? 'Edit coupon' : 'Create coupon'}</h2>
      <p className="admin-section-description">Discounts and eligibility are checked again at checkout. Uses are recorded after verified payment.</p>
      <div className="admin-form-grid">
        <div className="admin-field"><label htmlFor="coupon-code">Code</label><input id="coupon-code" required minLength={2} maxLength={32} pattern="[A-Za-z0-9][A-Za-z0-9_-]+" value={values.code} onChange={e => change('code', e.target.value.toUpperCase())} /></div>
        <div className="admin-field"><label htmlFor="coupon-type">Discount type</label><select id="coupon-type" value={values.discountType} onChange={e => change('discountType', e.target.value as Values['discountType'])}><option value="percent">Percentage</option><option value="flat">Fixed amount (₹)</option></select></div>
        <div className="admin-field"><label htmlFor="coupon-value">{values.discountType === 'percent' ? 'Discount (%)' : 'Discount (₹)'}</label><input id="coupon-value" type="number" required min={values.discountType === 'percent' ? 1 : 0.01} max={values.discountType === 'percent' ? 100 : 500000} step={values.discountType === 'percent' ? 1 : 0.01} value={values.value} onChange={e => change('value', e.target.value)} /></div>
        <div className="admin-field"><label htmlFor="coupon-max">Maximum discount (₹, optional)</label><input id="coupon-max" type="number" min={0} step="0.01" value={values.maxDiscount} onChange={e => change('maxDiscount', e.target.value)} /></div>
        <div className="admin-field"><label htmlFor="coupon-minimum">Minimum order (₹)</label><input id="coupon-minimum" type="number" min={0} step="0.01" value={values.minimum} onChange={e => change('minimum', e.target.value)} /></div>
        <div className="admin-field"><label htmlFor="coupon-uses">Usage limit (optional)</label><input id="coupon-uses" type="number" min={1} step={1} value={values.usageLimit} onChange={e => change('usageLimit', e.target.value)} /></div>
        <div className="admin-field"><label htmlFor="coupon-user-limit">Uses per customer (optional)</label><input id="coupon-user-limit" type="number" min={1} max={100} step={1} value={values.usageLimitPerUser} onChange={e => change('usageLimitPerUser', e.target.value)} /></div>
        <div className="admin-field"><label htmlFor="coupon-start">Valid from (optional)</label><input id="coupon-start" type="datetime-local" value={values.startsAt} onChange={e => change('startsAt', e.target.value)} /></div>
        <div className="admin-field"><label htmlFor="coupon-expiry">Expires at (optional)</label><input id="coupon-expiry" type="datetime-local" value={values.expiresAt} onChange={e => change('expiresAt', e.target.value)} /></div>
      </div>
      <div className="admin-field"><label htmlFor="coupon-books">Applicable books</label><select id="coupon-books" multiple value={values.productIds} onChange={e => change('productIds', Array.from(e.target.selectedOptions, option => option.value))}>{books.filter(book => book.id).map(book => <option key={book.id} value={book.id}>{book.title}</option>)}</select><p className="admin-field-help">No selection applies to all books. Select one or several books to restrict eligibility.</p><button type="button" className="admin-text-button" onClick={() => change('productIds', [])}>Apply to all books</button></div>
      <label className="admin-checkbox"><input type="checkbox" checked={values.isActive} onChange={e => change('isActive', e.target.checked)} /> Enabled</label>
      <div className="admin-profile-actions"><button className="admin-button" disabled={busy}>{busy ? 'Saving…' : 'Save coupon'}</button>{editing && <button type="button" className="admin-button admin-button-secondary" onClick={() => { setEditing(null); setValues(empty); }}>Cancel</button>}</div>
    </form>
    <section className="admin-panel"><div className="admin-panel-heading"><h2>Your coupons</h2></div>{loading ? <p className="admin-form-panel" role="status">Loading coupons…</p> : !coupons.length ? <p className="admin-form-panel">{error ? 'Coupons could not be loaded.' : 'No coupons yet.'}</p> : coupons.map(coupon => <div className="admin-filter-summary" key={coupon.id}>
      <span><strong>{coupon.code.toUpperCase()}</strong> · {coupon.discount_type === 'percent' ? `${coupon.discount_value}%` : `₹${coupon.discount_value / 100}`} · {coupon.is_active ? 'Enabled' : 'Disabled'} · {coupon.times_used} uses</span>
      <div className="admin-profile-actions"><button className="admin-text-button" disabled={busy} onClick={() => { setEditing(coupon.id); setValues(fromCoupon(coupon)); }}>Edit</button>
        <button className="admin-text-button" disabled={busy} onClick={() => void mutate(() => adminRequest(`/api/admin/coupons/${coupon.id}`, 'PATCH', { isActive: !coupon.is_active }))}>{coupon.is_active ? 'Disable' : 'Enable'}</button>
        <button className="admin-text-button" disabled={busy} onClick={() => { if (confirm(`Delete coupon “${coupon.code}”? Coupons with order history can be disabled instead.`)) void mutate(() => adminRequest(`/api/admin/coupons/${coupon.id}`, 'DELETE')); }}>Delete</button></div>
    </div>)}</section>
  </div>;
}
