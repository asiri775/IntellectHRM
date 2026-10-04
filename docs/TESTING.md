# Testing

| Layer | Where | What |
|---|---|---|
| Unit | `packages/shared/src/**/*.test.ts` (Vitest) | Payroll engine incl. all 7 required contract-tax cases, foreign currency, replacesApit, component base, EPF/ETF/APIT slabs, no-pay, journal balance; attendance (late/grace/early/overtime/non-working days/time zones); leave days, half days, proration; NIC, mobile, sequence formatting, rounding |
| End-to-end API | `tests/e2e/api.e2e.mjs` | 24 steps against a real API, Postgres and Redis: auth, lockout path, refresh rotation and reuse detection, logo upload and spoofed-file rejection, RBAC scopes and masking, employees and contracts, attendance sign-in/out/breaks and corrections, leave request → HR approval with balance movements, holiday import, statutory rule versioning, payroll create → calculate → approve → post with **LKR 10,000.00 contract tax**, payslip PDF/HTML in Sinhala, EPF/contract-tax/bank exports, CRM lead → convert → pipeline → quotation with VAT totals → proforma email, template editing and preview, email outbox, audit trail |
| UI | `tests/screenshots/capture.mjs` | Signs in as admin, HR, employee (desktop, mobile, Sinhala) and sales, and captures every main screen |
| Type safety | CI | `tsc --noEmit` for shared, API and web |

Run the end-to-end suite locally:

```bash
cd apps/api && node --env-file=.env dist/src/main.js &
API_URL=http://localhost:3000 ADMIN_EMAIL=... ADMIN_PASSWORD=... node tests/e2e/api.e2e.mjs
```

It is safe to run repeatedly against the same database.
