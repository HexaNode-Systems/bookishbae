'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  CircleHelp,
  CreditCard,
  Eye,
  EyeOff,
  FilePenLine,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  ShoppingBag,
  Tags,
  FolderTree,
  Trash2,
  UserRound,
  X,
} from 'lucide-react';
import { CouponsPanel } from './coupons-panel';
import { CategoriesPanel } from './categories-panel';
import { BookCover } from '@/components/book-cover';
import { productCover } from '@/lib/product-book';
import { BookEditor } from './book-editor';
import { OrdersPanel } from './orders-panel';
import { ProfilePanel } from './profile-panel';
import {
  currency,
  allowedImageSource,
  safeReadApiResponse,
  type AdminIdentity,
  type AdminSection,
  type CatalogueBook,
  type Notice,
} from './admin-types';

const sections = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'catalogue', label: 'Catalogue', icon: BookOpen },
  { id: 'orders', label: 'Orders & Deliveries', icon: ShoppingBag },
  { id: 'coupons', label: 'Coupons', icon: Tags },
  { id: 'categories', label: 'Categories', icon: FolderTree },
] as const;

interface DashboardStats {
  catalogueTitles: number;
  workspaceDrafts: number;
  revenuePaise: number;
  orderCount: number;
  recentOrders: any[];
}

function AdminCoverThumb({
  src,
  alt,
  sizes = '52px',
}: {
  src: string;
  alt: string;
  sizes?: string;
}) {
  return <BookCover src={src} alt={alt} sizes={sizes} />;
}

