# Setup

Four accounts, in this order. Payment gateway activation is the long pole — live-mode activation
needs business documents and can take days — so start it first and do the rest
while it is pending.

Everything below works in test mode without live activation, so you can have a
complete working shop before live activation.

---

## 0. Local

```bash
npm install
cp frontend/.env.example frontend/.env.local
cp backend/.env.example backend/.env.local
```

Use the backend file for the API process and the frontend file for Next.js.
Set both local files to `NODE_ENV=development`; use `BACKEND_URL=http://localhost:5000` locally.
For production, set `NODE_ENV=production` on the backend and a valid HTTPS
`BACKEND_URL` on the frontend. Production runtime credentials must be injected
through the hosting provider, not committed to either file.

---

## 1. Supabase

### Create the project

1. <https://supabase.com/dashboard> → **New project**.
2. Region: **Mumbai (ap-south-1)** if your buyers are in India — it is the
   difference between a 40 ms and a 300 ms query.
3. Save the database password somewhere safe; you will want it for `psql`.

### Keys

**Project settings → API**, copy into both workspace env files:

| Dashboard field | Variable |
| --- | --- |
| Project URL | `NEXT_PUBLIC_SUPABASE_URL` |
| `anon` `public` | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `service_role` `secret` | `SUPABASE_SERVICE_ROLE_KEY` |

### Run the migrations

See [direct PostgreSQL and secure admin setup](DATABASE.md) for `DATABASE_URL`, TLS and the seed command. Review and apply only unapplied migrations; do not edit historical migrations to configure an admin.

**SQL Editor**, one file at a time, in order:

1. `supabase/migrations/0001_schema.sql`
2. `supabase/migrations/0002_functions.sql`
3. `supabase/migrations/0003_policies.sql`
4. `supabase/migrations/0004_bootstrap.sql`
5. `supabase/migrations/0005_cashfree_faq.sql`
6. `supabase/migrations/0006_admin_dashboard_metrics.sql`
7. `supabase/migrations/0007_author_commerce.sql`
8. `supabase/migrations/0008_direct_postgres_admin.sql`

`0002` creates two triggers on `auth.users`. The SQL editor runs as `postgres`,
which owns that table, so this works — but if you apply migrations some other
way and those two statements fail, run them separately in the editor.

Expect a batch of `NOTICE: ... does not exist, skipping` lines. Those come from
the `drop ... if exists` guards that make the files re-runnable. An `ERROR` is a
real problem; a `NOTICE` is not.

### Check it worked

```bash
psql "postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres" \
  -v ON_ERROR_STOP=1 -f supabase/tests/security.sql
```

37 `PASS` lines and `All BookishBae security checks passed.` Anything else,
stop and fix it before going further — this suite is what stands between a
paying customer's PDF and the open internet.

### Auth

**Authentication → Providers**

- **Email**: on. Turn **Confirm email** on. Set **OTP expiry** to 3600.
- **Google**: on. You need a Google Cloud OAuth client first:
  1. <https://console.cloud.google.com> → **APIs & Services → Credentials**
  2. **Create credentials → OAuth client ID → Web application**
  3. Authorised redirect URI — copy it from the Supabase Google provider panel;
     it looks like `https://<ref>.supabase.co/auth/v1/callback`
  4. Paste the client ID and secret back into Supabase.
  5. The OAuth consent screen needs an app name, support email and privacy-policy
     URL. If you are publishing it rather than leaving it in testing mode,
     Google's review is another multi-day wait — start it early.

**Authentication → URL Configuration**

- Site URL: `https://bookishbae.com` (or `http://localhost:3000` while developing)
- Redirect URLs — add all of:
  ```
  http://localhost:3000/**
  https://bookishbae.com/**
  https://*-<your-vercel-team>.vercel.app/**
  ```

---

## 2. Cloudinary

### Setup

