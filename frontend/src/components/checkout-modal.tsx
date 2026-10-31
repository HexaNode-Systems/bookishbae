'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Image from 'next/image';
import { Book } from '@/lib/books';
import { ArrowRight, Check, Download, LoaderCircle } from 'lucide-react';
import { CustomerDialog } from '@/components/customer-dialog';

interface CheckoutModalProps {
  book: Book | null;
  isOpen: boolean;
  onClose: () => void;
}

export function CheckoutModal(props: CheckoutModalProps) {
  // A fresh form for each opening also prevents one book's order state leaking to another.
  if (!props.book || !props.isOpen) return null;
  return (
    <CheckoutForm
      key={props.book.slug}
      book={props.book}
      onClose={props.onClose}
    />
  );
}

function CheckoutForm({ book, onClose }: { book: Book; onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [processing, setProcessing] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const nameInput = useRef<HTMLInputElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (completed) title.current?.focus();
  }, [completed]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (processing) return;
    if (!fullName.trim()) {
      setError('Enter your full name to continue.');
      nameInput.current?.focus();
      return;
    }
    setError('');
    setProcessing(true);
    // Preserve the existing preview-only checkout. No payment API exists in this checkout.
    timer.current = setTimeout(() => {
      setProcessing(false);
      setCompleted(true);
    }, 1200);
  };

  const download = async () => {
    setDownloading(true);
    setError('');
    try {
      // Retain the existing delivery URL, with an understandable failure state.
      const response = await fetch(book.samplePdfUrl.replace('-sample', ''), {
        signal: AbortSignal.timeout(15000),
      });
      if (
        !response.ok ||
        !response.headers.get('content-type')?.includes('application/pdf')
      )
        throw new Error('unavailable');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `${book.slug}.pdf`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError(
        'The e-book file is not available in this preview. You can still read or download its free sample. For help, email admin@appnix.info.',
      );
    } finally {
      setDownloading(false);
    }
  };

  return (
    <CustomerDialog
      open
      onClose={onClose}
      titleId="checkout-title"
      descriptionId="checkout-description"
    >
      <div className="checkout-content">
        <p className="eyebrow">
          {completed ? 'THANK YOU FOR EXPLORING' : 'YOUR NEXT READ'}
        </p>
        <h2 id="checkout-title" ref={title} tabIndex={-1}>
          {completed ? 'Checkout preview complete.' : 'Make room for a story.'}
        </h2>
        <p id="checkout-description" className="dialog-description">
          {completed
            ? 'No payment was taken and no receipt or book email was sent.'
            : 'Review your book and enter your details below.'}
        </p>
        <div className="checkout-book">
          <div className="checkout-cover">
            <Image
              src={book.coverImage}
              alt={`${book.title} cover`}
              fill
              sizes="60px"
            />
          </div>
          <div>
            <h3>{book.title}</h3>
            <p>
              {book.subtitle} · {book.pageCount} pages
            </p>
            <span>DRM-free PDF</span>
          </div>
          <strong>₹{book.priceRupees}</strong>
        </div>
        {!completed ? (
          <form
            onSubmit={submit}
            className="checkout-form"
            aria-busy={processing}
          >
            <div className="preview-notice">
              Preview checkout: payments are simulated. No charge will be made.
            </div>
            <div>
              <label htmlFor="buyer-name">
                Full name <span>(required)</span>
              </label>
              <input
                ref={nameInput}
                id="buyer-name"
                name="name"
                autoComplete="name"
                required
                maxLength={120}
                placeholder="Your full name"
                value={fullName}
                onChange={(event) => {
                  setFullName(event.target.value);
                  setError('');
                }}
                aria-invalid={!!error && !fullName.trim()}
                aria-describedby={error ? 'checkout-error' : undefined}
                disabled={processing}
              />
            </div>
            <div>
              <label htmlFor="buyer-email">
                Email address <span>(required)</span>
              </label>
              <input
                id="buyer-email"
                name="email"
                type="email"
                autoComplete="email"
                required
                maxLength={254}
                placeholder="you@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                aria-describedby="buyer-email-help"
                disabled={processing}
              />
              <p id="buyer-email-help" className="field-help">
                Use the email address you want associated with your order.
              </p>
            </div>
            <div>
              <label htmlFor="buyer-phone">
                Phone number <span>(optional, for UPI)</span>
              </label>
              <input
                id="buyer-phone"
                name="tel"
                type="tel"
                autoComplete="tel"
                maxLength={30}
                placeholder="Your phone number"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                disabled={processing}
              />
            </div>
            <div className="checkout-total">
              <span>Total</span>
              <strong>₹{book.priceRupees}</strong>
            </div>
            {error && (
              <p id="checkout-error" className="form-error" role="alert">
                {error}
              </p>
            )}
            <button
              type="submit"
              className="shop-button checkout-submit"
              disabled={processing}
            >
              {processing ? (
                <>
                  <LoaderCircle
                    size={17}
                    className="loading-spinner"
                    aria-hidden="true"
                  />{' '}
                  Preparing preview…
                </>
              ) : (
                <>
                  Preview purchase · ₹{book.priceRupees}{' '}
                  <ArrowRight size={16} aria-hidden="true" />
                </>
              )}
            </button>
            <p className="checkout-footnote" role="status">
              {processing
                ? 'Please wait while the checkout preview completes.'
                : 'Cashfree payment methods listed in the FAQs are not connected to this preview.'}
            </p>
          </form>
        ) : (
          <div className="checkout-result">
            <p className="preview-notice">
              <Check size={16} aria-hidden="true" /> Preview completed for{' '}
              {fullName.trim()}.
            </p>
            <dl>
              <div>
                <dt>Email</dt>
                <dd>{email}</dd>
              </div>
              <div>
                <dt>Book price</dt>
                <dd>₹{book.priceRupees}</dd>
              </div>
              <div>
                <dt>Payment</dt>
                <dd>Not charged</dd>
              </div>
            </dl>
            <button
              className="shop-button checkout-submit"
              onClick={download}
              disabled={downloading}
            >
              <Download size={16} aria-hidden="true" />
              {downloading ? 'Checking download…' : 'Try e-book download'}
            </button>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <a
              className="shop-button shop-button-outline checkout-submit"
              href={book.samplePdfUrl}
              download
            >
              Download free sample
            </a>
            <button onClick={onClose} className="text-action">
              Back to the bookshelf <ArrowRight size={16} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
    </CustomerDialog>
  );
}
