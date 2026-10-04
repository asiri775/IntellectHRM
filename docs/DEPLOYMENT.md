# Deployment

## Components

| Component | Notes |
|---|---|
| API | `node apps/api/dist/src/main.js` behind HTTPS (nginx, a load balancer, or a PaaS). Stateless — run 2+ instances. |
| Web | Static files from `apps/web/dist`. Serve them and route `/api` to the API on the same origin (the refresh cookie is `SameSite=Strict`, path `/api/auth`). |
| PostgreSQL | 14+. Daily backups with point-in-time recovery. |
| Redis | 6+. Email queue and scheduler lock. |
| File storage | `STORAGE_DIR` on a persistent volume (logo, employee documents, email attachments). Back it up with the database. |
| Chromium | Optional, for PDFs: install `chromium` and set `CHROMIUM_PATH`. **Also install Sinhala and Tamil fonts** (`apt-get install fonts-noto-core` on Debian/Ubuntu), otherwise those payslips render as empty boxes. |

## Steps

```bash
pnpm install --frozen-lockfile
pnpm --filter @ihrm/shared build
pnpm --filter @ihrm/api build
pnpm --filter @ihrm/web build
cd apps/api && pnpm exec prisma migrate deploy && node dist/prisma/seed.js
```

Required production settings: `NODE_ENV=production`, strong `JWT_ACCESS_SECRET`, `DATA_ENCRYPTION_KEY` and `BLIND_INDEX_KEY` (store in a secrets manager and back them up — **losing the encryption key makes NIC and bank data unreadable**), `APP_URL`, `API_PUBLIC_URL`, `CORS_ORIGINS`, `MAIL_PROVIDER=smtp` with SMTP credentials, `REDIS_URL`.

Run exactly one instance with `ENABLE_SCHEDULER=true` (a Redis lock also prevents duplicate runs).

## Single-process / cPanel hosting

Set `WEB_DIST_DIR=../web/dist` and the API also serves the web app, so no separate web server is needed. Start it with `node apps/api/server.js`, which loads `apps/api/.env`. See [DEPLOY_FASTCOMET.md](DEPLOY_FASTCOMET.md) for a step-by-step cPanel guide.

## Backups and recovery

* Database: nightly full backup + WAL archiving (PITR), 35-day retention, encrypted, copied off-site. Test a restore monthly.
* Files: nightly sync of `STORAGE_DIR` to object storage with versioning.
* Targets: RPO ≤ 15 minutes (WAL), RTO ≤ 4 hours.

## Database migrations

Migrations live in `apps/api/prisma/migrations` and are applied with `pnpm exec prisma migrate deploy`. The initial migration also installs the trigger that makes `audit_logs` append-only. CI fails if `schema.prisma` and the committed migrations drift apart; after changing the schema, run `pnpm exec prisma migrate dev --name <change>` and commit the new folder.
