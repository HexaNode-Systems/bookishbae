# Cover, sample, and checkout verification

The product's `cover_key`, `sample_pdf_key`, and `main_pdf_key` are persisted in
`public.products`. Public/admin API responses derive the cover delivery URL from
the saved key on every read. Cloudinary image public IDs containing an extension
need a delivery format appended; the three exact local seed filenames continue
to resolve to storefront public assets. Uploaded keys never become local paths.

`POST /api/download` with `{ productId, kind: "sample" }` returns the selected
published book's sample bytes, PDF headers, and an attachment filename. It never
uses the full-book key. Cloudinary authenticated sample objects are read on the
server; exact local seed samples are fetched from `NEXT_PUBLIC_SITE_URL`.
Unavailable files and non-PDF responses produce JSON errors, which the modal
shows without creating a browser download. Full downloads keep their existing
payment/entitlement checks.

Checkout and its API share customer-field validation. Phone is optional and
accepts a ten-digit number with an optional Indian country prefix. Product ID,
title, cover, and price come from the product API, and payment verification
remains on the backend. Database/gateway failures cannot create simulated
checkout sessions outside tests or report successful catalogue writes.

## Required local setup

The connected development Supabase project returned `PGRST205` for
`public.products` during diagnosis. Apply the existing migrations
`0001_schema.sql` through `0006_admin_dashboard_metrics.sql`, in order, to the
intended project (see [SETUP.md](SETUP.md)), then configure the backend's matching
Supabase URL/service-role key. No new migration is required by this change.
Do not apply fixture SQL to a production database.

Keep `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET`
configured on the backend. Set `NEXT_PUBLIC_SITE_URL` to the storefront origin
so local seed samples can be fetched in split frontend/backend deployments.
Set the frontend's `BACKEND_URL` to the API origin and configure Cashfree's
matching environment and credentials before attempting a real payment.

Books previously reported as saved only to the development in-memory fallback
were never persisted in Supabase. Recreate those records after setup and upload
or reselect their own assets; the application cannot recover lost record keys
by guessing filenames. Existing persisted Cloudinary keys are resolved on read.

## Automated verification

From the repository root run `npm test`, `npm run typecheck`, `npm run lint`,
and `npm run build`. Tests use isolated credentials and storage/database
transports, including a new book upload followed by fresh database reads,
PDF byte/header checks, missing/corrupt sample errors, and checkout validation.

For a browser regression, run these in separate terminals:

```sh
cd backend
node --import tsx tests/browser-server.ts
```

```sh
cd frontend
node tests/browser-web.mjs
```

```sh
cd frontend
node tests/browser-smoke.mjs
```

The browser test uses local ports 3100/5100, test-only database/storage
transports, and a stub Cashfree SDK; it makes no real payment or database write.
It uploads and saves a new book through the admin UI, reloads admin/storefront,
downloads a PDF attachment, and submits customer details on checkout. It writes
network evidence and a screenshot into a temporary directory printed on success.
Set `CHROME_PATH` if Chrome is installed somewhere other than the default Windows
path. Stop both test servers afterward.

`BOOKISHBAE_BUILD_DIR` optionally isolates Next output from an existing dev
server, for example `.next-production-check` for a production verification build.
The normal default remains `.next`.

## Results from this change

- `npm test`: 37 backend tests and 5 frontend tests passed.
- `npm run typecheck`: both workspaces passed.
- `npm run lint`: no warnings or errors.
- `npm run build`, with `BOOKISHBAE_BUILD_DIR=.next-production-check`: passed,
  including `/`, `/admin`, `/checkout`, and `/checkout/return`.
- Headless Chrome: new admin upload/save, admin/storefront reloads, actual
  uploaded cover, failed-image fallback, PDF attachment bytes, missing-sample
  error without a download, checkout details/price/phone, header/footer styles
  and links all passed; no browser exceptions.
- Browser network evidence: sample `200 application/pdf`, missing sample
  `404 application/json`, checkout `200 application/json` against test transports.
  No live payment or connected-database write was attempted.

The original running app reproduced a cover `404` (the correctly formatted
Cloudinary URL returned `200 image/jpeg`), sample `404 text/html`, and checkout
`422` rejecting the unrecognized `phone` key. The read-only Supabase diagnostic
returned `PGRST205` for `public.products`.

## Files changed for these fixes

Backend:

- `src/lib/cloudinary.ts`, `src/lib/product-assets.ts`, `src/lib/sample-pdf.ts`
- `src/lib/db/repository.ts`, `src/lib/validation/schemas.ts`
- `src/api/admin/uploads/route.ts`, `src/api/admin/products/[id]/route.ts`
- `src/api/download/route.ts`, `src/api/checkout/route.ts`
- `tests/backend.test.ts`, `tests/run.ts`, `tests/storage-fixture.ts`,
  `tests/test-environment.ts`, `tests/browser-server.ts`
- This verification/setup document.

Frontend:

- `src/lib/books.ts`, `src/lib/product-book.ts`, `src/lib/sample-download.ts`
- `src/components/book-cover.tsx`, `src/components/admin/admin-workspace.tsx`,
  `src/components/admin/book-editor.tsx`, `src/components/storefront.tsx`,
  `src/components/sample-modal.tsx`
- `src/components/navbar.tsx`, `src/components/footer.tsx`
- `src/app/checkout/page.tsx`, `src/app/checkout/return/page.tsx`
- `public/cover-placeholder.svg`, `next.config.mjs`, `package.json`
- `tests/store-flows.test.tsx`, `tests/browser-smoke.mjs`, `tests/browser-web.mjs`

Repository root: `shared/customer-details.ts`, `package.json`, `.gitignore`.
