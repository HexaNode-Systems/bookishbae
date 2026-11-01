# Author commerce implementation and verification

## Current setup status

Apply `supabase/migrations/0007_author_commerce.sql` to the **intended Supabase
project**, after migrations 0001–0006. It has been validated against a disposable
PostgreSQL 17 database. Earlier verification found the connected project was
missing this migration. The latest backend logs show successful database order
creation, and follow-up live reads now confirm both `coupon_products` and
`products.sample_preview` are available.

The earlier missing-schema checks returned:

- `PGRST205` for `public.coupon_products`.
- `42703` for `products.sample_preview`.

New deployments still require migrations 0001–0007. The guest-download fix
below uses the existing schema and requires no additional migration or
environment variable. Do not run the local SQL test fixtures against the
connected project.

## Guest download failure and verification (2026-11-01)

The affected order was paid and had `user_id = null`. `/api/download` verified
the order and passed its email to `claimDownload`, but that function only
attempted the database RPC for UUID user IDs. Guest emails instead reached the
disabled staging fallback, causing the reported 500. The uploaded main/sample
file keys and payment were not the cause.

Guest claims now read the exact verified order from Supabase, validate its
identity, paid status and purchased product, and consume its counter with a
conditional update that matches the previous count and effective limit fields.
Competing requests reload and recheck limits. A final payment/identity check
refuses access and restores the slot if the order changes. Database failures
return an explicit 502 rather than falling back to test data. Signed-in claims
retain the existing atomic RPC; its `limit_reached` reason is normalized to the
API's download-limit reason. Failed quota-restoration RPCs now report errors.

Verification performed:

- `npm test`: 55 backend and 7 frontend tests passed, including 10 new guest
  download regressions. Tests cover persisted guest claims, product/token
  scope, pending/failed/cancelled/refunded orders, identity mismatch, limits,
  concurrent requests, changed admin overrides, refund races and database
  failures/restoration errors.
- `npm run typecheck`, `npm run lint`, and `npm run build`: passed. The build
  used `BOOKISHBAE_BUILD_DIR=.next-production-check` to preserve the dev cache.
- `npm run test:database`: passed against disposable PostgreSQL 17, including
  actual concurrent conditional updates for the final download slot and
  atomic quota restoration, alongside the existing author-commerce tests.
- Real Chrome request through the running frontend/backend: `/api/download`
  returned 200 JSON for the existing paid sandbox guest order. Its actual
  signed Cloudinary URL returned 200, `Content-Type: application/pdf`, and
  64,370 bytes beginning with `%PDF-`. The consumed counter persisted in
  Supabase. The verification slot was released afterward. No payment was made,
  and the check did not change order/payment status or uploaded files.

Repeat the live check from `backend` using an already-paid sandbox guest order:

```sh
node --env-file=.env.local --import tsx scripts/check-guest-download.mjs ORDER_UUID
```

The helper requires Cashfree `TEST` configuration, never submits a payment,
prints no credentials, token or private URL, and releases its verification slot.
Changed files for this fix: `src/lib/db/repository.ts`,
`src/lib/download-entitlement.ts`, `tests/download-entitlement.test.ts`,
`tests/run.ts`, `tests/run-postgres-tests.mjs`,
`scripts/check-guest-download.mjs`, and this report.

## Root causes and changes

### Cashfree

The browser proved that Cashfree's SDK posts a form to
`https://sandbox.cashfree.com/pg/view/sessions/checkout`. The previous CSP
`form-action 'self'` blocked that submission. The policy now permits only the
site itself and the sandbox/production gateway origins:
`https://sandbox.cashfree.com` and `https://api.cashfree.com`.

Checkout and its return page now render dynamically so the request's CSP nonce
can be attached to their scripts. The client waits for the real Cashfree SDK,
handles load/session errors, and uses the payment mode returned by the backend.
Cashfree requires a customer phone; application code no longer supplies a dummy
number. Cashfree credentials are required only by the backend, with a public
configuration response that exposes readiness and payment mode, not secrets.

`create_checkout_order` atomically reads the published book's database price,
revalidates the coupon, and creates the pending order and its item before
Cashfree is called. Browser-supplied prices/discounts are rejected. A missing or
invalid session and database/gateway failures produce errors, not simulated
success. The backend checks Cashfree order identity, amount, currency, order
status, and a successful payment record before fulfillment. The return page and
signed webhook both use server-to-server verification. Pending, cancelled and
failed payments grant no full-book access.

The return page polls pending payments briefly and offers another verification
attempt. If Cashfree confirms a payment but the database cannot finalize the
order, the response tells the reader to contact support and not pay again.

### Coupons

The admin has create/edit/enable/disable/delete controls, percentage and fixed
amounts, validity dates, global/per-customer usage limits, minimum order and
maximum discount settings, and scope for selected books or all books.
`coupon_products` extends the existing single-book schema without losing old
coupon relationships. Fixed amounts are stored in paise and displayed in rupees.
Toggle requests update only the enabled flag, preserving validity dates.

