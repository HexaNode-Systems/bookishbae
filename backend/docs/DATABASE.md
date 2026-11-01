# PostgreSQL and admin setup

All database reads/writes run on the backend through `pg`. Supabase Auth still owns login, sessions, JWT verification and password hashes; storage integrations are unchanged. No PostgREST or in-memory database fallback exists.

1. Copy `backend/.env.example` to `backend/.env.local`. In Supabase **Connect**, obtain the direct PostgreSQL URI or session-pooler URI for the same project as Auth. Store it privately as `DATABASE_URL`; URL-encode special characters in the database password. Use a server-only database role with the required public table, sequence and function privileges (the project's `postgres` connection works). Do not give this URI to browsers.
2. Keep `DATABASE_SSL_MODE=verify-full` (default). Certificate verification is always enabled for remote databases. If required, set `DATABASE_SSL_CA` to the project's CA PEM. Set `DATABASE_POOL_MAX` (default 10, range 1–50) to fit the total connection budget across API instances. `DATABASE_SSL_MODE=disable` is accepted only for loopback local databases. URL SSL flags cannot disable certificate verification. Queries have a 15-second statement timeout, connection acquisition a 5-second timeout. SIGTERM/SIGINT drain requests and close the pool.
3. Review `backend/supabase/migrations/` and manually apply unapplied files in order through `0008_direct_postgres_admin.sql` using the Supabase SQL editor or an operator-managed migration tool. Existing installations with 0001–0007 need only 0008. Do not replay `ALL_MIGRATIONS.sql` on an existing database. The application and seed never run migrations or destructive schema changes.
4. Enable Supabase Email authentication. Configure `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and backend-only `SUPABASE_SERVICE_ROLE_KEY`. Set backend-only `ADMIN_BOOTSTRAP_EMAIL` and a privately supplied `ADMIN_BOOTSTRAP_PASSWORD` of at least 12 characters meeting your project's Auth password policy. No example password is supplied.
5. From the repository root run:

   ```sh
   npm run db:seed-admin
   ```

   This command reads `backend/.env.local`. In managed environments, inject variables into the process; `npm exec --workspace=backend -- tsx scripts/seed-admin.ts` runs without requiring the local file.
6. Start the backend and frontend. Visit `/sign-in`, enter the configured email/password, then open `/admin`. The backend validates the Supabase Auth token and checks both `profiles.role='admin'` and `admin_users.user_id` on each protected request. Customer sessions receive 403, missing/invalid sessions 401. Profile edits cannot change role, email or another user's details.
7. Remove the bootstrap password from persistent runtime configuration after provisioning. Keep only the Auth service credentials required by your deployment. A DB error returns a clear 502 without exposing SQL, connection strings or credentials.

## Repeat runs and existing accounts

The seed normalizes email, paginates Auth users, serializes concurrent runs by email, and uses the Auth UUID for transactional profile/admin upserts. Passwords never enter public tables, SQL, output, or Git. Creation and email confirmation use the Auth Admin API; `auth.users` is never inserted into by application scripts.

An existing user's password is preserved, even if `ADMIN_BOOTSTRAP_PASSWORD` differs. Unconfirmed existing accounts are confirmed through Auth without changing the password. An existing OAuth-only account may need a password set before password login: only when intentionally configuring/resetting it, set `ADMIN_BOOTSTRAP_RESET_PASSWORD=true` and supply `ADMIN_BOOTSTRAP_PASSWORD` for that single seed invocation, then unset both. The seed does not clear MFA or account bans.

Auth and PostgreSQL cannot share one distributed transaction. If Auth succeeds but the public upsert fails, the command fails; fix connectivity/schema and rerun. The Auth user is reused, without a duplicate or automatic password reset. Run the seed against the same Supabase project for Auth and PostgreSQL. A mismatched Auth UUID fails the profile foreign key instead of granting access to an unrelated identity.

Migration 0008 adds the previously absent `admin_users(user_id,created_at)` table and preserves existing `profiles.role='admin'` accounts. New signups always start as customers; the historical `admin_bootstrap_emails` setting and env list no longer grant privileges. Existing audited role changes sync membership through a trigger. Removing membership or demoting the role revokes backend access immediately.

Guest checkout retains its random order UUID as a bearer capability, as before. Keep order UUIDs private. Payment return URLs now carry that UUID; sequential order numbers alone cannot verify an order or obtain guest downloads. Signed download tokens remain supported. Public product endpoints use an explicit allowlist and never expose private PDF keys, checksums, search vectors or entitlement settings. Sample delivery permits only published books.

## Verification without live credentials

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

Backend tests apply the unmodified schema/migrations to an isolated PGlite PostgreSQL engine. Auth Admin/password login/JWT transport, storage and payments use test fixtures. Assertions cover repository CRUD, SQL injection, rollback, seed idempotency/concurrent invocation, password preservation/reset, admin login, 401/403, revocation, profile scope, public privacy, settings failures, categories, coupons, checkout, payment replay/refunds, sample bytes, quotas and DB outages. This verifies SQL semantics but cannot validate live Supabase credentials, TLS trust or real Auth email/password policy. Complete step 6 against your configured project manually.

For separate-server SQL, RLS and concurrency checks, initialize a disposable local PostgreSQL database, apply `supabase/tests/_local_supabase_shim.sql` **only to that disposable database**, then migrations 0001–0008. Inject `BOOKISHBAE_TEST_DATABASE_URL` for that loopback database, and run `npm run test:database`. It runs the existing SQL security/commerce suites and real `pg` repository CRUD, profile authorization, payment rollback, pooled download contention and refund checks. `PSQL_PATH` may point to `psql` if it is not on PATH. The runner rejects remote hosts and never uses a live `DATABASE_URL`. Never run fixture suites on production; they create/delete test data and mark fixture orders paid without a payment gateway.

The implementation follows [node-postgres TLS configuration](https://node-postgres.com/features/ssl) and the [Supabase Auth Admin API](https://supabase.com/docs/reference/javascript/auth-admin-createuser).
