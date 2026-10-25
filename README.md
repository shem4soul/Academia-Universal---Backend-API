# Academia Universal — Backend API

Express + TypeScript REST API in an **MVC** structure, on **PostgreSQL** (TypeORM), with **Paystack** payments,
structured **logging** and **Docker**. Serves the Academia Universal web app (`frontend`) and mobile app (`mobile`).

- Interactive API docs: `http://localhost:4000/api/docs` (122 endpoints)
- Health: `GET /health` (process up) · `GET /health/ready` (database reachable)

## Quick start

```bash
cp .env.example .env            # set DB_* and JWT secrets; add Paystack test keys
npm install
npm run seed                    # creates tables + demo data (wipes the database)
npm run dev                     # http://localhost:4000
```
Needs Node 20+ and PostgreSQL 14+. No local Postgres? `docker compose up -d db` starts one.

Demo logins (after `npm run seed`). Password `Password123!`, PIN `1234`:

| Role | Email |
|---|---|
| Student | sam@academiauniversal.com |
| Instructor | anthony@academiauniversal.com |
| Parent | parent@academiauniversal.com |
| Admin (admin console only, 2FA set up on first sign-in) | admin@academiauniversal.com |

## Structure (MVC)

```
src/
├── server.ts            boot: DB, HTTP + Socket.IO, background jobs, graceful shutdown
├── app.ts               Express app: security headers, CORS, request logging, docs, routes, errors
├── config/              env.ts (all settings), database.ts (TypeORM + DB logger)
├── models/              M — TypeORM entities (users, courses, payments, audit_logs …)
├── routes/              URL → middleware → controller
├── controllers/         C — thin: read the request, call a service, return JSON (the "view")
├── services/            business logic — auth, courses, billing, paystack.client, audit, …
├── validators/          Zod schemas for body / query / params
├── middlewares/         auth (JWT + roles), validation, uploads, request logger, errors
├── sockets/             realtime chat + notifications
├── database/seed.ts     demo data
├── scripts/admin.ts     admin account CLI (create, reset-2fa, unlock…)
├── docs/openapi.ts      generates the Swagger spec from the route table
└── utils/               logger, ApiError, pagination, serialisers, tokens, enums
test/
├── api.test.ts          22 end-to-end tests (starts its own API on :4100)
└── mock-paystack.ts     local Paystack stand-in for tests and keyless development
```

Request flow: **route → auth / validation middleware → controller → service → model (PostgreSQL)**.

## Paystack payments

Everything goes through Paystack. Card numbers never touch this API.

| Step | Endpoint | What happens |
|---|---|---|
| Config | `GET /api/billing/config` | Public key, currency, and whether payments are enabled |
| Start checkout | `POST /api/billing/paystack/initialize` | `{ purpose: 'course' \| 'pro' \| 'card', courseId?, beneficiaryId?, saveCard?, platform: 'web' \| 'mobile' }`. The **price is set by the server**. Creates a pending payment and calls Paystack `/transaction/initialize`. Returns `accessCode` (web popup) and `authorizationUrl` (mobile WebView / redirect). |
| Verify | `GET /api/billing/paystack/verify/:reference` | Calls Paystack `/transaction/verify`, checks **amount and currency match**, then grants access once: enrols in the course, extends Pro by 30 days, or saves the card. |
| Webhook | `POST /api/webhooks/paystack` | Checks the `x-paystack-signature` HMAC-SHA512 against the raw body. Handles `charge.success` (re-verified with the API) and `refund.processed` / `refund.failed`. |
| One-tap pay | `POST /api/billing/checkout` | Charges a saved card with Paystack `/transaction/charge_authorization`. |
| Save a card | `POST /api/billing/cards` | Checkout for a ₦50 card check, **refunded automatically**. Paystack's reusable authorization is stored (never shown in responses). |
| Refund (admin) | `POST /api/admin/payments/:id/refund` | Paystack `/refund`. Access is removed when Paystack confirms the refund (webhook). |

Safety built in:
- Prices come from the database, never from the client.
- Every success is re-checked with Paystack.
- Fulfilment is idempotent, so verify and webhook can race safely.
- A paid amount that doesn't match marks the payment failed and writes a critical audit entry.
- Unpaid checkouts are marked abandoned after 24 hours, and expired Pro plans downgrade automatically. Both run every 15 minutes.

**Go live checklist**
1. Put your keys in `.env`: `PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY`. Use test keys first.
2. In the Paystack dashboard → Settings → API Keys & Webhooks, set the webhook URL to `https://<your-api-domain>/api/webhooks/paystack`.
3. Set `FRONTEND_URL` to your web app's URL. Paystack returns web customers to `$FRONTEND_URL/payment/callback`.
4. Test with Paystack's test card `4084 0840 8408 4081`, any future expiry, CVV `408`, OTP `123456`.

