'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Navbar } from '@/components/navbar';
import { Footer } from '@/components/footer';
import {
  CheckCircle2,
  XCircle,
  Download,
  ArrowRight,
  RotateCcw,
  LoaderCircle,
  Mail,
  ShieldCheck,
  AlertTriangle,
} from 'lucide-react';
import '../checkout.css';
import '@/app/storefront.css';

function CheckoutReturnInner() {
  const searchParams = useSearchParams();
  const orderIdParam = searchParams.get('order_id') || searchParams.get('orderId');
  const retrySlug = searchParams.get('book');

  const [verificationAttempt, setVerificationAttempt] = useState(0);
  const [verifying, setVerifying] = useState(true);
  const [verified, setVerified] = useState(false);
  const [paid, setPaid] = useState(false);
  const [status, setStatus] = useState<string>('pending');
  const [orderNumber, setOrderNumber] = useState<string>('');
  const [orderId, setOrderId] = useState<string>('');
  const [downloadToken, setDownloadToken] = useState<string | null>(null);
  const [productId, setProductId] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);

  // Download states
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadSuccess, setDownloadSuccess] = useState(false);
  const [downloadsUsed, setDownloadsUsed] = useState<number | null>(null);
  const [downloadLimit, setDownloadLimit] = useState<number>(5);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    setVerifying(true);

    async function verifyOrder() {
      if (!orderIdParam) {
        if (active) {
          setVerifying(false);
          setErrorDetail('No order reference was provided in the return URL.');
        }
        return;
      }

      try {
        // Call server-to-server Cashfree verification endpoint
        const res = await fetch('/api/checkout/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId: orderIdParam }),
        });

        const data = await res.json();
        if (!active) return;

        if (res.ok && data.verified && data.paid) {
          setVerified(true);
          setPaid(true);
          setStatus('paid');
          setOrderNumber(data.orderNumber || orderIdParam);
          setOrderId(data.orderId || orderIdParam);
          setDownloadToken(data.downloadToken || null);
          setProductId(data.productId || null);
        } else {
          setVerified(Boolean(data.verified));
          setPaid(false);
          setStatus(data.status || 'pending');
          setOrderNumber(data.orderNumber || orderIdParam);
          const state = data.status || 'pending';
          setErrorDetail(data.message || (state === 'cancelled' ? 'Checkout was cancelled or expired. No e-book access has been granted.' : state === 'failed' ? 'The payment attempt failed. You can retry checkout.' : 'Payment is awaiting confirmation from Cashfree. Please check again shortly.'));
          if (state === 'pending' && attempts++ < 5) timer = setTimeout(verifyOrder, 3000);
        }
      } catch (err: any) {
        if (active) {
          setVerified(false);
          setPaid(false);
          setStatus('pending');
          setErrorDetail(err.message || 'Could not reach the payment verification server.');
        }
      } finally {
        if (active) setVerifying(false);
      }
    }

    verifyOrder();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [orderIdParam, verificationAttempt]);

  // Secure download trigger using server-issued claim token
  const handleDownload = async () => {
    if (downloading || !productId) return;
    setDownloading(true);
    setDownloadError(null);

    try {
      const res = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId,
          kind: 'full',
          token: downloadToken || undefined,
          orderId: orderId || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || data.error?.message || 'Could not generate download URL.');
      }

      if (data.url) {
        setDownloadSuccess(true);
        if (data.downloadsUsed !== undefined) setDownloadsUsed(data.downloadsUsed);
        if (data.downloadLimit !== undefined) setDownloadLimit(data.downloadLimit);

        // Initiate browser download
        const a = document.createElement('a');
        a.href = data.url;
        a.download = data.filename || 'bookishbae-ebook.pdf';
        a.target = '_blank';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } else {
        throw new Error('Download URL was empty.');
      }
    } catch (err: any) {
      setDownloadError(err.message || 'Download link generation failed. Please try again or check your email receipt.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="storefront checkout-page">
      <Navbar />
      <main className="checkout-main">
        <div className="checkout-container">
          {verifying ? (
            <div className="return-card">
              <div className="return-badge-icon pending">
                <LoaderCircle className="animate-spin text-accent" size={32} />
              </div>
              <h1>Verifying Payment</h1>
              <p className="return-subtitle">
                Please hold while we verify your transaction directly with the payment gateway…
              </p>
            </div>
          ) : paid ? (
            <div className="return-card">
              <div className="return-badge-icon success">
                <CheckCircle2 size={36} />
              </div>
              <h1>Payment Confirmed!</h1>
              <p className="return-subtitle">
                Your purchase is complete. Your e-book is ready for immediate download below.
              </p>

              <div className="return-order-info">
                <div>
                  <span>Order Number</span>
                  <strong>{orderNumber}</strong>
                </div>
                <div>
                  <span>Payment Status</span>
                  <strong className="text-emerald-700 uppercase">Paid & Verified</strong>
                </div>
              </div>

              {downloadError && (
                <div className="checkout-notice error text-left mb-4">
                  <AlertTriangle size={16} className="inline mr-1" />
                  {downloadError}
                </div>
              )}

              <div className="return-download-action">
                <button
                  type="button"
                  className="return-download-button"
                  onClick={handleDownload}
                  disabled={downloading}
                >
                  {downloading ? (
                    <>
                      <LoaderCircle className="animate-spin" size={18} />
                      Preparing your PDF…
                    </>
                  ) : (
                    <>
                      <Download size={18} />
                      {downloadSuccess ? 'Download PDF Again' : 'Download Your E-Book (PDF)'}
                    </>
                  )}
                </button>

                {downloadsUsed !== null && (
                  <p className="return-download-limit">
                    Downloaded {downloadsUsed} of {downloadLimit} allowed downloads
                  </p>
                )}
              </div>

              <div className="text-xs text-muted-foreground flex items-center justify-center gap-2 mt-4">
                <Mail size={14} className="text-accent" />
                <span>A permanent receipt and delivery link has also been sent to your email.</span>
              </div>

              <div className="return-footer-links">
                <Link href="/#bookshelf">
                  Browse more stories <ArrowRight size={14} className="inline ml-1" />
                </Link>
              </div>
            </div>
          ) : (
            <div className="return-card">
              <div className="return-badge-icon failed">
                <XCircle size={36} />
              </div>
              <h1>{status === 'pending' ? 'Payment pending' : status === 'cancelled' ? 'Payment cancelled' : status === 'failed' ? 'Payment failed' : 'Payment not confirmed'}</h1>
              <p className="return-subtitle">
                {errorDetail || 'Your payment was not completed or has been cancelled.'}
              </p>

              {orderNumber && (
                <div className="return-order-info">
                  <div>
                    <span>Order Reference</span>
                    <strong>{orderNumber}</strong>
                  </div>
                  <div>
                    <span>Status</span>
                    <strong className="text-rose-700 uppercase">{status}</strong>
                  </div>
                </div>
              )}

              <div className="return-footer-links">
                <button type="button" className="shop-button shop-button-outline" onClick={() => setVerificationAttempt(previous => previous + 1)}>Check payment again</button>
                <Link href={retrySlug ? `/checkout?book=${encodeURIComponent(retrySlug)}` : '/#bookshelf'} className="shop-button inline-flex items-center gap-2">
                  <RotateCcw size={16} /> {retrySlug ? 'Try Payment Again' : 'Choose a book'}
                </Link>
                <Link href="/#bookshelf" className="shop-button shop-button-outline">
                  Return to Storefront
                </Link>
              </div>
            </div>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}

export default function CheckoutReturnPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-background">
          <LoaderCircle className="animate-spin text-primary" size={32} />
        </div>
      }
    >
      <CheckoutReturnInner />
    </Suspense>
  );
}