The old hardcoded coupon fallback has been removed from application behavior.
Invalid coupons stop order creation rather than being silently ignored. Coupon
validation uses the book's actual selling price and customer identity. The
atomic order transaction locks the coupon and reserves capacity for pending
checkouts for the gateway's 30-minute order lifetime. Redemptions and `times_used`
are recorded only by the paid-order transaction, once. Concurrent checkouts
cannot reserve the same final use. Paid-order guards also enforce global and
per-customer limits on late confirmations; an order that cannot be finalized
requires support review rather than false fulfillment.

Unused coupons can be deleted. Coupons with order history must be disabled to
preserve that history. Missing database tables/functions are shown as failures.

### Reading previews and categories

`products.sample_preview` stores author-entered headings and paragraphs. The
editor saves it through the authenticated product APIs; published product reads
return it. Database records never fall back to `BOOKS[].sampleText`. Missing
preview text produces an explicit empty state; the uploaded sample PDF remains
a separate feature.

Categories have authenticated CRUD APIs and admin controls. Forms and storefront
filters read database categories, and products store `category_id`. Renaming a
category preserves book relationships. API checks and a restrictive foreign key
prevent deleting a category still used by books. Uncategorized books have no
category relationship. Fresh bootstrap installs no longer insert dummy category
choices; existing database categories are preserved so authored data and book
relationships are not silently deleted. Review legacy starter categories in the
admin panel and reassign/delete them if unwanted.

## Exact verification performed

- `npm test`: **45 backend + 7 frontend tests passed**. Coverage includes admin
  authorization, category CRUD/filtering, preview persistence, coupon mutation
  and validation, price tampering, Cashfree session errors, authoritative payment
  verification, signed-but-unconfirmed webhooks, configuration secrecy, and CSP.
- `npm run typecheck`: both workspaces passed.
- `npm run lint`: passed without warnings or errors.
- The final production build, including the CSP fix, passed with
  `BOOKISHBAE_BUILD_DIR=.next-production-check`; checkout/return were listed as
  dynamically rendered routes.
- All migrations applied to a disposable PostgreSQL 17 cluster. The SQL test
  suite passed, including category deletion protection, preview data, coupon
  scope/caps/dates/customer limits, redemption timing/idempotency, and two
  simultaneous checkouts competing for the final coupon use.
- Real browser, real backend: new admin forms rendered, categories loaded from
  Supabase, the missing coupon migration displayed a database error, and the
  real Cashfree SDK loaded with no application JavaScript exceptions.
- Real Cashfree sandbox: credentials were accepted; an unpaid ₹1 probe order
  returned a real payment session, and server-to-server verification returned
  pending. With the CSP fix, the hosted form submission and `/checkout/` returned
  200 and the actual payment options rendered. No payment was submitted. The
  provider page emitted a favicon 404 and a manifest notice; no application CSP
  violation remained.
- At the initial checkout check, the missing 0007 order RPC stopped the request.
  Subsequent user logs show successful order creation and the guest-download
  check above used an existing paid order. **This agent has not completed a new
  end-to-end sandbox payment and return flow.** Hosted-form and existing-order
  download checks are not a substitute for that payment test.

### Repeating checks

```sh
npm test
npm run typecheck
npm run lint
npm run build
```

For the SQL tests, point `BOOKISHBAE_TEST_DATABASE_URL` at a disposable **local**
database with migrations 0001–0007 applied, then run `npm run test:database`.
The runner refuses remote database hosts.

After applying 0007, keep backend `CASHFREE_ENVIRONMENT=TEST` and use only
Cashfree sandbox payment data for the complete checkout test. A test helper can
open the real application checkout button:

```sh
cd frontend
node tests/open-real-sandbox.mjs
```

This helper checks the backend's sandbox mode and opens hosted checkout but
does not submit a payment. The separate backend
`scripts/check-cashfree-sandbox.ts` and `scripts/open-cashfree-sandbox.mjs`
verify an unpaid provider probe session, independently of the application order
transaction. No helper should be treated as a successful completed payment.

Integration references: [Cashfree hosted checkout](https://www.cashfree.com/docs/payments/online/web/redirect)
and [official sandbox test data](https://www.cashfree.com/docs/payments/online/resources/sandbox-environment).

## Main files

- Schema: `supabase/migrations/0007_author_commerce.sql` and the category portion
  of `0004_bootstrap.sql`.
- Backend: `src/lib/author-commerce.ts`, `cashfree.ts`,
  `payment-verification.ts`, `db/repository.ts`, validation/database types;
  category/coupon/product/checkout/webhook APIs and standalone routing.
- Frontend: admin coupon/category panels, workspace/book editor, product mapping,
  storefront category filters, sample modal, checkout pages/layout/SDK loader,
  server environment template, and `src/lib/content-security-policy.ts` with
  `src/middleware.ts`.
- Shared customer/payment validation, API/frontend tests, SQL transaction and
  concurrency tests, and explicit browser/sandbox diagnostics. Gateway transport
  doubles exist only in test infrastructure; application checkout always calls
  the real SDK.