**No keys yet?** Run the mock Paystack server:
```bash
npm run mock:paystack     # http://localhost:4545
PAYSTACK_BASE_URL=http://localhost:4545 PAYSTACK_SECRET_KEY=sk_test_mock_secret PAYSTACK_PUBLIC_KEY=pk_test_mock npm run dev
```
Its hosted-checkout page has "Pay", "Decline" and "Cancel" buttons. It's for development only.

## Admin console security

Admins use the separate admin app (`../admin`) and **can't** sign in through `/auth/login` or the mobile PIN.

| | |
|---|---|
| Sign-in | `POST /api/auth/admin/login` (password) → `POST /api/auth/admin/verify` (6-digit authenticator code, TOTP / RFC 6238). The first sign-in returns a QR code to set up the authenticator. Codes can't be reused. |
| Sessions | Admin tokens are marked `aud: admin`: 10-minute access tokens, 8-hour refresh, 12-hour hard limit. Admin powers only work with these tokens. |
| Lockout | 5 failed passwords/codes → locked for 15 minutes (`ADMIN_LOCKOUT_*`) |
| Network | `ADMIN_ORIGINS` (only the admin app may sign admins in; also added to CORS) and an optional `ADMIN_IP_ALLOWLIST` (IPs/CIDRs) |
| Secrets | 2FA secrets are stored AES-256-GCM encrypted with `TOTP_ENCRYPTION_KEY` |
| Audit | Every sign-in, failure, lockout, 2FA change and admin action goes to `audit_logs` |

There is no seed data in production, so create admins and recover access with the CLI:
```bash
npm run admin -- create you@yourdomain.com "First" "Last"   # prints a one-time password (or set ADMIN_PASSWORD)
npm run admin -- reset-2fa you@yourdomain.com               # lost phone → new QR code at next sign-in
npm run admin -- unlock you@yourdomain.com                  # lift a lockout
npm run admin -- set-password you@yourdomain.com
npm run admin -- list
```
Docker: `docker compose exec api npm run admin:prod -- create you@yourdomain.com`

## Logging

| What | Where |
|---|---|
| Every request: method, path, status, duration, user, IP, **request id** | stdout + `logs/app-YYYY-MM-DD.log` |
| Errors with stack traces | stdout + `logs/error-YYYY-MM-DD.log` |
| Slow SQL (> `DB_SLOW_QUERY_MS`) and failed queries | same files, scope `db` |
| Paystack calls (path, status, duration, never the secret) | scope `paystack` |
| Errors from the web and mobile apps (`POST /api/logs/client`) | scope `client` |
| **Audit trail**: sign-ins (and failures), password/PIN changes, payments, refunds, card changes, admin actions | `audit_logs` table → **Activity logs** in the admin console; each user sees their own under Privacy & security |

- Development prints colourised one-liners. Production prints JSON lines, ready for Docker / Loki / Datadog / CloudWatch.
- Files rotate daily, are gzipped, and are kept for `LOG_RETENTION_DAYS`.
- Passwords, PINs, tokens, OTP codes and card authorizations are **redacted** automatically.
- Every response has an `X-Request-Id` header. Server errors include it as `requestId`, and the apps show the first 8 characters ("ref …") so support can find the exact log lines.

Settings: `LOG_LEVEL` (`error`…`debug`), `LOG_TO_FILE`, `LOG_DIR`, `LOG_RETENTION_DAYS`, `DB_LOGGING`, `DB_SLOW_QUERY_MS`.

## Docker

```bash
cp .env.example .env     # JWT secrets are required; add Paystack keys
docker compose up -d --build                 # PostgreSQL + API
docker compose exec api npm run seed:prod    # demo data (once)
docker compose logs -f api                   # live logs
```
- The image is multi-stage: the build stage compiles TypeScript, and the runtime has production dependencies only. It runs as the non-root `node` user and has a health check on `/health/ready`.
- Uploads and log files are on named volumes. Container stdout logs rotate (10 MB × 5).

## Scripts

| Command | |
|---|---|
| `npm run dev` | Start with auto-reload |
| `npm run build` / `npm start` | Compile / run the compiled server |
| `npm run seed` · `npm run seed:prod` | Reset schema + demo data (TypeScript / compiled) |
| `npm test` | 22 end-to-end tests: Paystack flows, admin 2FA, lockout (needs a seeded database) |
| `npm run admin -- <command>` | Admin accounts: create, reset-2fa, unlock, set-password, list |
| `npm run mock:paystack` | Local Paystack stand-in |
| `npm run typecheck` | Type-check only |

## Production notes
- Set `DB_SYNC=false` once the schema is stable, and manage changes with TypeORM migrations.
- Set `EXPOSE_OTP_IN_RESPONSE=false`, and connect `services/otp.service.ts` to your email/SMS provider. It currently logs codes outside production.
- Uploads are stored on local disk (volume). Swap `middlewares/upload.middleware.ts` for S3/Cloudinary when you run several API instances.
- `DB_SSL=true` for managed Postgres that requires SSL.
