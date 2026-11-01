# Testing and production smoke checks

Run automated checks from the repository root:

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

The backend test runner supplies fake credentials, applies migrations 0001?0008 to an isolated PGlite PostgreSQL engine, and stubs only external Auth/storage/payment transports and pg connections. It rejects PostgREST calls. Tests never load local credentials or connect to a real project. See [DATABASE.md](DATABASE.md) for real PostgreSQL verification and manual login checks.

Before accepting live payments, run `supabase/tests/security.sql` against a disposable Supabase project/database with `ON_ERROR_STOP=1`. Apply migrations in order first. Never run the security fixture script against production.

## Cashfree sandbox smoke checks

- Complete a successful sandbox purchase and verify the order transitions from `pending` to `paid` once.
- Replay a Cashfree webhook event; the replay must not create a second payment or send duplicate fulfillment.
- Send a webhook with a bad signature and confirm it is rejected.
- Send an event whose amount or currency differs from the stored order; confirm no download access is granted and an alert is logged.
- Confirm checkout verification queries Cashfree directly and checks the amount and currency against the ledger.
- Test failed, abandoned, and duplicate payment events.
- Download a purchased e-book, then verify the signed URL expires and the download allowance is enforced.
- Refund a sandbox order and confirm that access is revoked.
- Confirm the retired Razorpay webhook responds with HTTP 410.

## Operational checks

- Confirm the production runtime explicitly sets `NODE_ENV=production`.
- Confirm the frontend has a valid HTTPS `BACKEND_URL` and can reach the API health endpoint.
- Confirm missing/invalid environment variables stop startup.
- Confirm PostgreSQL outage returns an error in every runtime mode; it must never switch to in-memory fixture orders or simulated payment sessions.
- Inspect logs for request IDs and redaction; do not log tokens, payment secrets, raw authorization headers, or private PDF URLs.
