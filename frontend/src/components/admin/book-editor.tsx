'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Image from 'next/image';
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  FileText,
  ImagePlus,
  LoaderCircle,
  Save,
  Upload,
  X,
} from 'lucide-react';
import type { Category } from '@/types/database';
import { adminRequest } from './categories-panel';
import { MAX_ORDER_PAISE, PAISE_PER_RUPEE } from '@/lib/money';
import { allowedImageSource, safeReadApiResponse, type CatalogueBook } from './admin-types';

const maxImageBytes = 5 * 1024 * 1024;
const maxPdfBytes = 50 * 1024 * 1024;
const maxPrice = MAX_ORDER_PAISE / PAISE_PER_RUPEE;

type FormValues = {
  title: string;
  slug: string;
  subtitle: string;
  description: string;
  excerpt: string;
  categoryId: string;
  price: string;
  originalPrice: string;
  pageCount: string;
  coverPath: string;
  samplePdfUrl: string;
  publishedDate: string;
  isFeatured: boolean;
  status: 'draft' | 'published' | 'archived';
};

type FieldErrors = Partial<
  Record<keyof FormValues | 'cover' | 'mainPdf' | 'samplePreview', string>
>;


function formatCoverPath(path?: string | null): string {
  if (!path) return '';
  if (
    path.startsWith('blob:') ||
    path.startsWith('data:') ||
    path.startsWith('http://') ||
    path.startsWith('https://') ||
    path.startsWith('/')
  ) {
    return path;
  }
  if (path.startsWith('covers/')) {
    return `/${path}`;
  }
  return path;
}

