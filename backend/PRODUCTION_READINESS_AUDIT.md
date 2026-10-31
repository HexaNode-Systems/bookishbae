# BookishBae backend audit and production readiness

**Audit date:** 2026-10-30  
**Scope:** source archive supplied in this conversation; static review and local automated checks. No production services were contacted intentionally after test isolation was added, and no migrations were run against a Supabase project.

## Changes made

- Made backend `NODE_ENV` mandatory. A missing value can no longer default to development and accidentally enable development admin preview auth.
- Removed production dependence on a checked-in/local `.env.local` at startup. The host must inject runtime configuration.
- Capped standalone HTTP request bodies at 6 MiB (covers the documented 5 MiB cover upload plus multipart framing), added request/header/keep-alive timeouts, and stopped constructing request URLs from untrusted `Host` and forwarded-protocol headers.
- Made the production Next.js build require a valid HTTPS `BACKEND_URL`; localhost remains the local-development default only.
- Added fail-closed behavior when Supabase is unavailable in production. The process-local fixture catalogue, simulated Cashfree checkout, in-memory orders, entitlements, webhook ledger, and coupon fixtures remain for development/tests only.
- Checked Cashfree order amount and currency against the stored integer-paise total before payment verification or webhook fulfillment.
- Persisted successful payment details idempotently after the payment-state RPC, and stopped confirmation emails when the order transition fails.
- Added stable Cashfree refund identifiers so retrying the same admin refund request does not create a new provider refund id each time.
- Disabled Cashfree and Brevo network calls in automated test mode and added a local Supabase stub, so tests do not read local credentials or contact live services.
- Disabled the stale Razorpay webhook endpoint with HTTP 410. It no longer accepts a Cashfree secret as a Razorpay secret or claims fulfillment occurred.
- Added migration `0005_cashfree_faq.sql` to fix previously seeded payment-method copy and `0006_admin_dashboard_metrics.sql` for database-backed dashboard aggregates.
- Regenerated the npm lockfile so `npm ci` works with the frontend/backend workspaces.
- Updated workspace environment templates, setup/testing documentation, and production deployment notes.

## Important source discrepancy

The implementation report supplied earlier described authorization through an `admin_users` table. The archive does not define that table. The current handler authorizes admin API access using `profiles.role = 'admin'`; the migrations restrict browser updates to that role and bootstrap an initial admin from the private site setting. The report should not be treated as proof that an `admin_users` table is checked.

## Automated verification

Verified from the project root:

```bash
npm ci
npm test
npm run typecheck
npm run lint
BACKEND_URL=https://api.example.com SKIP_ENV_VALIDATION=true npm run build
```

Results: `npm ci` succeeded; `npm test` passed 26/26 tests; typecheck and lint passed; the optimized Next.js production build succeeded. `SKIP_ENV_VALIDATION=true` was used only for compilation because production secrets are not available in this environment.

The build command above skips server-secret validation only for compilation. Production runtime startup still validates all required backend environment variables. The SQL migration/security suite and live provider behavior require owner-controlled infrastructure and were not exercised here.

## Required before launch

1. The supplied ZIP included local `.env.local` files with non-placeholder-looking provider credentials. Rotate every credential contained in those files before production use (Supabase service-role key, Cashfree keys, Cloudinary secret, Brevo key, and any other private values). Do not put the originals into the cleaned project archive or source control.
2. Set production backend `NODE_ENV=production`; configure the frontend with `BACKEND_URL=https://<api-host>`.
3. Review the admin email in migration `0004_bootstrap.sql`, then apply migrations `0001` through `0006` in order to the intended Supabase project. Run `backend/supabase/tests/security.sql` only against a disposable/test database.
4. Configure Cashfree's webhook URL as `https://<api-host>/api/webhooks/cashfree`; verify the Brevo sender; confirm Cloudinary private-file and upload configuration.
5. Complete Cashfree sandbox purchases, failed payments, webhook replay, amount mismatch, refunds, entitlement revocation, expiring download links, and email delivery before switching to live keys.
6. Add operational alerting/reconciliation for provider/database failures. Cashfree and Supabase cannot participate in one database transaction; a provider refund may be accepted while a subsequent database write is unavailable. The stable refund ID makes retry safer, but reconciliation is still needed.

## Readiness conclusion

The code now fails closed on the audited production-mode and data-fallback hazards, and the repository is packaged without local credentials. It is **deployment-configurable, but not launch-certified** until the owner rotates the shared credentials, applies and verifies migrations, and completes sandbox/provider checks. The available environment had no local PostgreSQL or Docker service, so migration execution was not verified.