1. Sign up or log in at <https://cloudinary.com/console>.
2. From your Cloudinary Dashboard, copy your:
   - **Cloud name**
   - **API Key**
   - **API Secret**

Paste them into `.env.local`:

```
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
```

### Storage Model

- **Public Media (`upload`)**: Cover images and author photos are served through Cloudinary's global CDN (`res.cloudinary.com`).
- **Private E-books (`authenticated`)**: E-book PDFs (books, samples, watermarked) are uploaded as authenticated raw resources. They cannot be accessed without an expiring, server-signed download URL (default TTL: 90 seconds).

---

## 3. Cashfree Payments

### Keys

1. Sign up or log in at <https://merchant.cashfree.com>.
2. Switch to **Sandbox** (Test) or Production.
3. Go to **Developers → API Keys → Generate API Keys**.

```
CASHFREE_APP_ID=TEST...
CASHFREE_SECRET_KEY=...
CASHFREE_ENVIRONMENT=TEST
NEXT_PUBLIC_CASHFREE_MODE=SANDBOX
```

### Webhook

**Developers → Webhooks → Add Webhook Endpoint**

- URL: `https://bookishbae.com/api/webhooks/cashfree`
- Events:
  - `PAYMENT_SUCCESS_WEBHOOK`
  - `PAYMENT_FAILED_WEBHOOK`
  - `PAYMENT_USER_DROPPED_WEBHOOK`

For local testing, run a tunnel:

```bash
npx localtunnel --port 3000
# or: cloudflared tunnel --url http://localhost:3000
```

and register the tunnel URL.

Cashfree signs webhook deliveries with your `CASHFREE_SECRET_KEY` using HMAC-SHA256 (base64) over `timestamp + rawBody`.

---

## 4. Brevo

1. <https://app.brevo.com> → **Senders, Domains & Dedicated IPs → Senders**. Add and verify your sender email.
2. Go to **SMTP & API → API Keys → Generate a new API key**.

```
BREVO_API_KEY=xkeysib-...
EMAIL_FROM="BookishBae <hello@bookishbae.com>"
EMAIL_REPLY_TO=hello@bookishbae.com
```

`EMAIL_FROM` must match a verified sender or domain in Brevo.

---

## 5. Finish `.env.local`

```bash
# Generate the IP hash salt
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Then start frontend and backend in separate terminals:

```bash
npm run typecheck
npm run dev:backend
npm run dev:frontend
```

`npm run seed:dry` generates the artefacts into `backend/scripts/.generated/` without
touching Cloudinary or the database — useful for looking at the covers first.

Run `npm run db:seed-admin` from the repository root after configuring the backend variables in [DATABASE.md](DATABASE.md), then use the existing `/sign-in` email/password form.

---

## 6. Vercel

1. Import the repository.
2. Framework preset: Next.js. Build command and output directory: defaults.
3. **Settings → Environment Variables**: set the frontend variables from
   `frontend/.env.example`, with `NEXT_PUBLIC_SITE_URL` set to the production
   domain and `BACKEND_URL` set to the HTTPS API host.
4. Add the production domain under **Settings → Domains**.

After the first deploy, go back and update:

- Supabase **Site URL** and **Redirect URLs**
- Cashfree **webhook URL**
- Cloudinary allowed upload settings, if configured

all to the real domain. Forgetting the webhook one is the classic launch bug:
payments succeed, money arrives, and no buyer ever gets their book.

### Keep the rate-limit table tidy

`public.rate_limits` accumulates expired windows. Either enable `pg_cron` in
Supabase:

```sql
select cron.schedule('prune-rate-limits', '0 * * * *',
                     $$select public.prune_rate_limits()$$);
```

or add a Vercel cron hitting a small route that calls the same function.

---

## Before you take real money

Work through `docs/TESTING.md`. The unauthorized-download and private-file URL
items in particular are not optional — they are the two failure modes that put
the book you are selling onto the open internet.
