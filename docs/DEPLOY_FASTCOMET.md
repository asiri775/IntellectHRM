# Deploying on FastComet shared hosting (cPanel)

This guide runs IntellectHRM as **one Node.js process** (API + web app) under cPanel's **Setup Node.js App** (Phusion Passenger / CloudLinux). It suits a pilot or a small team. For production payroll data, a VPS is recommended (see "Limitations").

## 0. Check with FastComet support first

Open a ticket and confirm:

1. **Node.js version** available in "Setup Node.js App". You need **20 or later** (18 minimum).
2. **PostgreSQL.** FastComet shared plans list MySQL/MariaDB only. IntellectHRM needs **PostgreSQL 14+**; it does not run on MySQL/MariaDB. Ask whether PostgreSQL can be enabled on your account. If it can't, use an external managed PostgreSQL (step 2B).
3. **Outbound TCP 5432** is allowed from your account. This is only needed for external PostgreSQL.
4. **SSH access** is enabled.
5. Your plan's **RAM and process limits**. Use Essential (2 GB) or higher. Installing dependencies needs about 1 GB.

## 1. Domain and SSL

1. In cPanel → **Domains**, create a subdomain such as `hr.intellectchoice.co.nz`.
2. In cPanel → **SSL/TLS Status**, run **AutoSSL** for it. HTTPS is required because sign-in cookies are `Secure` in production.

## 2. Database

### 2A. PostgreSQL on FastComet (if support enabled it)

1. In cPanel → **PostgreSQL Databases**, create database `ihrm` and user `ihrm` with a strong password, and add the user to the database with ALL privileges.
2. The database and user names get your cPanel prefix:
   `DATABASE_URL=postgresql://cpuser_ihrm:PASSWORD@localhost:5432/cpuser_ihrm`

### 2B. External managed PostgreSQL (Neon, Supabase, Aiven, AWS RDS…)

1. Create a PostgreSQL 15/16 database in the region closest to your FastComet data centre.
2. Use the direct (non-pooled) connection string with SSL:
   `DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DB?sslmode=require`
3. **PDPA:** employee data then lives with that provider. Record it as a cross-border transfer in `DATA_PROTECTION.md`; the in-app register arrives in a later phase.

URL-encode special characters in the password, for example `@` becomes `%40`.

## 3. Get the code onto the server

SSH in (cPanel → **SSH Access**, or the **Terminal** app). Keep the code **outside `public_html`**.

```bash
cd ~
git clone https://github.com/asiri775/IntellectHRM.git intellecthrm
cd intellecthrm && git checkout main   # or the release branch/tag
mkdir -p ~/ihrm-storage                # uploaded logo, documents, attachments
```

For a private repo, add a deploy key in cPanel → **Git Version Control**, or use a GitHub token.

## 4. Create the Node.js application

In cPanel → **Setup Node.js App** → **Create Application**:

| Field | Value |
|---|---|
| Node.js version | highest available (≥ 20) |
| Application mode | Production |
| Application root | `intellecthrm/apps/api` |
| Application URL | `hr.intellectchoice.co.nz` |
| Application startup file | `server.js` |

Click **Create**. cPanel shows a command like `source /home/cpuser/nodevenv/intellecthrm/apps/api/20/bin/activate && cd ...`. Copy it; every build command below runs **after** that command.

## 5. Install and build (over SSH)

```bash
source /home/cpuser/nodevenv/intellecthrm/apps/api/20/bin/activate
cd ~/intellecthrm
npm install -g pnpm@10                 # or prefix the pnpm commands with: npx pnpm@10
pnpm install --frozen-lockfile
pnpm --filter @ihrm/shared build
pnpm --filter @ihrm/api build          # also runs prisma generate
```

Build the **web app on your own computer** (shared hosting often kills the Vite build for using too much memory) and upload it:

```bash
# on your PC, in the repo
pnpm install && pnpm --filter @ihrm/shared build && pnpm --filter @ihrm/web build
scp -r apps/web/dist cpuser@server:~/intellecthrm/apps/web/
```

You can also zip `apps/web/dist` and upload it with File Manager.

Install the API dependencies on the server, not your PC, so that `argon2` and the Prisma engine match the server.

## 6. Environment variables

Create `~/intellecthrm/apps/api/.env`. `server.js` loads it. Variables set in the cPanel app screen take precedence. Generate the secrets on the server:

```bash
openssl rand -base64 48   # JWT_ACCESS_SECRET
openssl rand -base64 32   # DATA_ENCRYPTION_KEY  (must be exactly 32 bytes, base64)
openssl rand -base64 32   # BLIND_INDEX_KEY
```

