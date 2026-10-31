'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { BookCover } from '@/components/book-cover';
import { mapProductToBook } from '@/lib/product-book';
import { loadCashfreeSdk } from '@/lib/cashfree-checkout';
import { paymentCustomerSchema } from '../../../../shared/customer-details';
import '@/app/storefront.css';
import Link from 'next/link';
import { Navbar } from '@/components/navbar';
import { Footer } from '@/components/footer';
import { ArrowLeft, ArrowRight, CheckCircle2, Lock, ShieldCheck, Sparkles, AlertCircle, LoaderCircle } from 'lucide-react';
import { Book } from '@/lib/books';
import './checkout.css';

declare global {
  interface Window {
    Cashfree?: (config: { mode: string }) => {
      checkout: (options: { paymentSessionId: string; redirectTarget: string }) => Promise<{ error?: { message?: string } } | void>;
    };
  }
}

function CheckoutInner() {
  const searchParams = useSearchParams();
  const slugParam = searchParams.get('book') || searchParams.get('slug') || '';

  const [book, setBook] = useState<Book | null>(null);
  const [loadingBook, setLoadingBook] = useState(true);
  const [bookError, setBookError] = useState<string | null>(null);

  // Form states
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [couponCode, setCouponCode] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<{
    code: string;
    discountType: 'percent' | 'flat';
    discountValue: number;
    discountPaise: number;
  } | null>(null);
  const [couponLoading, setCouponLoading] = useState(false);
  const [couponMessage, setCouponMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Submission states
  const [submitting, setSubmitting] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ fullName?: string; email?: string; phone?: string }>({});

  // 1. Fetch book details from backend to ensure real catalog pricing
  useEffect(() => {
    let active = true;
    async function fetchBook() {
      setLoadingBook(true);
      setBookError(null);
      setBook(null);
      setAppliedCoupon(null);
      try {
        const res = await fetch(`/api/products/${encodeURIComponent(slugParam)}`);
        if (!res.ok) {
          throw new Error('Book not found or unavailable.');
        }
        const data = await res.json();
        const p = data.product;
        if (!p) throw new Error('Book not found.');

        const mappedBook = mapProductToBook(p);
        if (active) setBook(mappedBook);
      } catch (err: any) {
        if (active) setBookError(err.message || 'Could not load book details.');
      } finally {
        if (active) setLoadingBook(false);
      }
    }

    fetchBook();
    return () => {
      active = false;
    };
  }, [slugParam]);

  const [sdkError, setSdkError] = useState('');
  const [sdkReady, setSdkReady] = useState(false);
  useEffect(() => {
    let active = true;
    async function prepare() {
      const response = await fetch('/api/checkout');
      const configuration = await response.json();
      if (!response.ok || !configuration.configured) throw new Error(configuration.message || 'Cashfree is not configured. Please contact the store administrator.');
      await loadCashfreeSdk();
      if (active) setSdkReady(true);
    }
    prepare().catch(error => { if (active) setSdkError(error.message); });
    return () => { active = false; };
  }, []);

  // Handle coupon application
  const handleApplyCoupon = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!couponCode.trim() || !book) return;
    setCouponLoading(true);
    setCouponMessage(null);

    try {
      const res = await fetch('/api/coupons/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: couponCode.trim(),
          productId: book.id,
          email: email.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok && data.valid) {
        setAppliedCoupon({
          code: couponCode.trim().toUpperCase(),
          discountType: data.discountType,
          discountValue: data.discountValue,
          discountPaise: data.discountPaise || 0,
        });
        setCouponMessage({
          type: 'success',
          text: `Coupon applied: ?${(data.discountPaise / 100).toFixed(2)} off`,
        });
      } else {
        setAppliedCoupon(null);
        setCouponMessage({
          type: 'error',
          text: data.error?.message || data.reason || 'Invalid or expired coupon code.',
        });
      }
    } catch {
      setCouponMessage({
        type: 'error',
        text: 'Could not validate coupon. Please try again.',
      });
    } finally {
      setCouponLoading(false);
    }
  };

  // Calculations
  const listPriceRupees = book?.priceRupees ?? 0;
  const discountRupees = appliedCoupon
    ? appliedCoupon.discountPaise / 100
    : 0;
  const totalRupees = Math.max(0, listPriceRupees - discountRupees);

  // Form submit: Create real backend order and initiate Cashfree
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting || !book) return;

    const parsed = paymentCustomerSchema.safeParse({ fullName, email, phone });
    if (!parsed.success) {
      setFieldErrors(Object.fromEntries(parsed.error.issues.map((issue) => [issue.path[0], issue.message])));
      return;
    }
    setFieldErrors({});
    setSubmitting(true);
    setGeneralError(null);

    try {
      if (!book.id) throw new Error('Reload this page to load the selected book.');
      const Cashfree = await loadCashfreeSdk();
      setSdkReady(true); setSdkError('');
      const productId = book.id;

      // Create order through backend - server calculates pricing!
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId,
          ...parsed.data,
          couponCode: appliedCoupon?.code || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        if (data.error?.details?.fields) setFieldErrors(data.error.details.fields);
        throw new Error(data.error?.message || data.detail || 'Could not initialize order.');
      }

      // Check paymentSessionId from Cashfree
      const sessionId = data.paymentSessionId;
      if (sessionId && typeof window !== 'undefined' && window.Cashfree) {
        if (!['sandbox', 'production'].includes(data.paymentMode)) throw new Error('The payment environment could not be confirmed. Please try again.');
        const cf = Cashfree({ mode: data.paymentMode });
        const payment = await cf.checkout({
          paymentSessionId: sessionId,
          redirectTarget: '_self',
        });
        if (payment?.error) throw new Error(payment.error.message || 'Payment was not completed. Please try again.');
      } else {
        throw new Error('The payment service has not loaded. Please try again shortly.');
      }
    } catch (err: any) {
      setGeneralError(err.message || 'Payment initiation failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingBook) {
    return (
      <div className="storefront checkout-page">
        <Navbar />
        <main className="checkout-main">
          <div className="checkout-container text-center py-20">
            <LoaderCircle className="animate-spin mx-auto text-primary" size={36} />
            <p className="mt-4 text-muted-foreground text-sm">Preparing book checkout...</p>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (bookError || !book) {
    return (
      <div className="storefront checkout-page">
        <Navbar />
        <main className="checkout-main">
          <div className="checkout-container text-center py-16">
            <h1 className="text-2xl font-serif text-primary mb-3">Book Not Found</h1>
            <p className="text-muted-foreground mb-6">
              {bookError || 'The requested e-book is not currently available for checkout.'}
            </p>
            <Link href="/#bookshelf" className="shop-button">
              Explore the Bookshelf <ArrowRight size={16} />
            </Link>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="storefront checkout-page">
      <Navbar />
      <main className="checkout-main">
        <div className="checkout-container">
          <Link href="/#bookshelf" className="checkout-breadcrumb">
            <ArrowLeft size={15} /> Back to bookshelf
          </Link>

          <header className="checkout-header">
            <p className="eyebrow">Direct from Author Annu</p>
            <h1>Secure Checkout</h1>
          </header>

          <div className="checkout-grid">
            {/* Customer Details Form */}
            <div className="checkout-card">
              <h2>Customer details</h2>

              {sdkError && <p role="alert" className="checkout-notice error">{sdkError}</p>}
              {generalError && (
                <div className="checkout-notice error" role="alert">
                  <AlertCircle size={16} className="inline mr-1" />
                  {generalError}
                </div>
              )}

              <form className="checkout-form" onSubmit={handleSubmit} noValidate>
                <div className="checkout-field">
                  <label htmlFor="fullName">
                    Full name <span className="text-destructive">*</span>
                  </label>
                  <input
                    id="fullName"
                    type="text"
                    required
                    maxLength={80}
                    autoComplete="name"
                    className="checkout-input"
                    placeholder="e.g. Radhika Sharma"
                    value={fullName}
                    onChange={(e) => {
                      setFullName(e.target.value);
                      if (fieldErrors.fullName) setFieldErrors((prev) => ({ ...prev, fullName: undefined }));
                    }}
                  />
                  {fieldErrors.fullName && (
                    <span className="checkout-field-error">{fieldErrors.fullName}</span>
                  )}
                </div>

                <div className="checkout-field">
                  <label htmlFor="email">
                    Email address <span className="text-destructive">*</span>
                    <small className="ml-1">(Your e-book and receipt are sent here)</small>
                  </label>
                  <input
                    id="email"
                    type="email"
                    required
                    maxLength={254}
                    autoComplete="email"
                    className="checkout-input"
                    placeholder="radhika@example.com"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setAppliedCoupon(null);
                      setCouponMessage(null);
                      if (fieldErrors.email) setFieldErrors((prev) => ({ ...prev, email: undefined }));
                    }}
                  />
                  {fieldErrors.email && (
                    <span className="checkout-field-error">{fieldErrors.email}</span>
                  )}
                </div>

                <div className="checkout-field">
                  <label htmlFor="phone">
                    Phone number <span className="text-destructive">*</span><small> (Required by Cashfree)</small>
                  </label>
                  <input
                    id="phone"
                    required
                    type="tel"
                    autoComplete="tel"
                    className="checkout-input"
                    placeholder="9876543210"
                    maxLength={30}
                    value={phone}
                    onChange={(e) => {
                      setPhone(e.target.value);
                      setFieldErrors((previous) => ({ ...previous, phone: undefined }));
                    }}
                  />
                </div>

                {fieldErrors.phone && <span className="checkout-field-error">{fieldErrors.phone}</span>}

                <div className="checkout-field">
                  <label htmlFor="coupon">Have a discount coupon?</label>
                  <div className="checkout-coupon-row">
                    <input
                      id="coupon"
                      disabled={couponLoading}
                      type="text"
                      className="checkout-input uppercase"
                      placeholder="e.g. LAUNCH50"
                      value={couponCode}
                      onChange={(e) => { setCouponCode(e.target.value.toUpperCase()); setAppliedCoupon(null); setCouponMessage(null); }}
                    />
                    <button
                      type="button"
                      onClick={handleApplyCoupon}
                      disabled={couponLoading || !couponCode.trim()}
                    >
                      {couponLoading ? 'Checking…' : 'Apply'}
                    </button>
                  </div>
                  {couponMessage && (
                    <p className={`checkout-coupon-message ${couponMessage.type}`}>
                      {couponMessage.text}
                    </p>
                  )}
                </div>

                <button
                  type="submit"
                  className="checkout-pay-button"
                  disabled={submitting}
                >
                  {submitting ? (
                    <>
                      <LoaderCircle className="animate-spin" size={18} />
                      Connecting to Cashfree…
                    </>
                  ) : (
                    <>
                      <Lock size={16} /> Pay ₹{totalRupees} via Cashfree
                    </>
                  )}
                </button>

                <p className="text-center text-xs text-muted-foreground mt-2">
                  <Lock size={12} className="inline mr-1" /> 256-bit SSL encrypted. Supports UPI, Cards, NetBanking.
                </p>
              </form>
            </div>

            {/* Order Summary */}
            <div className="checkout-card">
              <h2>Order summary</h2>

              <div className="checkout-book-summary">
                <div className="checkout-book-cover">
                  <BookCover
                    src={book.coverImage}
                    alt={`${book.title} cover`}
                    fill
                    sizes="90px"
                    priority
                  />
                </div>
                <div className="checkout-book-details">
                  <span className="book-genre">{book.category}</span>
                  <h3>{book.title}</h3>
                  <p className="book-subtitle">{book.subtitle} · {book.pageCount} pages</p>
                  <span className="book-format">
                    <Sparkles size={12} /> DRM-Free PDF
                  </span>
                </div>
              </div>

              <div className="checkout-price-breakdown">
                <div className="checkout-price-row">
                  <span>E-book price</span>
                  <span>₹{listPriceRupees}</span>
                </div>
                {appliedCoupon && discountRupees > 0 && (
                  <div className="checkout-price-row discount">
                    <span>Coupon ({appliedCoupon.code})</span>
                    <span>- ₹{discountRupees}</span>
                  </div>
                )}
                <div className="checkout-price-row">
                  <span>Delivery</span>
                  <span>Instant (Email & Download)</span>
                </div>
              </div>

              <div className="checkout-price-total">
                <span>Total amount</span>
                <span>₹{totalRupees}</span>
              </div>

              <div className="checkout-guarantees">
                <div className="checkout-guarantee-item">
                  <CheckCircle2 size={16} />
                  <span>Instant verified PDF download upon payment</span>
                </div>
                <div className="checkout-guarantee-item">
                  <CheckCircle2 size={16} />
                  <span>Direct receipt and download link emailed to you</span>
                </div>
                <div className="checkout-guarantee-item">
                  <ShieldCheck size={16} />
                  <span>Official Cashfree secure gateway transaction</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-background">
          <LoaderCircle className="animate-spin text-primary" size={32} />
        </div>
      }
    >
      <CheckoutInner />
    </Suspense>
  );
}
