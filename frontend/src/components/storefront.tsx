'use client';

import { useEffect, useState } from 'react';
import { BookCover as StorefrontCover } from '@/components/book-cover';
import { mapProductToBook } from '@/lib/product-book';
import Link from 'next/link';
import type { Category } from '@/types/database';
import { Book, FAQS, TESTIMONIALS } from '@/lib/books';
import { Navbar } from '@/components/navbar';
import { Footer } from '@/components/footer';
import { SampleModal } from '@/components/sample-modal';
import {
  ArrowRight,
  BookOpen,
  Check,
  Download,
  Feather,
  Mail,
  Plus,
  Star,
} from 'lucide-react';
import '@/app/storefront.css';

function Price({ book }: { book: Book }) {
  return (
    <div className="book-price">
      <span>
        <span className="sr-only">Price </span>₹{book.priceRupees}
      </span>
      {book.originalPriceRupees && (
        <del>
          <span className="sr-only">Original price </span>₹
          {book.originalPriceRupees}
        </del>
      )}
    </div>
  );
}

export default function Storefront() {
  const [category, setCategory] = useState('all');
  const [sample, setSample] = useState<Book | null>(null);
  const [newsletterEmail, setNewsletterEmail] = useState('');
  const [subscribed, setSubscribed] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [catalogueError, setCatalogueError] = useState('');
  const [bookList, setBookList] = useState<Book[]>([]);

  useEffect(() => {
    let active = true;
    async function loadPublishedProducts() {
      try {
        const [res, categoryRes] = await Promise.all([fetch('/api/products?limit=60'), fetch('/api/categories')]);
        if (!res.ok || !categoryRes.ok) throw new Error('The bookshelf could not be loaded. Please try again shortly.');
        const data = await res.json();
        const categoryData = await categoryRes.json();
        if (active) { setBookList(data.products.map((product: any) => mapProductToBook(product))); setCategories(categoryData.categories); }
      } catch (error) {
        if (active) setCatalogueError((error as Error).message);
      } finally { if (active) setLoading(false); }
    }
    loadPublishedProducts();
    return () => {
      active = false;
    };
  }, []);

  const featured = bookList.find((book) => book.isFeatured) ?? bookList[0];
  const filtered =
    category === 'all'
      ? bookList
      : bookList.filter((book) => book.categoryId === category);
  if (!featured) return <div className="storefront"><Navbar /><main id="bookshelf" className="shop-container shop-section"><h1>The bookshelf</h1><p role={catalogueError ? 'alert' : 'status'}>{catalogueError || (loading ? 'Loading books?' : 'No books have been published yet.')}</p></main><Footer /></div>;

  return (
    <div className="storefront">
      <Navbar />
      <main id="main" tabIndex={-1}>
        <section className="hero-section" aria-labelledby="hero-title">
          <div className="shop-container hero-layout">
            <div className="hero-copy">
              <p className="eyebrow">
                <span className="small-rule" /> A LITTLE QUIET. A GOOD BOOK.
              </p>
              <h1 id="hero-title">
                Stories that
                <br />
                stay <em>with you.</em>
              </h1>
              <p className="hero-description">
                Quiet, unhurried fiction about the people we almost become.
                Discover Annu’s world of family, longing, and the things left
                unsaid.
              </p>
              <div className="button-row">
                <a href="#bookshelf" className="shop-button">
                  Explore the bookshelf{' '}
                  <ArrowRight size={17} aria-hidden="true" />
                </a>
                <button
                  onClick={() => setSample(featured)}
                  className="shop-button shop-button-outline"
                >
                  <BookOpen size={17} aria-hidden="true" /> Read a free sample
                </button>
              </div>
              <p className="hero-note">
                <Feather size={15} aria-hidden="true" /> Written by Annu. Read
                at your own pace.
              </p>
            </div>
            <div className="hero-feature">
              <div className="hero-book-stage">
                <span className="stage-caption">THE FEATURED READ</span>
                <div className="hero-cover">
                  <StorefrontCover
                    src={featured.coverImage}
                    alt={`${featured.title} by Annu — cover`}
                    fill
                    priority
                    sizes="(max-width: 600px) 210px, 250px"
                  />
                </div>
                <span className="stage-footnote">
                  {featured.subtitle} · {featured.pageCount} pages
                </span>
              </div>
              <div className="featured-summary">
                <div>
                  <p className="eyebrow">{featured.category}</p>
                  <h2>{featured.title}</h2>
                  <p>{featured.excerpt}</p>
                </div>
                <div className="featured-purchase">
                  <Price book={featured} />
                  <Link
                    href={`/checkout?book=${featured.slug}`}
                    className="text-action"
                  >
                    Buy e-book <ArrowRight size={16} aria-hidden="true" />
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="reading-strip">
          <div className="shop-container">
            <span>
              <BookOpen size={19} aria-hidden="true" /> Thoughtfully written.
              Beautifully typeset.
            </span>
            <span>
              <Download size={19} aria-hidden="true" /> DRM-free PDF editions
            </span>
            <span>
              <Feather size={19} aria-hidden="true" /> Direct from the author
            </span>
          </div>
        </div>

        <section
          id="bookshelf"
          className="shop-section"
          aria-labelledby="bookshelf-title"
        >
          <div className="shop-container">
            <div className="section-heading">
              <div>
                <p className="eyebrow">FIND YOUR NEXT READ</p>
                <h2 id="bookshelf-title">
                  A small shelf. <em>A world within.</em>
                </h2>
                <p>
                  Standalone stories, quiet discoveries, and a place to get
                  lost.
                </p>
              </div>
              <span className="collection-count">
                {bookList.length} titles by Annu
              </span>
            </div>
            <div className="catalogue-toolbar">
              <div
                className="book-filters"
                role="group"
                aria-label="Filter books by genre"
              >
                {([{ id: 'all', name: 'All books' }, ...categories]).map(({ id: slug, name: label }) => (
                  <button
                    key={slug}
                    aria-pressed={category === slug}
                    onClick={() => setCategory(slug)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="results-count" role="status">
                {filtered.length} {filtered.length === 1 ? 'book' : 'books'}
              </p>
            </div>
            <div className="books-grid">
              {filtered.map((book) => (
                <article
                  className="book-card"
                  key={book.slug}
                  aria-labelledby={`title-${book.slug}`}
                >
                  <button
                    className={`catalogue-cover cover-${book.categorySlug}`}
                    onClick={() => setSample(book)}
                    aria-label={`Read a free sample of ${book.title}`}
                  >
                    {book.isFeatured && (
                      <span className="featured-label">Featured read</span>
                    )}
                    <span className="cover-image">
                      <StorefrontCover
                        src={book.coverImage}
                        alt={`${book.title} book cover`}
                        fill
                        sizes="(max-width: 600px) 180px, 190px"
                      />
                    </span>
                    <span className="cover-preview">
                      Take a look inside{' '}
                      <ArrowRight size={14} aria-hidden="true" />
                    </span>
                  </button>
                  <div className="book-information">
                    <div className="book-meta">
                      <span>{book.category}</span>
                      <span className="book-rating">
                        <Star
                          size={13}
                          fill="currentColor"
                          aria-hidden="true"
                        />
                        <span className="sr-only">Rated </span>
                        {book.rating}
                        <span className="sr-only"> out of 5</span>
                        <span>
                          ({book.reviewCount}
                          <span className="sr-only"> reviews</span>)
                        </span>
                      </span>
                    </div>
                    <h3 id={`title-${book.slug}`}>{book.title}</h3>
                    <p className="book-subtitle">
                      {book.subtitle} <span aria-hidden="true">·</span>{' '}
                      {book.pageCount} pages
                    </p>
                    <p className="book-excerpt">{book.excerpt}</p>
                    <div className="book-price-row">
                      <Price book={book} />
                      <span>PDF e-book</span>
                    </div>
                    <div className="book-actions">
                      <Link
                        href={`/checkout?book=${book.slug}`}
                        className="shop-button"
                        aria-label={`Buy ${book.title} for ₹${book.priceRupees}`}
                      >
                        Buy e-book <ArrowRight size={15} aria-hidden="true" />
                      </Link>
                      <button
                        className="shop-button shop-button-outline"
                        onClick={() => setSample(book)}
                        aria-label={`Free sample of ${book.title}`}
                      >
                        <BookOpen size={15} aria-hidden="true" /> Free sample
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section
          id="author"
          className="author-section shop-section"
          aria-labelledby="author-title"
        >
          <div className="shop-container author-layout">
            <div className="author-art" aria-hidden="true">
              <span className="eyebrow">THE PERSON BEHIND THE PAGES</span>
              <span className="author-monogram">
                A<span>.</span>
              </span>
              <Feather size={35} strokeWidth={1} />
              <span className="author-signature">Annu</span>
              <span className="author-art-caption">
                Stories from the quiet corners of life.
              </span>
            </div>
            <div className="author-copy">
              <p className="eyebrow">A NOTE ABOUT THE AUTHOR</p>
              <h2 id="author-title">
                Meet <em>Annu.</em>
              </h2>
              <p>
                Annu has been writing since a school notebook she still refuses
                to show anyone. Her stories tend to begin with a single
                overheard sentence and end somewhere she did not plan.
              </p>
              <p>
                She writes about longing, family, and the quiet rooms where
                decisions get made — the moment two sisters look at an old
                envelope, or the eleven years of politeness that keep a marriage
                still.
              </p>
              <p>
                She lives in India, reads mostly in translation, and distributes
                her books directly to readers without middleman markups.
              </p>
              <a href="#bookshelf" className="text-action">
                Discover her stories <ArrowRight size={17} aria-hidden="true" />
              </a>
            </div>
          </div>
        </section>

        <section
          id="reviews"
          className="shop-section"
          aria-labelledby="reviews-title"
        >
          <div className="shop-container">
            <div className="section-heading centered">
              <p className="eyebrow">BETWEEN THE LAST PAGE & THE NEXT BOOK</p>
              <h2 id="reviews-title">
                A few words <em>from readers.</em>
              </h2>
            </div>
            <div className="reviews-grid">
              {TESTIMONIALS.map((item) => (
                <figure className="reader-review" key={item.author}>
                  <div
                    className="review-stars"
                    aria-label={`${item.rating} out of 5 stars`}
                  >
                    {Array.from({ length: item.rating }, (_, index) => (
                      <Star
                        key={index}
                        size={14}
                        fill="currentColor"
                        aria-hidden="true"
                      />
                    ))}
                  </div>
                  <blockquote>“{item.quote}”</blockquote>
                  <figcaption>
                    <span className="reader-initial" aria-hidden="true">
                      {item.author[0]}
                    </span>
                    <div>
                      <strong>{item.author}</strong>
                      <span>{item.location}</span>
                    </div>
                  </figcaption>
                  <p className="review-book">
                    On <cite>{item.book}</cite>
                  </p>
                </figure>
              ))}
            </div>
          </div>
        </section>

        <section
          id="faq"
          className="faq-section shop-section"
          aria-labelledby="faq-title"
        >
          <div className="shop-container faq-layout">
            <div>
              <p className="eyebrow">BEFORE YOU TURN THE PAGE</p>
              <h2 id="faq-title">
                A little clarity.
                <br />
                <em>More reading.</em>
              </h2>
              <p>
                Questions about your e-books?
                <br />
                Here’s what you need to know.
              </p>
              <a href="mailto:admin@appnix.info" className="text-action">
                Ask us a question <ArrowRight size={16} aria-hidden="true" />
              </a>
            </div>
            <div className="faq-list">
              {FAQS.map((faq, index) => (
                <details
                  key={faq.question}
                  open={index === 0 ? true : undefined}
                >
                  <summary>
                    {faq.question}
                    <Plus size={18} aria-hidden="true" />
                  </summary>
                  <p>{faq.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section id="newsletter" className="newsletter-section">
          <div className="shop-container">
            <div className="newsletter-panel">
              <div>
                <p className="eyebrow">
                  <Mail size={15} aria-hidden="true" /> LETTERS FROM ANNU
                </p>
                <h2>
                  A little more story
                  <br />
                  <em>in your inbox.</em>
                </h2>
                <p>
                  Join Annu’s Reader Circle for unreleased short stories,
                  private reading notes, and news of the next novella.
                </p>
              </div>
              <div className="newsletter-form-area">
                {!subscribed ? (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (newsletterEmail.trim()) setSubscribed(true);
                    }}
                  >
                    <label htmlFor="newsletter-email">Your email address</label>
                    <div className="newsletter-input-row">
                      <input
                        id="newsletter-email"
                        name="email"
                        type="email"
                        autoComplete="email"
                        required
                        maxLength={254}
                        placeholder="you@example.com"
                        value={newsletterEmail}
                        onChange={(event) =>
                          setNewsletterEmail(event.target.value)
                        }
                        aria-describedby="newsletter-note"
                      />
                      <button className="shop-button" type="submit">
                        Join the circle{' '}
                        <ArrowRight size={16} aria-hidden="true" />
                      </button>
                    </div>
                    <p id="newsletter-note">
                      Preview signup only. Subscriptions are not saved or
                      emailed.
                    </p>
                  </form>
                ) : (
                  <div className="newsletter-success" role="status">
                    <Check size={24} aria-hidden="true" />
                    <div>
                      <strong>Thank you for your interest.</strong>
                      <p>
                        This preview received your email. A subscription has not
                        been created.
                      </p>
                      <button
                        className="text-action"
                        onClick={() => setSubscribed(false)}
                      >
                        Use another email
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      </main>
      <Footer />
      <SampleModal
        book={sample}
        isOpen={Boolean(sample)}
        onClose={() => setSample(null)}
        onBuyNow={(book) => {
          setSample(null);
          window.location.assign(`/checkout?book=${book.slug}`);
        }}
      />
    </div>
  );
}