```dotenv
NODE_ENV=production
DATABASE_URL=postgresql://...            # from step 2
APP_URL=https://hr.intellectchoice.co.nz
API_PUBLIC_URL=https://hr.intellectchoice.co.nz
CORS_ORIGINS=https://hr.intellectchoice.co.nz
WEB_DIST_DIR=../web/dist                 # API serves the web app (same origin)

JWT_ACCESS_SECRET=...
DATA_ENCRYPTION_KEY=...
BLIND_INDEX_KEY=...

STORAGE_DIR=/home/cpuser/ihrm-storage    # outside public_html
MAX_UPLOAD_MB=10

MAIL_PROVIDER=smtp
MAIL_FROM="Intellect Choice HR <hr@intellectchoice.co.nz>"
SMTP_HOST=mail.intellectchoice.co.nz     # cPanel → Email Accounts → Connect Devices
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=hr@intellectchoice.co.nz
SMTP_PASS=...

ENABLE_SCHEDULER=true
# REDIS_URL      — leave unset (no Redis on shared hosting; emails are sent in-process)
# CHROMIUM_PATH  — leave unset (documents are delivered as print-ready HTML)

# First run only (initial admin account), then delete these two lines:
SEED_ADMIN_EMAIL=admin@intellectchoice.co.nz
SEED_ADMIN_PASSWORD=<a long temporary password>
```

Protect the file and keep a copy of the keys outside the server, for example in a password manager:

```bash
chmod 600 ~/intellecthrm/apps/api/.env
```

**If `DATA_ENCRYPTION_KEY` is lost, encrypted NIC and bank details cannot be recovered.**

Do not commit this file. Do not paste the keys into tickets or emails.

## 7. Create the tables and seed

```bash
cd ~/intellecthrm/apps/api
set -a; . ./.env; set +a
pnpm exec prisma migrate deploy        # creates all tables + the append-only audit trigger
node dist/prisma/seed.js               # roles, permissions, statutory defaults, chart of accounts, admin user
```

Then remove `SEED_ADMIN_PASSWORD` from `.env`.

## 8. Start and test

1. In cPanel → Setup Node.js App, click **Restart**. Over SSH you can instead run `touch ~/intellecthrm/apps/api/tmp/restart.txt`.
2. Check `https://hr.intellectchoice.co.nz/api/health`. It should return `{"status":"ok",...}`.
3. Open `https://hr.intellectchoice.co.nz` and sign in.
4. If the app does not start, read the error at `~/intellecthrm/apps/api/stderr.log` (the location depends on Passenger) or in cPanel → **Errors**.

## 9. Keep the scheduler alive (cPanel → Cron Jobs)

Passenger stops idle apps, which would also stop scheduled jobs: contract-ending notices, missing sign-out reminders and follow-up reminders. Ping the app every 5 minutes:

```
*/5 * * * * curl -fsS https://hr.intellectchoice.co.nz/api/health > /dev/null 2>&1
```

## 10. Backups

* **Database:** use your PostgreSQL provider's daily backups or point-in-time recovery. With cPanel PostgreSQL, also download a weekly dump:
  ```
  pg_dump "$DATABASE_URL" -Fc > ~/backups/ihrm-$(date +%F).dump
  ```
* **Files:** `~/ihrm-storage` is included in cPanel/JetBackup home backups. Also copy it off-site regularly.
* **Secrets:** keep `.env` (especially `DATA_ENCRYPTION_KEY`) in a password manager.
* **Restore test:** restore to a test database once a month.

## 11. After the first sign-in

1. Change the admin password (top-right menu → Change password).
2. Go to Settings → Company & branding: upload the Intellect Choice logo, set the colours and company details (TIN, VAT number, address).
3. Leave → Holidays: add or import this year's Sri Lankan holiday calendar.
4. Payroll → Statutory rules: ask your accountant to confirm EPF, ETF, APIT and contract employee tax before the first payroll run.
5. Trigger an email (for example, submit a test leave request) and check Settings → Email outbox shows it as sent, then check that the SPF and DKIM records are set (cPanel → **Email Deliverability**).
6. Create the users and employees.

## 12. Updating

```bash
source /home/cpuser/nodevenv/intellecthrm/apps/api/20/bin/activate
cd ~/intellecthrm && git pull
pnpm install --frozen-lockfile
pnpm --filter @ihrm/shared build && pnpm --filter @ihrm/api build
cd apps/api && set -a && . ./.env && set +a && pnpm exec prisma migrate deploy
# upload the new apps/web/dist built on your PC
touch tmp/restart.txt
```

Take a database backup before every update that includes a migration.

## Limitations of shared hosting

| Item | On shared hosting | Effect |
|---|---|---|
| Redis | not available | Emails are sent in-process: no retry queue, and a restart can drop a mail being sent. One instance only. |
| PDF engine (Chromium) | can't be installed | Payslips and invoices are delivered as print-ready HTML that users save as PDF from their browser. |
| Process idling | Passenger stops idle apps | The first request after an idle period is slow. The cron ping in step 9 prevents this. |
| CPU/RAM limits | 1–4 cores | Adequate for tens of employees. Payroll runs for hundreds may hit limits. |
| PostgreSQL | usually external | Extra latency and an extra provider to record for PDPA. |

**Recommendation.** For live payroll and NIC/bank data, move to a **FastComet Cloud VPS** or another VPS when the pilot ends. A VPS gives you local PostgreSQL, Redis, Chromium with Sinhala/Tamil fonts and full backups; follow `DEPLOYMENT.md`. The application code is the same, and the `.env` is unchanged apart from `REDIS_URL` and `CHROMIUM_PATH`.
