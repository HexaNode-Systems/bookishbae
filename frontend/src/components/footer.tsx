import Image from 'next/image';
import Link from 'next/link';
import { ArrowUpRight, Facebook, Instagram, Mail, Youtube } from 'lucide-react';

// Placeholder social URLs: replace these with BookishBae's actual profiles.
const socialLinks = [
  { name: 'Instagram', href: 'https://instagram.com/your-handle', Icon: Instagram },
  { name: 'Facebook', href: 'https://facebook.com/your-page', Icon: Facebook },
  { name: 'YouTube', href: 'https://youtube.com/@your-channel', Icon: Youtube },
];

export function Footer() {
  return (
    <footer className="shop-footer">
      <div className="shop-container">
        <div className="footer-grid">
          <div>
            <Link href="/" className="shop-brand" aria-label="BookishBae home">
              <Image
                src="/assets/BookishBae logo on transparent background-1.png"
                alt="BookishBae — Stories by Annu"
                width={2172}
                height={724}
                sizes="(max-width: 760px) 174px, 204px"
                className="brand-logo"
              />
            </Link>
            <p>
              Quiet, unhurried fiction by Annu.
              <br />
              For the stories you carry with you.
            </p>
          </div>
          <nav aria-label="Footer navigation">
            <h2>EXPLORE</h2>
            <a href="/#bookshelf">The bookshelf</a>
            <a href="/#author">About Annu</a>
            <a href="/#reviews">Reader reviews</a>
            <a href="/#faq">FAQs</a>
          </nav>
          <div>
            <h2>LET’S KEEP IN TOUCH</h2>
            <p>
              A question about a book or your order?
              <br />
              We’re an email away.
            </p>
            <a className="footer-email" href="mailto:annuy0635@gmail.com">
              <Mail size={16} aria-hidden="true" /> annuy0635@gmail.com{' '}
              <ArrowUpRight size={14} aria-hidden="true" />
            </a>
            <div className="footer-socials" role="group" aria-label="Follow BookishBae">
              {socialLinks.map(({ name, href, Icon }) => (
                <a
                  key={name}
                  href={href}
                  aria-label={`${name} (opens in a new tab)`}
                  title={name}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Icon size={18} aria-hidden="true" />
                </a>
              ))}
            </div>
          </div>
        </div>
        <div className="footer-bottom">
          <p>
            © {new Date().getFullYear()} BookishBae. All stories and rights
            reserved by Annu.
          </p>
          <span>For thoughtful readers, everywhere.</span>
          <p className="footer-attribution">
            Developed &amp; Designed by{' '}
            <a
              href="https://www.appnix.org"
              target="_blank"
              rel="noopener noreferrer"
            >
              Appnix Technologies
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}