export function AdminWorkspace({
  initialIdentity,
}: {
  initialIdentity: AdminIdentity;
}) {
  const [active, setActive] = useState<AdminSection>('dashboard');
  const [identity, setIdentity] = useState(initialIdentity);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [books, setBooks] = useState<CatalogueBook[]>([]);
  const [editing, setEditing] = useState<CatalogueBook | 'new' | null>(null);
  const [catalogueQuery, setCatalogueQuery] = useState('');
  const [notice, setNotice] = useState<Notice>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const profileDirtyChange = useCallback((value: boolean) => {
    setDirty(value);
    if (value) setNotice(current => current?.kind === 'success' ? null : current);
  }, []);
  const [pendingSection, setPendingSection] = useState<AdminSection | null>(
    null,
  );
  const profileSavingChange = useCallback((value: boolean) => {
    setProfileSaving(value);
    if (value) setPendingSection(null);
  }, []);
  const [loadingCatalogue, setLoadingCatalogue] = useState(false);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  const heading = useRef<HTMLHeadingElement>(null);
  const objectUrls = useRef<string[]>([]);

  const loadBooks = useCallback(async () => {
    setLoadingCatalogue(true);
    try {
      const res = await fetch('/api/admin/products?limit=100', {
        headers: { 'x-dev-admin': 'true' },
      });
      const { ok, data, error } = await safeReadApiResponse(res);
      if (ok && Array.isArray(data?.products)) {
        let page = 1;
        while (data.products.length < data.total) {
          const more = await safeReadApiResponse(await fetch(`/api/admin/products?limit=100&page=${++page}`, { headers: { 'x-dev-admin': 'true' } }));
          if (!more.ok || !Array.isArray(more.data?.products) || !more.data.products.length) throw new Error(more.error || 'The complete catalogue could not be loaded.');
          data.products.push(...more.data.products);
        }
        const mapped: CatalogueBook[] = data.products.map((p: any) => {
          const sellingPaise = p.discount_price_paise ?? p.price_paise;
          const originalPaise = p.discount_price_paise != null ? p.price_paise : undefined;

          return {
            id: p.id,
            slug: p.slug,
            title: p.title,
            subtitle: p.subtitle ?? '',
            description: p.description ?? '',
            excerpt: p.excerpt ?? '',
            categorySlug:
              p.category_slug ?? '',
            category: p.category || 'Uncategorized',
            categoryId: p.category_id ?? null,
            sampleText: p.sample_preview ?? [],
            priceRupees: sellingPaise / 100,
            originalPriceRupees: originalPaise
              ? originalPaise / 100
              : undefined,
            coverImage: productCover(p),
            coverKey: p.cover_key,
            mainPdfKey: p.main_pdf_key,
            mainPdfBytes: p.main_pdf_bytes,
            samplePdfKey: p.sample_pdf_key,
            samplePdfUrl: p.sample_pdf_url || '',
            pageCount: p.page_count ?? 0,
            publishedDate: p.published_at
              ? new Date(p.published_at).toLocaleDateString()
              : '',
            isFeatured: p.is_featured ?? false,
            status: p.status || 'draft',
            workspaceDraft: false,
          };
        });
        setBooks(mapped);
      }
      else throw new Error(error || 'The catalogue could not be loaded.');
    } catch (error) {
      setNotice({ kind: 'error', text: (error as Error).message });
    } finally {
      setLoadingCatalogue(false);
    }
  }, []);

  const loadStats = useCallback(async () => {
    setLoadingStats(true);
    try {
      const res = await fetch('/api/admin/stats', {
        headers: { 'x-dev-admin': 'true' },
      });
      const { ok, data } = await safeReadApiResponse(res);
      if (ok && data) {
        setStats(data);
      }
    } catch {
      // Ignored
    } finally {
      setLoadingStats(false);
    }
  }, []);

  useEffect(() => {
    loadBooks();
    loadStats();
  }, [loadBooks, loadStats]);

  const drafts = books.filter((book) => book.status === 'draft').length;
  const visibleBooks = books.filter((book) =>
    `${book.title} ${book.slug} ${book.category} ${book.status}`
      .toLowerCase()
      .includes(catalogueQuery.trim().toLowerCase()),
  );
  const currentLabel =
    active === 'profile'
      ? 'Your profile'
      : (sections.find((section) => section.id === active)?.label ??
        'Dashboard');

  useEffect(
    () => () => objectUrls.current.forEach((url) => URL.revokeObjectURL(url)),
    [],
  );
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [active, editing]);
  useEffect(() => setAvatarFailed(false), [identity.avatarUrl]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);

  const navigate = (section: AdminSection) => {
    if (section === active && !editing) return;
    if (profileSaving) {
      setNotice({ kind: 'error', text: 'Please wait for your profile to finish saving.' });
      return;
    }
    if (dirty) {
      setPendingSection(section);
      return;
    }
    setActive(section);
    setEditing(null);
    setNotice(null);
    setPendingSection(null);
    if (section === 'dashboard') loadStats();
    if (section === 'catalogue') loadBooks();
  };

  const startEditor = (book: CatalogueBook | 'new') => {
    setActive('catalogue');
    setEditing(book);
    setNotice(null);
    setDirty(false);
  };

  const saveBook = async (book: CatalogueBook) => {
    const isNew = editing === 'new' || !book.id;

    let pricePaise: number;
    let discountPricePaise: number | null = null;
    if (
      book.originalPriceRupees &&
      book.originalPriceRupees > book.priceRupees
    ) {
      pricePaise = Math.round(book.originalPriceRupees * 100);
      discountPricePaise = Math.round(book.priceRupees * 100);
    } else {
      pricePaise = Math.round(book.priceRupees * 100);
      discountPricePaise = null;
    }

    const payload = {
      title: book.title,
      slug: book.slug,
      subtitle: book.subtitle || null,
      excerpt: book.excerpt || null,
      description: book.description,
      categoryId: book.categoryId || null,
      samplePreview: book.sampleText,
      pricePaise,
      discountPricePaise,
      coverKey: book.coverKey || null,
      samplePdfKey: book.samplePdfKey || null,
      mainPdfKey: book.mainPdfKey || null,
      mainPdfBytes: book.mainPdfBytes || null,
      pageCount: book.pageCount,
      status: book.status || 'draft',
      isFeatured: Boolean(book.isFeatured),
    };

    const url = isNew
      ? '/api/admin/products'
      : `/api/admin/products/${book.id}`;
    const method = isNew ? 'POST' : 'PATCH';

    try {
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'x-dev-admin': 'true',
        },
        body: JSON.stringify(payload),
      });

      const { ok, error } = await safeReadApiResponse(res);
      if (!ok) {
        throw new Error(error || 'Failed to save book to backend database.');
      }

      setNotice({
        kind: 'success',
        text: isNew
          ? `"${book.title}" created successfully and saved to the database.`
          : `"${book.title}" updated successfully in the database.`,
      });
      setEditing(null);
      setDirty(false);
      await loadBooks();
      await loadStats();
    } catch (err: any) {
      setNotice({
        kind: 'error',
        text: err.message || 'Could not save book. Please try again.',
      });
      throw err;
    }
  };

  const toggleStatus = async (book: CatalogueBook) => {
    if (!book.id) return;
    const newStatus = book.status === 'published' ? 'draft' : 'published';
    setActionInProgress(book.id);
    try {
      const res = await fetch(`/api/admin/products/${book.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-dev-admin': 'true',
        },
        body: JSON.stringify({ status: newStatus }),
      });
      const { ok, error } = await safeReadApiResponse(res);
      if (!ok) {
        throw new Error(error || 'Status toggle failed.');
      }
      setNotice({
        kind: 'success',
        text: `"${book.title}" is now ${newStatus === 'published' ? 'published to storefront' : 'saved as draft'}.`,
      });
      await loadBooks();
    } catch (err: any) {
      setNotice({
        kind: 'error',
        text: err.message || 'Could not change publication status.',
      });
    } finally {
      setActionInProgress(null);
    }
  };

  const deleteBook = async (book: CatalogueBook) => {
    if (!book.id) return;
    if (
      !confirm(
        `Are you sure you want to delete "${book.title}"? This will remove it from the database.`,
      )
    ) {
      return;
    }

    setActionInProgress(book.id);
    try {
      const res = await fetch(`/api/admin/products/${book.id}`, {
        method: 'DELETE',
        headers: { 'x-dev-admin': 'true' },
      });
      const { ok, error } = await safeReadApiResponse(res);
      if (!ok) {
        throw new Error(error || 'Failed to delete book from database.');
      }
      setNotice({
        kind: 'success',
        text: `"${book.title}" removed from catalogue and database.`,
      });
      await loadBooks();
      await loadStats();
    } catch (err: any) {
      setNotice({
        kind: 'error',
        text: err.message || 'Could not delete book.',
      });
    } finally {
      setActionInProgress(null);
    }
  };

  const logout = async () => {
    if (dirty) {
      setNotice({
        kind: 'error',
        text: 'Save or cancel your unsaved changes before logging out.',
      });
      return;
    }
    setLoggingOut(true);
    setNotice(null);
    try {
      if (identity.authenticated) {
        const { createClient } = await import('@/lib/supabase/client');
        const { error } = await createClient().auth.signOut();
        if (error) throw error;
      }
      window.location.assign('/');
    } catch {
      setNotice({
        kind: 'error',
        text: 'Could not log out. Please check your connection and try again.',
      });
      setLoggingOut(false);
    }
  };

  return (
    <div className="admin-workspace">
      <aside className="admin-sidebar">
        <Link href="/" className="admin-brand" aria-label="BookishBae store">
          <Image
            src="/assets/BookishBae logo on transparent background-1.png"
            alt="BookishBae — Stories by Annu"
            width={2172}
            height={724}
            sizes="184px"
            priority
          />
        </Link>
        <p className="admin-nav-label">STORE WORKSPACE</p>
        <nav aria-label="Admin navigation">
          {sections.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => navigate(id)}
              aria-current={active === id ? 'page' : undefined}
            >
              <Icon size={18} aria-hidden="true" />
              <span>{label}</span>
              {id === 'catalogue' && <small>{books.length}</small>}
            </button>
          ))}
        </nav>
        <div className="admin-sidebar-bottom">
          <span>
            <ShieldCheck size={17} aria-hidden="true" />
            {identity.preview ? 'Development preview' : 'Admin workspace'}
          </span>
          <Link href="/">
            Visit the storefront <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
        </div>
      </aside>

      <div className="admin-main-shell">
        <header className="admin-topbar">
          <p className="admin-breadcrumb">
            Workspace <span>/</span> <strong>{currentLabel}</strong>
          </p>
          <div className="admin-account-actions">
            <button
              className={`admin-profile-button${active === 'profile' ? ' is-active' : ''}`}
              aria-label="Open admin profile"
              onClick={() => navigate('profile')}
            >
              <span className="admin-avatar">
                {identity.avatarUrl &&
                allowedImageSource(identity.avatarUrl) &&
                !avatarFailed ? (
                  <Image
                    src={identity.avatarUrl}
                    alt=""
                    fill
                    sizes="37px"
                    unoptimized
                    onError={() => setAvatarFailed(true)}
                  />
                ) : (
                  <UserRound size={19} aria-hidden="true" />
                )}
              </span>
              <span>
                <strong>{identity.fullName || 'Admin profile'}</strong>
                <small>
                  {identity.preview ? 'Workspace preview' : 'Administrator'}
                </small>
              </span>
            </button>
            <button
              className="admin-button admin-button-secondary admin-logout"
              onClick={logout}
              disabled={loggingOut}
            >
              {loggingOut ? (
                <LoaderCircle
                  size={16}
                  className="admin-spin"
                  aria-hidden="true"
                />
              ) : (
                <LogOut size={16} aria-hidden="true" />
              )}
              <span>{loggingOut ? 'Logging out…' : 'Logout'}</span>
            </button>
          </div>
        </header>

        <main id="main" className="admin-main" tabIndex={-1}>
          <div className="admin-page-heading">
            <div>
              <p className="admin-eyebrow">BOOKISHBAE ADMIN</p>
              <h1 ref={heading} tabIndex={-1}>
                {editing
                  ? editing === 'new'
                    ? 'Add a book'
                    : 'Edit book'
                  : currentLabel}
              </h1>
              <p>
                {active === 'dashboard'
                  ? 'A live overview of your catalogue, orders, and store operations.'
                  : active === 'catalogue'
                    ? 'Manage, publish, and care for every title in your database.'
                    : active === 'orders'
                      ? 'Find purchases and review verified payments, refunds, and delivery records.'
                      : active === 'coupons' ? 'Create and manage discounts for your readers.'
                      : active === 'categories' ? 'Organize your books with your own categories.'
                      : 'Manage your profile details and account session.'}
              </p>
            </div>
            {active === 'dashboard' || (active === 'catalogue' && !editing) ? (
              <button
                className="admin-button"
                onClick={() => startEditor('new')}
              >
                <Plus size={17} aria-hidden="true" /> Add book
              </button>
            ) : null}
          </div>

          {notice && (
            <div
              className={`admin-notice admin-notice-${notice.kind}`}
              role={notice.kind === 'error' ? 'alert' : 'status'}
            >
              {notice.kind === 'success' && (
                <Check size={17} aria-hidden="true" />
              )}
              <p>{notice.text}</p>
              <button
                aria-label="Dismiss message"
                onClick={() => setNotice(null)}
              >
                <X size={17} aria-hidden="true" />
              </button>
            </div>
          )}

          {pendingSection && (
            <div className="admin-discard-notice" role="alert">
              <div>
                <strong>Leave your unsaved changes?</strong>
                <p>Unsaved form modifications will be discarded.</p>
              </div>
              <button
                className="admin-button admin-button-secondary"
                onClick={() => setPendingSection(null)}
              >
                Keep editing
              </button>
              <button
                className="admin-button"
                onClick={() => {
                  setDirty(false);
                  setEditing(null);
                  setActive(pendingSection);
                  setPendingSection(null);
                  setNotice(null);
                }}
              >
                Discard changes
              </button>
            </div>
          )}

          {active === 'dashboard' && (
            <>
              <div className="admin-metrics">
                {[
                  {
                    label: 'Catalogue titles',
                    value: stats ? stats.catalogueTitles : books.length,
                    detail: 'Total books in database',
                    icon: BookOpen,
                  },
                  {
                    label: 'Draft editions',
                    value: stats ? stats.workspaceDrafts : drafts,
                    detail: 'Hidden from storefront',
                    icon: FilePenLine,
                  },
                  {
                    label: 'Total revenue',
                    value: stats ? currency(Math.round(stats.revenuePaise / 100)) : '₹0.00',
                    detail: 'Verified paid orders',
                    icon: CreditCard,
                  },
                  {
                    label: 'Customer orders',
                    value: stats ? stats.orderCount : 0,
                    detail: 'Orders in ledger',
                    icon: ShoppingBag,
                  },
                ].map(({ label, value, detail, icon: Icon }) => (
                  <article className="admin-metric" key={label}>
                    <div>
                      <span>{label}</span>
                      <Icon size={18} aria-hidden="true" />
                    </div>
                    <strong>{value}</strong>
                    <p>{detail}</p>
                  </article>
                ))}
              </div>

              <div className="admin-dashboard-grid">
                <section className="admin-panel">
                  <div className="admin-panel-heading">
                    <div>
                      <h2>Recent orders</h2>
                      <p>Latest customer purchases and delivery records.</p>
                    </div>
                    <button
                      className="admin-text-button"
                      onClick={() => navigate('orders')}
                    >
                      View orders <ArrowRight size={15} aria-hidden="true" />
                    </button>
                  </div>
                  {stats && stats.recentOrders && stats.recentOrders.length > 0 ? (
                    <div className="admin-table-scroll">
                      <table className="admin-orders-table">
                        <thead>
                          <tr>
                            <th>Order</th>
                            <th>Customer</th>
                            <th>Amount</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {stats.recentOrders.slice(0, 5).map((o: any) => (
                            <tr key={o.id}>
                              <td>
                                <strong>{o.order_number || o.id.slice(0, 8)}</strong>
                              </td>
                              <td>{o.email}</td>
                              <td>{currency(Math.round(o.total_paise / 100))}</td>
                              <td>
                                <span className={`admin-badge admin-status-${o.status}`}>
                                  {o.status}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="admin-empty-state">
                      <span className="admin-empty-icon">
                        <ShoppingBag size={25} aria-hidden="true" />
                      </span>
                      <h3>No orders yet</h3>
                      <p>
                        Customer purchases will appear here automatically upon order placement and verified payment.
                      </p>
                    </div>
                  )}
                </section>

                <section className="admin-panel">
                  <div className="admin-panel-heading">
                    <div>
                      <h2>Store services</h2>
                      <p>Connected integrations.</p>
                    </div>
                  </div>
                  <div className="admin-services">
                    {[
                      ['Cashfree', 'Payments & Webhooks', 'Active'],
                      ['Brevo', 'Transactional emails & receipts', 'Active'],
                      ['Cloudinary', 'Images & secure PDF storage', 'Active'],
                      ['Supabase', 'Database & Admin accounts', 'Active'],
                    ].map(([title, subtitle, status]) => (
                      <div key={title}>
                        <span>
                          <strong>{title}</strong>
                          <small>{subtitle}</small>
                        </span>
                        <span className="admin-badge admin-status-paid">
                          {status}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              </div>

              <section className="admin-panel">
                <div className="admin-panel-heading">
                  <div>
                    <h2>Catalogue overview</h2>
                    <p>Live storefront books fetched from backend database.</p>
                  </div>
                  <button
                    className="admin-text-button"
                    onClick={() => navigate('catalogue')}
                  >
                    Manage catalogue <ArrowRight size={15} aria-hidden="true" />
                  </button>
                </div>
                <div className="admin-catalogue-preview">
                  {books.slice(0, 3).map((book) => (
                    <button
                      key={book.slug}
                      onClick={() => startEditor(book)}
                      aria-label={`Edit ${book.title}`}
                    >
                      <span className="admin-mini-cover">
                        <AdminCoverThumb
                          src={book.coverImage}
                          alt={`${book.title} cover`}
                          sizes="48px"
                        />
                      </span>
                      <span>
                        <strong>{book.title}</strong>
                        <small>
                          {book.status === 'published' ? 'Published' : 'Draft'} · {book.category}
                        </small>
                      </span>
                      <span>
                        {currency(book.priceRupees)}
                        <ArrowUpRight size={15} aria-hidden="true" />
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            </>
          )}

          {active === 'catalogue' &&
            (editing ? (
              <BookEditor
                key={editing === 'new' ? 'new' : editing.slug}
                book={editing === 'new' ? null : editing}
                books={books}
                onSave={saveBook}
                onCancel={() => {
                  setEditing(null);
                  setDirty(false);
                }}
                onDirtyChange={setDirty}
                onCoverCreated={(url) => objectUrls.current.push(url)}
              />
            ) : (
              <section className="admin-panel">
                <div className="admin-panel-heading">
                  <div>
                    <h2>
                      Book catalogue{' '}
                      <span className="admin-count">{books.length}</span>
                    </h2>
                    <p>
                      {drafts} draft {drafts === 1 ? 'book' : 'books'} ·{' '}
                      {books.length - drafts} published on storefront
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <button
                      className="admin-button admin-button-secondary"
                      onClick={() => void loadBooks()}
                      disabled={loadingCatalogue}
                      title="Reload catalogue from database"
                    >
                      <RefreshCw
                        size={15}
                        className={loadingCatalogue ? 'admin-spin' : ''}
                      />
                    </button>
                    <div className="admin-search">
                      <Search size={17} aria-hidden="true" />
                      <label className="sr-only" htmlFor="catalogue-search">
                        Search catalogue
                      </label>
                      <input
                        id="catalogue-search"
                        type="search"
                        placeholder="Search title, genre, or slug…"
                        value={catalogueQuery}
                        onChange={(event) =>
                          setCatalogueQuery(event.target.value)
                        }
                      />
                    </div>
                  </div>
                </div>

                <div className="admin-book-list">
                  {visibleBooks.map((book) => (
                    <article className="admin-book-row" key={book.slug}>
                      <div className="admin-row-cover">
                        <AdminCoverThumb
                          src={book.coverImage}
                          alt={`${book.title} cover`}
                          sizes="52px"
                        />
                      </div>
                      <div className="admin-book-details">
                        <h3>{book.title}</h3>
                        <p>
                          {book.subtitle || 'BookishBae edition'} · {book.pageCount} pages
                        </p>
                        <div>
                          <span className="admin-badge">{book.category}</span>
                          <span
                            className={`admin-badge${book.status === 'published' ? ' admin-status-paid' : ' admin-badge-plum'}`}
                          >
                            {book.status === 'published'
                              ? 'Published'
                              : book.status === 'archived'
                                ? 'Archived'
                                : 'Draft'}
                          </span>
                          {book.isFeatured && (
                            <span className="admin-featured">Featured</span>
                          )}
                          {book.mainPdfKey && (
                            <span className="admin-badge" style={{ background: '#f4eef5' }}>
                              Full PDF
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="admin-book-price">
                        <strong>{currency(book.priceRupees)}</strong>
                        {book.originalPriceRupees && (
                          <del>{currency(book.originalPriceRupees)}</del>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <button
                          className="admin-button admin-button-secondary"
                          onClick={() => toggleStatus(book)}
                          disabled={actionInProgress === book.id}
                          title={
                            book.status === 'published'
                              ? 'Unpublish to draft'
                              : 'Publish to storefront'
                          }
                          style={{ padding: '8px 12px' }}
                        >
                          {book.status === 'published' ? (
                            <>
                              <EyeOff size={15} aria-hidden="true" />
                              <span>Unpublish</span>
                            </>
                          ) : (
                            <>
                              <Eye size={15} aria-hidden="true" />
                              <span>Publish</span>
                            </>
                          )}
                        </button>
                        <button
                          className="admin-button admin-button-secondary"
                          onClick={() => startEditor(book)}
                          aria-label={`Edit ${book.title}`}
                          style={{ padding: '8px 12px' }}
                        >
                          <FilePenLine size={15} aria-hidden="true" />
                          <span>Edit</span>
                        </button>
                        <button
                          className="admin-button admin-button-secondary"
                          onClick={() => deleteBook(book)}
                          disabled={actionInProgress === book.id}
                          aria-label={`Delete ${book.title}`}
                          style={{ padding: '8px 12px', color: '#aa4747' }}
                          title="Delete book from database"
                        >
                          <Trash2 size={15} aria-hidden="true" />
                        </button>
                      </div>
                    </article>
                  ))}
                </div>

                {visibleBooks.length === 0 && (
                  <div className="admin-empty-state">
                    <Search size={25} aria-hidden="true" />
                    <h3>No matching books</h3>
                    <p>Try a different title, genre, or slug.</p>
                    <button
                      className="admin-button admin-button-secondary"
                      onClick={() => setCatalogueQuery('')}
                    >
                      Clear search
                    </button>
                  </div>
                )}
              </section>
            ))}

          {active === 'orders' && <OrdersPanel books={books} />}
          {active === 'coupons' && <CouponsPanel books={books} />}
          {active === 'categories' && <CategoriesPanel />}
          {active === 'profile' && (
            <ProfilePanel
              identity={identity}
              onSaved={(updated) => {
                setIdentity(updated);
                setDirty(false);
                setPendingSection(null);
                setNotice({
                  kind: 'success',
                  text: 'Your profile details have been saved.',
                });
              }}
              onDirtyChange={profileDirtyChange}
              onSavingChange={profileSavingChange}
            />
          )}

          <footer className="admin-workspace-footer">
            <span>BookishBae · Author workspace</span>
            <span>Connected to backend database.</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
