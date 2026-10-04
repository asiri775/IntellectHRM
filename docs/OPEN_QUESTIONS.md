# Open questions for Intellect Choice

Items the system implements as **configurable defaults** that need confirmation from the company's accountant, legal adviser or management before go-live. None requires code changes — each is a setting.

## Payroll and tax

1. **Contract employee tax basis.** Default: 5% of the **full** monthly gross when it is above LKR 150,000 (LKR 200,000 → 10,000). Alternative: 5% of only the amount **above** 150,000 (→ 2,500). *Payroll → Statutory rules → Contract employee tax.*
2. **Contract tax and APIT.** Default: contract tax is deducted **in addition to** APIT. If it should replace APIT for contract employees, tick "Replaces APIT".
3. **Salary base for contract tax.** Default: all gross earnings (basic + allowances + overtime + bonus). Should allowances or variable pay be excluded?
4. **What is "exactly LKR 150,000"?** Default: no deduction at exactly 150,000 (strictly "above").
5. **APIT slabs.** Seeded with the monthly equivalent of the slabs effective 1 April 2025. Confirm, and confirm whether APIT should apply to contract employees at all.
6. **EPF/ETF applicability.** Seeded for Permanent, Probation and Contract; not for Intern or Consultant. Confirm for interns and consultants.
7. **Which earnings are EPF-liable.** Seeded: Basic and Fixed allowance yes; Travel, Communication, Overtime, Bonus no.
8. **No-pay divisor.** Default: basic ÷ working days in the month. Some companies use ÷ 30.
9. **Gratuity.** Default provision: half a month's basic per year of service for Permanent, Probation and Contract.
10. **VAT / SSCL.** Seeded VAT 18% and SSCL 2.5% from 1 January 2024 for quotations and invoices. Confirm registration status and rates.
11. **Statutory file formats.** EPF/ETF/APIT exports are CSV with the standard columns. Provide the exact upload format required by the EPF department / IRD portal / your bank to match them exactly.

## Leave

12. **Entitlements** (seeded from Shop and Office Employees Act practice): Annual 14 (0 during probation), Casual 7, Medical 7, Short leave 24/year, Maternity 84, Paternity 3, carry-forward up to 7 annual days. Confirm company policy.
13. **Annual leave in the first year** — the Act links it to service in the previous year; the default prorates by joining month. Confirm.
14. **Holiday calendar** — import the official 2026/2027 public, bank, mercantile and Poya holidays (Leave → Holidays → Import).

## HR and data protection

15. **Location at sign-in** is off. Turning it on requires informing employees in the privacy notice (PDPA).
16. **Retention periods** for ex-employee records, payslips and attendance (PDPA operational from 1 January 2027).
17. **Data residency** — where the production database and files will be hosted (cross-border transfer register).
18. **Sinhala and Tamil wording** of emails, payslip labels and UI should be reviewed by a native speaker.

## Branding

19. **Logo file** — upload the official Intellect Choice logo in Settings → Company & branding (SVG or transparent PNG preferred). The sandbox used to build this release could not download it from intellectchoice.co.nz.
20. **Legal name, address, TIN and VAT number** to print on invoices and quotations.
