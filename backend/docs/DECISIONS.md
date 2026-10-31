# Architecture decisions

Why the build departs from the brief in places, and why some choices that look
arbitrary are not. Each entry states the decision, the reasoning, and what it
costs — including where the cost falls on you later.

---

## 1. Watermarking is per-product and capped, not the default

**The brief asks for both** a short-lived signed Cloudinary URL *and* an optional
dynamic watermark of the buyer's email via pdf-lib. Those two are incompatible
as stated.

A presigned URL hands the buyer the stored object byte for byte. Watermarking
means the file has to pass through our code, which on Vercel means a serverless
function — and there the ceiling is real: a response body caps out around
4.5 MB, and loading a 100 MB PDF into pdf-lib needs several hundred megabytes of
heap. So "watermark every
download" and "100 MB books" cannot both be true.

**Decision.** Watermarking is a per-product flag (`products.watermark_enabled`),
off by default, with a hard size ceiling (`WATERMARK_MAX_BYTES`, default 20 MB).
When it is on and the file is under the ceiling, the first download generates a
stamped copy once, stores it under `watermarked/<product>/<order_item>.pdf` in
private Cloudinary storage, and signs *that*. Later downloads of the same purchase
reuse it. Above the ceiling, or with the flag off, the original is presigned
directly.

**Cost.** A watermarked title stores one extra object per buyer. The first
download of a watermarked book is slower than the rest. Annu has to decide,
per title, whether that is worth it.

---

## 2. Money is stored as integer paise, everywhere

The database and application ledger store prices as integer paise. Cashfree's
API takes rupees, so conversion happens at the gateway boundary through
`paiseToRupees()`; display formatting is the other boundary conversion.

`backend/src/lib/money.ts` is the canonical conversion helper. Columns are
`integer`, not `numeric` and never `float`.

**Cost.** Every price in the admin form needs a rupee-to-paise conversion at the
edge. That is one function call, and it is the right place for it.

---

## 3. "HSRF" in the brief is read as HSTS

The security list asks for "CSP, HSRF, X-Frame-Options". HSRF is not a header.
Taken as **HSTS** (`Strict-Transport-Security`), which is set in
`next.config.mjs` with a two-year max-age, `includeSubDomains` and `preload`.

CSRF — which may also have been meant — is covered separately: every mutating
API route requires a same-origin `Origin`/`Sec-Fetch-Site`, and only accepts
`application/json`, which a cross-site HTML form cannot produce without a
preflight that CORS then refuses. See `backend/src/lib/net.ts`.

---

## 4. Rate limiting on Postgres, not Upstash

The brief allows either. Postgres wins here on launch friction: one fewer
account to create, one fewer secret to rotate, one fewer thing to be down. The
implementation is a single upsert into `public.rate_limits` through
`consume_rate_limit()`, which is a fixed window rather than a sliding one.

**Cost.** A caller can burst up to 2× the limit across a window boundary, and
every check costs a database round trip. For a single-author shop both are
immaterial. If traffic ever makes them matter, `backend/src/lib/rate-limit.ts` is the
only file that changes.

**Related.** The limiter fails *open* by default, because a database hiccup
should not close the shop. Endpoints where the limit is itself a security
control — download, checkout, coupon validation — set `strict: true` and fail
*closed*, so an outage cannot be used as a way around the limit.

---

## 5. Private object keys are withheld by column grant, not by a filter

RLS controls rows; it cannot control columns. So `products.main_pdf_key` is
withheld from `anon` and `authenticated` with a `GRANT SELECT (...)` that simply
does not list it. Even an admin's browser session cannot read it — admin screens
that need keys go through the service role on the server.

A `products_public` view supplies the safe projection, and
`supabase/tests/security.sql` asserts that no column matching `%pdf_key%` has
crept into it.

**Cost.** `select *` on `products` fails for browser clients. That is the point.
Name your columns.

---

## 6. Guests can buy; accounts are claimed afterwards

`orders.user_id` is nullable, and the auth trigger backfills any order whose
email matches when that person later signs in. A buyer who checks out without an
account and signs in a week later finds the book already in their library.

**Cost.** Entitlement for a guest lives on the email address until they sign in.
The download endpoint requires a session, so a guest downloads from the
post-payment success page (which knows its own order) or follows the emailed
magic link. Email ownership is therefore the boundary, which is the same
boundary every e-book shop uses.

---

## 7. Fulfilment happens only in the webhook

The browser's "payment succeeded" callback is verified against an HMAC, and is
then used for exactly one thing: deciding what the success page says. The grant
of entitlement happens in `mark_order_paid()`, called from the signed webhook.

This means a buyer who closes the tab mid-redirect still gets their book, and an
attacker who forges the client callback gets a nice confirmation screen and
nothing else.

`mark_order_paid()` is idempotent and `webhook_events` has a unique constraint on
`(provider, event_id)`, because Cashfree will deliver the same event more than
once and a double-fulfilled order double-counts revenue.

---

## 8. Next.js 14.2, not 15

The brief says "Next.js 14+". 14.2 is chosen over 15 because `@supabase/ssr`,
`framer-motion` and the shadcn/ui primitives are all long-settled against React
18, and a store that has to take money next week is the wrong place to absorb a
major-version peer-dependency migration.

**Cost.** No React 19 features and no partial prerendering. Moving to 15 later
is a contained change: the cookie adapter in `backend/src/lib/supabase/server.ts` and the
`params`/`searchParams` signatures on pages.

---

## 9. Dark mode is class-based, not system-based

Covers and sample pages are designed on cream. Flipping the whole shop to near
black because of an OS setting the reader forgot about makes the artwork look
wrong. `.dark` tokens exist in `globals.css` and the class is opt-in.

---

## 10. CSP uses a per-request nonce with `strict-dynamic`

Set in `frontend/src/middleware.ts`, not `next.config.mjs`, because the nonce must be
fresh per request. `strict-dynamic` lets a nonced script load more scripts —
which is how Cashfree Checkout bootstraps — while an injected `<script>` in a
review body still gets nothing.

`style-src` has to carry `'unsafe-inline'`: Next and Framer Motion both write
inline styles and a nonce cannot cover a style attribute. That concession
permits styling, not execution.

---

## 11. Coupons are not readable by clients at all

No `SELECT` grant for `anon` or `authenticated`. Validation goes through
`validate_coupon()`, which is itself revoked from both roles and callable only
by `service_role` behind a rate-limited API route.

Without that, every coupon code in the store would be enumerable from the
browser, and the rate limit would be trivially bypassable by querying the table
directly.

---

## 12. The security model is tested, not asserted

`supabase/tests/security.sql` is 37 executable checks against a real database:
that the private key column is unreachable from every browser role, that a buyer
cannot read another buyer's order or promote themselves to admin, that the
download limit is exact, that a refund revokes access, that a replayed webhook
does not double-count, that drafts are invisible.

Run it against a throwaway database after any schema change:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/security.sql
```

A local Supabase stand-in for the `auth` schema and the three Supabase roles is
in `supabase/tests/_local_supabase_shim.sql`, so the suite can run against a
plain Postgres instance with no Supabase project at all.
