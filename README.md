# BookishBae

BookishBae is a premium e-book storefront for author Annu. The repository is split into a Next.js customer/admin frontend and a standalone Node.js API backend. Database operations use direct PostgreSQL (`pg`); Supabase Auth, Cloudinary, Cashfree, and Brevo retain their existing integrations.

## Repository layout

- `frontend/` — storefront, customer account, and admin interface (Next.js 14)
- `backend/` — API server, auth and authorization, payment/webhook handling, database access, and Supabase migrations
- `backend/supabase/migrations/` — ordered SQL migrations
- `backend/tests/` — API/security integration tests

## Local development

Use Node.js 20.11 or newer.

```bash
npm install
cp frontend/.env.example frontend/.env.local
cp backend/.env.example backend/.env.local
```

Fill both files with public Supabase project values. Keep `DATABASE_URL`, Auth service-role credentials and integration secrets on the backend. Keep `NODE_ENV=development` only in local files. Start the API and frontend in separate terminals:

```bash
npm run dev:backend
npm run dev:frontend
```

The frontend sends `/api/*` requests to `BACKEND_URL` (local default: `http://localhost:5000`). Production requires an HTTPS backend URL.

## Verification

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

Backend tests apply all migrations to an isolated PGlite PostgreSQL engine and stub Supabase Auth, storage and Cashfree. They reject PostgREST calls and do not read `.env.local` or contact production services. See [database setup and admin seed](backend/docs/DATABASE.md) for configuration and real PostgreSQL verification.

## Production deployment checklist

1. Deploy the backend with `NODE_ENV=production`, production Supabase/Cashfree/Cloudinary/Brevo credentials, and the correct `NEXT_PUBLIC_SITE_URL`.
2. Deploy the frontend with the same public Supabase/site values and `BACKEND_URL=https://<your-api-host>`.
3. Review and manually apply pending migrations through `0008_direct_postgres_admin.sql` in order. Existing installations apply only unapplied migrations. Configure backend `DATABASE_URL`, then run `npm run db:seed-admin` using private `ADMIN_BOOTSTRAP_EMAIL` and `ADMIN_BOOTSTRAP_PASSWORD` values. Do not edit historical bootstrap email SQL.
4. Configure the Cashfree webhook at `https://<your-api-host>/api/webhooks/cashfree` and verify the Brevo sender domain.
5. Run the SQL security suite against a disposable database, then complete sandbox checkout, webhook replay, refund, and download tests before enabling live Cashfree credentials.
6. Set monitoring/alerts for API 5xx responses, webhook failures, payment mismatches, and database availability. The application intentionally fails closed in production when its database is unavailable.

Do not copy real credentials into this repository or the distributed source archive. If a credential-bearing local env file has been shared, rotate those credentials before production use.
