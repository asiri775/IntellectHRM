# IntellectHRM

The Intellect Choice platform for running an IT services company from one place. This release covers:

| Area | What's included |
|---|---|
| **HRM** | Employee master (NIC/EPF/TIN, encrypted bank and ID data), departments/teams/designations, contracts with renewal history and end-date reminders, documents with versions and expiry |
| **Attendance** | Sign in / sign out / breaks (server time, Asia/Colombo), remote flag, late/early/overtime, daily board, manual entries and corrections with reasons, trends, CSV export |
| **Leave** | Annual, casual, medical, short, maternity, paternity, lieu, no-pay; half days; balances with proration and carry-forward; Manager → HR approval workflow; Sri Lankan holiday calendar import |
| **Payroll (Sri Lanka)** | EPF 8%/12%, ETF 3%, APIT slabs, gratuity provision, no-pay, **contract employee tax (5% when monthly gross > LKR 150,000)**, versioned statutory rules, Draft → Calculated → Approved → Posted → Reversed, payslips (EN/SI/TA, PDF), EPF/ETF/APIT/contract-tax/bank files, balanced payroll journal |
| **CRM** | Leads (sources, follow-up reminders, consent), conversion to customer + opportunity, drag-and-drop pipeline, weighted pipeline and win rate, Customer 360, activities, quotations and proforma invoices emailed as PDF |
| **Platform** | Configurable roles with scopes (own/team/department/company), JWT + rotating refresh tokens, Argon2 passwords, lockout, audit log (append-only), **editable email templates and invoice/quotation/payslip formats with live preview**, company logo and colours on every screen, email and document, background email queue (BullMQ) with retries, English/Sinhala/Tamil |

`CLAUDE.md` is the full product brief. Later phases (projects, timesheets, accounting, billing, marketing, skills) build on this foundation.

## Quick start (local)

Requirements: Node 20+, pnpm 9+, PostgreSQL 14+, Redis 6+ (optional; without it emails send in-process).

```bash
# 1. Database and Redis (or use your own)
docker compose -f infrastructure/docker-compose.yml up -d

# 2. Install
pnpm install

# 3. Configure the API
cp apps/api/.env.example apps/api/.env
#   fill in JWT_ACCESS_SECRET, DATA_ENCRYPTION_KEY (openssl rand -base64 32),
#   BLIND_INDEX_KEY (openssl rand -hex 32), SEED_ADMIN_PASSWORD

# 4. Create the schema, build and seed
cd apps/api
pnpm exec prisma migrate deploy        # or: pnpm exec prisma db push   (see docs/DATABASE.md)
pnpm build
node --env-file=.env dist/prisma/seed.js
SEED_DEMO=true SEED_DEMO_PASSWORD='Demo-pass-123' node --env-file=.env dist/prisma/seed.js   # optional demo data

# 5. Run
node --env-file=.env dist/src/main.js            # API on :3000, Swagger at /api/docs
cd ../web && pnpm dev                            # Web on :5173 (proxies /api to :3000)
```

Sign in with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`. Demo users (when seeded) use `SEED_DEMO_PASSWORD`:

| User | Role |
|---|---|
| nadeesha.perera@example.com | HR manager |
| ruwan.jayasinghe@example.com | Team lead (manager of Kasun and Tharindu) |
| kasun.silva@example.com | Contract employee, LKR 200,000 gross → LKR 10,000 contract tax |
| dilini.wickramasinghe@example.com | Payroll officer |
| sanjaya.ranasinghe@example.com | Finance manager + sales manager |
| amal.gunawardena@example.com | Sales executive |

### Add the Intellect Choice logo

**Settings → Company & branding → Upload logo** (PNG, JPG, WebP or SVG up to 2 MB). The logo is then used on the sign-in page, in the sidebar, in every email (embedded inline, so it shows even when remote images are blocked) and on payslips, quotations and invoices. Colours set on the same page drive buttons, email headers and document headings.

## Repository

```
apps/api        NestJS API (Prisma/PostgreSQL, BullMQ/Redis)
apps/web        React + Vite + Tailwind web app (EN/SI/TA)
packages/shared Payroll engine, attendance/leave calculations, permissions (unit-tested)
tests/e2e       End-to-end API tests (run in CI against Postgres + Redis)
tests/screenshots UI screenshot capture used in CI
docs/           Architecture, payroll, RBAC, templates, deployment, open questions
```

## Tests

```bash
pnpm --filter @ihrm/shared test        # payroll engine incl. the 7 required contract-tax cases
node tests/e2e/api.e2e.mjs             # needs a running, seeded API (see docs/TESTING.md)
```

CI (GitHub Actions) runs unit tests, type-checks, builds both apps, seeds a fresh database twice (idempotency), runs the end-to-end suite with real PDF generation and again with the HTML fallback, and captures UI screenshots.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Payroll and statutory rules](docs/PAYROLL.md)
- [Roles and permissions](docs/RBAC.md)
- [Email templates and invoice formats](docs/TEMPLATES.md)
- [Data protection (PDPA)](docs/DATA_PROTECTION.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Testing](docs/TESTING.md)
- [Open questions for the client](docs/OPEN_QUESTIONS.md)
