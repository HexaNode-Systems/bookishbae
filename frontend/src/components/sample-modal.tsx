'use client';

import { Book } from '@/lib/books';
import { useState } from 'react';
import { fetchSamplePdf } from '@/lib/sample-download';
import { ArrowRight, BookOpen, Download } from 'lucide-react';
import { CustomerDialog } from '@/components/customer-dialog';

interface SampleModalProps {
  book: Book | null;
  isOpen: boolean;
  onClose: () => void;
  onBuyNow: (book: Book) => void;
}

export function SampleModal({
  book,
  isOpen,
  onClose,
  onBuyNow,
}: SampleModalProps) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!book || !isOpen) return null;
  const download = async () => {
    setDownloading(true);
    setError(null);
    try {
      const { blob, filename } = await fetchSamplePdf(book);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'The sample could not be downloaded.');
    } finally {
      setDownloading(false);
    }
  };
  const buy = () => {
    onClose();
    onBuyNow(book);
  };
  return (
    <CustomerDialog
      open={isOpen}
      onClose={onClose}
      titleId="sample-title"
      descriptionId="sample-description"
      wide
    >
      <header className="sample-header">
        <p className="eyebrow">
          <BookOpen size={15} aria-hidden="true" /> A LITTLE LOOK INSIDE
        </p>
        <h2 id="sample-title">{book.title}</h2>
        <p id="sample-description">
          {book.subtitle} · A free opening sample by Annu
        </p>
      </header>
      <div className="sample-prose">
        {!book.sampleText.length && <p>No reading preview has been added for this book yet. You can still request its free sample PDF below.</p>}
        {book.sampleText.map((section) => (
          <section key={section.heading}>
            <h3>{section.heading}</h3>
            {section.paragraphs.map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </section>
        ))}
      </div>
      <div className="sample-ending">
        {book.sampleText.length > 0 && <span className="eyebrow">END OF THE SAMPLE</span>}
        <h3>There’s more to the story.</h3>
        <p>Continue with the full {book.pageCount}-page PDF edition.</p>
        <div className="button-row">
          <button className="shop-button" onClick={buy}>
            Buy full book · ₹{book.priceRupees}{' '}
            <ArrowRight size={16} aria-hidden="true" />
          </button>
          <button
            className="shop-button shop-button-outline"
            onClick={download}
            disabled={downloading}
          >
            <Download size={16} aria-hidden="true" /> {downloading ? 'Downloading…' : 'Download sample'}
          </button>
        </div>
        {error && <p role="alert">{error}</p>}
      </div>
    </CustomerDialog>
  );
}