export function BookEditor({
  book,
  books,
  onSave,
  onCancel,
  onDirtyChange,
  onCoverCreated,
}: {
  book: CatalogueBook | null;
  books: CatalogueBook[];
  onSave: (book: CatalogueBook) => void | Promise<void>;
  onCancel: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onCoverCreated: (url: string) => void;
}) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryError, setCategoryError] = useState('');
  const [preview, setPreview] = useState(() => (book?.sampleText ?? []).map(section => ({ heading: section.heading, body: section.paragraphs.join('\n\n') })));
  useEffect(() => { adminRequest('/api/admin/categories').then(data => setCategories(data.categories)).catch(error => setCategoryError(error.message)); }, []);
  const previewChange = (index: number, field: 'heading' | 'body', value: string) => { setPreview(previous => previous.map((section, i) => i === index ? { ...section, [field]: value } : section)); setDirty(true); onDirtyChange(true); };
  const [values, setValues] = useState<FormValues>({
    title: book?.title ?? '',
    slug: book?.slug ?? '',
    subtitle: book?.subtitle ?? '',
    description: book?.description ?? '',
    excerpt: book?.excerpt ?? '',
    categoryId: book?.categoryId ?? '',
    price: book ? String(book.priceRupees) : '',
    originalPrice: book?.originalPriceRupees
      ? String(book.originalPriceRupees)
      : '',
    pageCount: book ? String(book.pageCount) : '200',
    coverPath: book?.coverImage?.startsWith('blob:')
      ? ''
      : (book?.coverImage ?? ''),
    samplePdfUrl: book?.samplePdfUrl ?? '',
    publishedDate: book?.publishedDate ?? '',
    isFeatured: book?.isFeatured ?? false,
    status: book?.status ?? 'draft',
  });

  const [coverKey, setCoverKey] = useState<string | null>(book?.coverKey ?? null);
  const [mainPdfKey, setMainPdfKey] = useState<string | null>(book?.mainPdfKey ?? null);
  const [mainPdfBytes, setMainPdfBytes] = useState<number | null>(book?.mainPdfBytes ?? null);
  const [mainPdfName, setMainPdfName] = useState<string>('');

  const [samplePdfKey, setSamplePdfKey] = useState<string | null>(book?.samplePdfKey ?? null);
  const [samplePdfName, setSamplePdfName] = useState<string>('');

  const [localImage, setLocalImage] = useState(
    book?.coverImage?.startsWith('blob:') ? book.coverImage : '',
  );
  const [filename, setFilename] = useState(
    book?.coverImage?.startsWith('blob:') ? 'Workspace image' : '',
  );
  const [imageState, setImageState] = useState<'loading' | 'ready' | 'error'>(
    'ready',
  );

  const [uploadingCover, setUploadingCover] = useState(false);
  const [uploadingPdf, setUploadingPdf] = useState(false);
  const [uploadingSample, setUploadingSample] = useState(false);
  const [saving, setSaving] = useState(false);

  const [dirty, setDirty] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [slugTouched, setSlugTouched] = useState(!!book);
  const [errors, setErrors] = useState<FieldErrors>({});

  const fileInput = useRef<HTMLInputElement>(null);
  const pdfInput = useRef<HTMLInputElement>(null);
  const sampleInput = useRef<HTMLInputElement>(null);
  const summary = useRef<HTMLDivElement>(null);

  const cover = formatCoverPath(
    localImage || (allowedImageSource(values.coverPath) ? values.coverPath : ''),
  );

  const change = <K extends keyof FormValues>(
    field: K,
    value: FormValues[K],
  ) => {
    setValues((previous) => ({ ...previous, [field]: value }));
    setDirty(true);
    onDirtyChange(true);
    setErrors((previous) => ({ ...previous, [field]: undefined }));
  };

  const chooseImage = async (file?: File) => {
    if (!file) return;
    if (
      !['image/png', 'image/jpeg', 'image/webp', 'image/avif'].includes(
        file.type,
      )
    ) {
      setErrors((previous) => ({
        ...previous,
        cover: 'Choose a PNG, JPEG, WebP, or AVIF image.',
      }));
      return;
    }
    if (file.size > maxImageBytes) {
      setErrors((previous) => ({
        ...previous,
        cover: 'The cover must be 5 MB or smaller.',
      }));
      return;
    }

    // Immediate local preview!
    const previewUrl = URL.createObjectURL(file);
    onCoverCreated(previewUrl);
    setLocalImage(previewUrl);
    setFilename(file.name);
    setImageState('ready');
    setDirty(true);
    onDirtyChange(true);
    setErrors((previous) => ({ ...previous, cover: undefined }));

    setUploadingCover(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('purpose', 'cover');
      if (book?.id) formData.append('productId', book.id);

      const res = await fetch('/api/admin/uploads', {
        method: 'POST',
        headers: { 'x-dev-admin': 'true' },
        body: formData,
      });

      const { ok, data, error } = await safeReadApiResponse(res);
      if (!ok || !data?.key || !data?.url) {
        throw new Error(error);
      }

      setCoverKey(data.key);
      if (data.url) {
        setValues((previous) => ({ ...previous, coverPath: data.url }));
        setLocalImage('');
      }
      setErrors((previous) => ({ ...previous, cover: undefined }));
    } catch (err: any) {
      setErrors((previous) => ({
        ...previous,
        cover: err.message || 'Image upload failed. Retry the upload before saving.',
      }));
    } finally {
      setUploadingCover(false);
    }
  };

  const chooseMainPdf = async (file?: File) => {
    if (!file) return;
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setErrors((previous) => ({
        ...previous,
        mainPdf: 'The file must be a PDF document (.pdf).',
      }));
      return;
    }
    if (file.size > maxPdfBytes) {
      setErrors((previous) => ({
        ...previous,
        mainPdf: 'The PDF must be 50 MB or smaller.',
      }));
      return;
    }

    setUploadingPdf(true);
    setErrors((previous) => ({ ...previous, mainPdf: undefined }));

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('purpose', 'main_pdf');
      if (book?.id) formData.append('productId', book.id);

      const res = await fetch('/api/admin/uploads', {
        method: 'POST',
        headers: { 'x-dev-admin': 'true' },
        body: formData,
      });

      const { ok, data, error } = await safeReadApiResponse(res);
      if (!ok) {
        throw new Error(error);
      }

      setMainPdfKey(data.key);
      setMainPdfBytes(data.size || file.size);
      setMainPdfName(file.name);
      setDirty(true);
      onDirtyChange(true);
      setErrors((previous) => ({ ...previous, mainPdf: undefined }));
    } catch (err: any) {
      setErrors((previous) => ({
        ...previous,
        mainPdf: err.message || 'Failed to upload PDF document. Please try again.',
      }));
    } finally {
      setUploadingPdf(false);
    }
  };

  const chooseSamplePdf = async (file?: File) => {
    if (!file) return;
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setErrors((previous) => ({
        ...previous,
        samplePdfUrl: 'Sample file must be a PDF document.',
      }));
      return;
    }

    setUploadingSample(true);
    setErrors((previous) => ({ ...previous, samplePdfUrl: undefined }));

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('purpose', 'sample_pdf');
      if (book?.id) formData.append('productId', book.id);

      const res = await fetch('/api/admin/uploads', {
        method: 'POST',
        headers: { 'x-dev-admin': 'true' },
        body: formData,
      });

      const { ok, data, error } = await safeReadApiResponse(res);
      if (!ok) {
        throw new Error(error);
      }

      setSamplePdfKey(data.key);
      setSamplePdfName(file.name);
      if (data.url) {
        setValues((previous) => ({ ...previous, samplePdfUrl: data.url }));
      }
      setDirty(true);
      onDirtyChange(true);
    } catch (err: any) {
      setErrors((previous) => ({
        ...previous,
        samplePdfUrl: err.message || 'Sample upload failed.',
      }));
    } finally {
      setUploadingSample(false);
    }
  };

  const cancel = () => {
    if (dirty) setDiscard(true);
    else onCancel();
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const found: FieldErrors = {
      ...(errors.mainPdf ? { mainPdf: errors.mainPdf } : {}),
      ...(errors.samplePdfUrl ? { samplePdfUrl: errors.samplePdfUrl } : {}),
    };

    if (!values.title.trim()) found.title = 'Enter the book title.';
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(values.slug)) {
      found.slug =
        'Use lowercase letters and numbers, separated by single hyphens.';
    } else if (
      books.some(
        (item) => item.slug === values.slug && item.slug !== book?.slug,
      )
    ) {
      found.slug = 'This slug already belongs to another book.';
    }

    if (!values.description.trim())
      found.description = 'Add a description for this book.';
    if (values.categoryId && !categories.some(category => category.id === values.categoryId)) found.categoryId = 'Choose an existing category.';
    const sampleText = preview.map(section => ({ heading: section.heading.trim(), paragraphs: section.body.split(/\n\s*\n/).map(text => text.trim()).filter(Boolean) }));
    if (sampleText.some(section => !section.heading || !section.paragraphs.length)) found.samplePreview = 'Each preview section needs a heading and at least one paragraph.';

    const price = Number(values.price);
    if (
      !values.price.trim() ||
      !Number.isFinite(price) ||
      price < 1 ||
      price > maxPrice ||
      !/^\d+(?:\.\d{1,2})?$/.test(values.price)
    ) {
      found.price =
        'Enter a price from ₹1 to ₹5,00,000 with no more than two decimal places.';
    }

    const originalPrice = values.originalPrice.trim()
      ? Number(values.originalPrice)
      : undefined;
    if (
      originalPrice !== undefined &&
      (!Number.isFinite(originalPrice) ||
        originalPrice <= price ||
        originalPrice > maxPrice ||
        !/^\d+(?:\.\d{1,2})?$/.test(values.originalPrice))
    ) {
      found.originalPrice =
        'The original price must be above the selling price, with at most two decimal places.';
    }

    const pageCount = Number(values.pageCount);
    if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > 5000) {
      found.pageCount = 'Enter a whole number from 1 to 5,000 pages.';
    }

    const durableCover = values.coverPath.trim();
    if (localImage.startsWith('blob:') || (!coverKey && (!allowedImageSource(durableCover) || /^(blob:|data:)/.test(durableCover)))) {
      found.cover = 'Choose a valid cover image or an existing image path.';
    }

    // Server-side publishing requirements
    if (values.status === 'published') {
      if (!coverKey && !cover) {
        found.cover = 'Upload a cover before publishing.';
      }
      if (!mainPdfKey && !book?.mainPdfKey) {
        found.mainPdf = 'Upload the main e-book PDF before publishing.';
      }
    }

    setErrors(found);
    if (Object.keys(found).length) {
      requestAnimationFrame(() => summary.current?.focus());
      return;
    }

    if (uploadingCover || uploadingPdf || uploadingSample) return;

    setSaving(true);
    try {
      await onSave({
        id: book?.id,
        slug: values.slug,
        title: values.title.trim(),
        subtitle: values.subtitle.trim(),
        description: values.description.trim(),
        excerpt: values.excerpt.trim(),
        categoryId: values.categoryId || null,
        categorySlug: categories.find(category => category.id === values.categoryId)?.slug || '',
        category: categories.find(category => category.id === values.categoryId)?.name || 'Uncategorized',
        sampleText,
        priceRupees: price,
        ...(originalPrice !== undefined
          ? { originalPriceRupees: originalPrice }
          : {}),
        coverImage: durableCover,
        coverKey: coverKey || durableCover || null,
        mainPdfKey: mainPdfKey || book?.mainPdfKey || null,
        mainPdfBytes: mainPdfBytes || book?.mainPdfBytes || null,
        samplePdfKey: samplePdfKey || values.samplePdfUrl.trim() || null,
        samplePdfUrl: values.samplePdfUrl.trim(),
        pageCount,
        publishedDate: values.publishedDate.trim() || new Date().toISOString(),
        isFeatured: values.isFeatured,
        status: values.status,
        workspaceDraft: false,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="admin-editor" onSubmit={submit} noValidate>
      <button
        className="admin-text-button admin-back"
        type="button"
        onClick={cancel}
      >
        <ArrowLeft size={16} aria-hidden="true" /> Back to catalogue
      </button>

      {discard && (
        <div className="admin-discard-notice" role="alert">
          <div>
            <strong>Discard unsaved book changes?</strong>
            <p>Your catalogue will keep the last saved version from the backend.</p>
          </div>
          <button
            className="admin-button admin-button-secondary"
            type="button"
            onClick={() => setDiscard(false)}
          >
            Keep editing
          </button>
          <button className="admin-button" type="button" onClick={onCancel}>
            Discard changes
          </button>
        </div>
      )}

      {Object.values(errors).some(Boolean) && (
        <div
          className="admin-form-summary"
          role="alert"
          ref={summary}
          tabIndex={-1}
        >
          <strong>Please review the highlighted fields.</strong>
          <ul>
            {Object.entries(errors)
              .filter(([, value]) => value)
              .map(([field, message]) => (
                <li key={field}>
                  <a
                    href={`#book-${field}`}
                    onClick={(event) => {
                      event.preventDefault();
                      document.getElementById(`book-${field}`)?.focus();
                    }}
                  >
                    {message}
                  </a>
                </li>
              ))}
          </ul>
        </div>
      )}

      <div className="admin-editor-layout">
        <div className="admin-editor-main">
          <section className="admin-panel admin-form-panel">
            <div className="admin-form-section-title">
              <BookOpen size={18} aria-hidden="true" />
              <div>
                <h2>Book details</h2>
                <p>
                  Metadata and descriptions saved directly to the database.
                </p>
              </div>
            </div>

            <div className="admin-form-grid">
              <div className="admin-field">
                <label htmlFor="book-title">
                  Title <span>Required</span>
                </label>
                <input
                  id="book-title"
                  value={values.title}
                  required
                  maxLength={160}
                  onChange={(event) => {
                    change('title', event.target.value);
                    if (!slugTouched) {
                      setValues((previous) => ({
                        ...previous,
                        slug: event.target.value
                          .toLowerCase()
                          .replace(/[^a-z0-9]+/g, '-')
                          .replace(/^-|-$/g, ''),
                      }));
                    }
                  }}
                  aria-invalid={!!errors.title}
                  placeholder="Enter the book title"
                />
                {errors.title && (
                  <p className="admin-field-error">{errors.title}</p>
                )}
              </div>

              <div className="admin-field">
                <label htmlFor="book-status">
                  Publication Status <span>Required</span>
                </label>
                <select
                  id="book-status"
                  value={values.status}
                  onChange={(event) =>
                    change('status', event.target.value as FormValues['status'])
                  }
                >
                  <option value="draft">Draft (Saved in backend, hidden from storefront)</option>
                  <option value="published">Published (Live on storefront for purchase)</option>
                  <option value="archived">Archived (Unlisted / discontinued)</option>
                </select>
                <p className="admin-field-help">
                  Published books appear immediately on the customer storefront.
                </p>
              </div>
            </div>

            <div className="admin-field">
              <label htmlFor="book-subtitle">
                Subtitle <span>Optional</span>
              </label>
              <input
                id="book-subtitle"
                value={values.subtitle}
                maxLength={160}
                onChange={(event) => change('subtitle', event.target.value)}
                placeholder="For example: A novella of quiet departures"
              />
            </div>

            <div className="admin-field">
              <label htmlFor="book-description">
                Description <span>Required</span>
              </label>
              <textarea
                id="book-description"
                rows={6}
                value={values.description}
                required
                maxLength={8000}
                onChange={(event) => change('description', event.target.value)}
                aria-invalid={!!errors.description}
                placeholder="Describe the story in your own words…"
              />
              {errors.description && (
                <p className="admin-field-error">{errors.description}</p>
              )}
              <span className="admin-field-help">
                {values.description.length.toLocaleString()} / 8,000 characters
              </span>
            </div>

            <div className="admin-field">
              <label htmlFor="book-excerpt">
                Short catalogue excerpt <span>Optional</span>
              </label>
              <textarea
                id="book-excerpt"
                rows={3}
                value={values.excerpt}
                maxLength={300}
                onChange={(event) => change('excerpt', event.target.value)}
              />
              <p className="admin-field-help">
                A brief teaser for the book card. Up to 300 characters.
              </p>
            </div>

            <div className="admin-form-grid">
              <div className="admin-field">
                <label htmlFor="book-categoryId">
                  Category <span>Optional</span>
                </label>
                <select
                  id="book-categoryId"
                  value={values.categoryId}
                  onChange={(event) =>
                    change('categoryId', event.target.value)
                  }
                  aria-invalid={!!errors.categoryId}
                >
                  <option value="">Uncategorized</option>
                  {categories.map(category => (
                    <option value={category.id} key={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
                {categoryError && <p role="alert" className="admin-field-error">{categoryError}</p>}
                <p className="admin-field-help">Create or rename categories in the Categories section.</p>
                {errors.categoryId && (
                  <p className="admin-field-error">{errors.categoryId}</p>
                )}
              </div>

              <div className="admin-field">
                <label htmlFor="book-pageCount">
                  Page count <span>Required</span>
                </label>
                <input
                  id="book-pageCount"
                  type="number"
                  min={1}
                  max={5000}
                  step={1}
                  value={values.pageCount}
                  onChange={(event) => change('pageCount', event.target.value)}
                  aria-invalid={!!errors.pageCount}
                />
                {errors.pageCount && (
                  <p className="admin-field-error">{errors.pageCount}</p>
                )}
              </div>
            </div>
          </section>

          <section className="admin-panel admin-form-panel">
            <h2>Pricing & Edition</h2>
            <p className="admin-section-description">
              Prices are in Indian rupees. Verified server-side during checkout.
            </p>

            <div className="admin-form-grid">
              <div className="admin-field">
                <label htmlFor="book-price">
                  Selling price (₹) <span>Required</span>
                </label>
                <input
                  id="book-price"
                  type="number"
                  min={1}
                  max={maxPrice}
                  step="0.01"
                  value={values.price}
                  onChange={(event) => change('price', event.target.value)}
                  aria-invalid={!!errors.price}
                  placeholder="199"
                />
                {errors.price && (
                  <p className="admin-field-error">{errors.price}</p>
                )}
              </div>

              <div className="admin-field">
                <label htmlFor="book-originalPrice">
                  Original price (₹) <span>Optional</span>
                </label>
                <input
                  id="book-originalPrice"
                  type="number"
                  min={1}
                  max={maxPrice}
                  step="0.01"
                  value={values.originalPrice}
                  onChange={(event) =>
                    change('originalPrice', event.target.value)
                  }
                  aria-invalid={!!errors.originalPrice}
                  placeholder="299 (Crossed out on storefront)"
                />
                {errors.originalPrice && (
                  <p className="admin-field-error">{errors.originalPrice}</p>
                )}
              </div>
            </div>

            <div className="admin-form-grid">
              <div className="admin-field">
                <label htmlFor="book-slug">
                  Book slug <span>Required</span>
                </label>
                <input
                  id="book-slug"
                  value={values.slug}
                  maxLength={80}
                  onChange={(event) => {
                    setSlugTouched(true);
                    change('slug', event.target.value);
                  }}
                  aria-invalid={!!errors.slug}
                />
                <p className="admin-field-help">
                  Unique URL path identifier, e.g. <code>letters-i-never-sent</code>.
                </p>
                {errors.slug && (
                  <p className="admin-field-error">{errors.slug}</p>
                )}
              </div>

              <div className="admin-field">
                <label htmlFor="book-publishedDate">
                  Publication date <span>Optional</span>
                </label>
                <input
                  id="book-publishedDate"
                  value={values.publishedDate}
                  maxLength={50}
                  onChange={(event) =>
                    change('publishedDate', event.target.value)
                  }
                  placeholder="September 2026"
                />
              </div>
            </div>

            <label className="admin-checkbox" style={{ marginTop: 12 }}>
              <input
                type="checkbox"
                checked={values.isFeatured}
                onChange={(event) => change('isFeatured', event.target.checked)}
              />
              <span>
                Featured book{' '}
                <small>Highlights this edition in hero sections and filters.</small>
              </span>
            </label>
          </section>

          <section className="admin-panel admin-form-panel" id="book-samplePreview">
            <h2>Sample reading preview</h2>
            <p className="admin-section-description">Enter your own chapter or story text. This reading preview is separate from the downloadable sample PDF.</p>
            {!preview.length && <p className="admin-field-help">No preview text yet. Readers will see an empty preview until you add content.</p>}
            {preview.map((section, index) => <div key={index}>
              <div className="admin-field"><label htmlFor={`preview-heading-${index}`}>Chapter/story heading</label><input id={`preview-heading-${index}`} maxLength={200} value={section.heading} onChange={e => previewChange(index, 'heading', e.target.value)} /></div>
              <div className="admin-field"><label htmlFor={`preview-body-${index}`}>Paragraphs (separate with a blank line)</label><textarea id={`preview-body-${index}`} rows={8} maxLength={100000} value={section.body} onChange={e => previewChange(index, 'body', e.target.value)} /></div>
              <button type="button" className="admin-text-button" onClick={() => { setPreview(previous => previous.filter((_, i) => i !== index)); setDirty(true); onDirtyChange(true); }}>Remove section</button>
            </div>)}
            <button type="button" className="admin-button admin-button-secondary" disabled={preview.length >= 30} onClick={() => { setPreview(previous => [...previous, { heading: '', body: '' }]); setDirty(true); onDirtyChange(true); }}>Add preview section</button>
            {errors.samplePreview && <p role="alert" className="admin-field-error">{errors.samplePreview}</p>}
          </section>

          <section className="admin-panel admin-form-panel">
            <div className="admin-form-section-title">
              <FileText size={18} aria-hidden="true" />
              <div>
                <h2>Secure Main E-book PDF</h2>
                <p>
                  The full e-book PDF file delivered to buyers upon verified payment. Stored privately with authenticated access.
                </p>
              </div>
            </div>

            {(mainPdfKey || book?.mainPdfKey) && (
              <div
                className="admin-selected-file"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 14px',
                  background: '#f4eef5',
                  borderRadius: 6,
                  marginBottom: 14,
                }}
              >
                <CheckCircle2 size={16} color="#35724f" />
                <span style={{ fontSize: 13 }}>
                  <strong>{mainPdfName || 'Secure PDF uploaded'}</strong>
                  {mainPdfBytes ? (
                    <small style={{ marginLeft: 8, color: '#706978' }}>
                      ({(mainPdfBytes / (1024 * 1024)).toFixed(2)} MB)
                    </small>
                  ) : null}
                </span>
              </div>
            )}

            <div className="admin-field">
              <label htmlFor="book-main-pdf">Upload Full E-book PDF (.pdf)</label>
              <input
                ref={pdfInput}
                id="book-main-pdf"
                type="file"
                accept="application/pdf,.pdf"
                onChange={(event) => void chooseMainPdf(event.target.files?.[0])}
                disabled={uploadingPdf}
              />
              {uploadingPdf && (
                <p className="admin-field-help" style={{ color: '#562b4e' }}>
                  <LoaderCircle size={14} className="admin-spin" style={{ display: 'inline', marginRight: 6 }} />
                  Uploading full PDF to secure storage…
                </p>
              )}
              {errors.mainPdf && (
                <p className="admin-field-error">{errors.mainPdf}</p>
              )}
              <p className="admin-field-help">
                PDF format up to 50 MB. Never exposed to public URLs; access is protected by HMAC signed claim tokens.
              </p>
            </div>

            <div className="admin-field" style={{ marginTop: 18 }}>
              <label htmlFor="book-sample-pdf">Free Sample PDF</label>
              <input
                ref={sampleInput}
                id="book-sample-pdf"
                type="file"
                accept="application/pdf,.pdf"
                onChange={(event) => void chooseSamplePdf(event.target.files?.[0])}
                disabled={uploadingSample}
              />
              {uploadingSample && (
                <p className="admin-field-help">Uploading sample PDF…</p>
              )}
              {samplePdfName && (
                <p className="admin-selected-file">
                  <CheckCircle2 size={14} color="#35724f" /> {samplePdfName}
                </p>
              )}
              <input
                style={{ marginTop: 8 }}
                id="book-samplePdfUrl"
                value={values.samplePdfUrl}
                maxLength={500}
                onChange={(event) => {
                  change('samplePdfUrl', event.target.value);
                  setSamplePdfKey(null);
                }}
                placeholder="/samples/letters-i-never-sent-sample.pdf"
              />
              <p className="admin-field-help">
                Upload a sample PDF above or provide a public URL/path for reader previews.
              </p>
            </div>
          </section>
        </div>

        <aside className="admin-editor-aside">
          <section className="admin-panel admin-form-panel">
            <div className="admin-form-section-title">
              <ImagePlus size={18} aria-hidden="true" />
              <div>
                <h2>Book cover</h2>
                <p>Preview and upload.</p>
              </div>
            </div>

            <div className="admin-cover-preview">
              {cover && imageState !== 'error' ? (
                <Image
                  key={cover}
                  src={cover}
                  alt={
                    values.title
                      ? `Cover preview for ${values.title}`
                      : 'Selected book cover preview'
                  }
                  fill
                  sizes="240px"
                  unoptimized
                  onLoad={() => setImageState('ready')}
                  onError={() => setImageState('error')}
                />
              ) : (
                <div>
                  <ImagePlus size={33} aria-hidden="true" />
                  <span>
                    {imageState === 'error'
                      ? 'Image could not be loaded'
                      : 'Choose a cover image'}
                  </span>
                </div>
              )}
            </div>

            <div className="admin-field">
              <label htmlFor="book-cover">Select a cover file</label>
              <input
                ref={fileInput}
                id="book-cover"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/avif"
                onChange={(event) => void chooseImage(event.target.files?.[0])}
                disabled={uploadingCover}
              />
              {uploadingCover && (
                <p className="admin-field-help" style={{ color: '#562b4e' }}>
                  <LoaderCircle size={14} className="admin-spin" style={{ display: 'inline', marginRight: 6 }} />
                  Uploading cover image…
                </p>
              )}
              {filename && (
                <p className="admin-selected-file">
                  <Upload size={14} aria-hidden="true" />
                  {filename}
                  <button
                    type="button"
                    aria-label="Remove selected cover file"
                    onClick={() => {
                      setLocalImage('');
                      setFilename('');
                      setCoverKey(null);
                      setImageState(values.coverPath ? 'loading' : 'ready');
                      setDirty(true);
                      onDirtyChange(true);
                      if (fileInput.current) fileInput.current.value = '';
                    }}
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                </p>
              )}
              <p className="admin-field-help">
                PNG, JPEG, WebP, or AVIF · Up to 5 MB.
              </p>
              {errors.cover && (
                <p className="admin-field-error">{errors.cover}</p>
              )}
            </div>

            <div className="admin-field">
              <label htmlFor="book-coverPath">
                Or cover image URL/path
              </label>
              <input
                id="book-coverPath"
                value={values.coverPath}
                maxLength={500}
                onChange={(event) => {
                  change('coverPath', event.target.value);
                  setCoverKey(null);
                  setLocalImage('');
                  setFilename('');
                  setImageState('ready');
                }}
                placeholder="/covers/the-long-afternoon-cover.png"
              />
            </div>
          </section>
        </aside>
      </div>

      <div className="admin-editor-actions">
        <span>{dirty ? 'Unsaved changes' : 'All changes saved'}</span>
        <div>
          <button
            type="button"
            className="admin-button admin-button-secondary"
            onClick={cancel}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="admin-button"
            disabled={saving || uploadingCover || uploadingPdf || uploadingSample}
          >
            {saving ? (
              <LoaderCircle
                className="admin-spin"
                size={16}
                aria-hidden="true"
              />
            ) : (
              <Save size={16} aria-hidden="true" />
            )}{' '}
            {saving ? 'Saving to database…' : 'Save book'}
          </button>
        </div>
      </div>
    </form>
  );
}
