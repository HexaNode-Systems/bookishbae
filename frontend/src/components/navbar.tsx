'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowUpRight, Menu, X } from 'lucide-react';

const links = [
  ['/#bookshelf', 'The bookshelf'],
  ['/#author', 'About Annu'],
  ['/#reviews', 'Reader reviews'],
  ['/#faq', 'FAQs'],
];

export function Navbar() {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && open) {
        setOpen(false);
        toggle.current?.focus();
      }
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [open]);
  return (
    <header className="shop-header">
      <div className="shop-container header-inner">
        <Link href="/" className="shop-brand" aria-label="BookishBae home">
          <Image
            src="/assets/BookishBae logo on transparent background-1.png"
            alt="BookishBae — Stories by Annu"
            width={2172}
            height={724}
            sizes="(max-width: 760px) 174px, 204px"
            priority
            className="brand-logo"
          />
        </Link>
        <nav className="desktop-nav" aria-label="Main navigation">
          {links.map(([href, label]) => (
            <a href={href} key={href}>
              {label}
            </a>
          ))}
        </nav>
        <a href="/#bookshelf" className="header-cta">
          Find your next read <ArrowUpRight size={16} aria-hidden="true" />
        </a>
        <button
          ref={toggle}
          className="mobile-toggle"
          aria-label={open ? 'Close navigation' : 'Open navigation'}
          aria-expanded={open}
          aria-controls="mobile-navigation"
          onClick={() => setOpen(!open)}
        >
          {open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
        </button>
      </div>
      {open && (
        <nav
          id="mobile-navigation"
          className="mobile-nav shop-container"
          aria-label="Mobile navigation"
        >
          {links.map(([href, label]) => (
            <a key={href} href={href} onClick={() => setOpen(false)}>
              {label}
              <ArrowUpRight size={16} aria-hidden="true" />
            </a>
          ))}
        </nav>
      )}
    </header>
  );
}
