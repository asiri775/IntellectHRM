# Email templates and invoice / payslip formats

Both are edited in the app — no code changes or redeploys.

## Branding (Settings → Company & branding)

* **Logo** — used on the sign-in page, sidebar, emails (embedded as an inline CID image) and all documents (embedded as a data URI, so PDFs need no network).
* **Primary / accent colours** — buttons and highlights in the app, the email header bar and buttons, and document headings and table headers.
* **Company details** — legal name, address, TIN, VAT number, phone, email and website print on invoices, quotations and payslips.
* **Email footer** — shown at the bottom of every email.

## Email templates (Settings → Email templates)

* One **layout** wraps every email (logo, colour bar, footer). Edit it once to restyle every message.
* Each message (leave requested/approved/rejected, payslip published, contract ending, missing sign-out, lead assigned, follow-up reminder, quotation/proforma to customer, welcome) has a subject and an HTML body.
* **Languages.** Each message can have English, Sinhala and Tamil versions. The recipient's preferred language is used, falling back to English. Use "Add a translation" to start a new language from the English text.
* **Live preview** renders your unsaved changes with sample data. Invalid syntax is rejected on save.
* **Restore default** brings back the built-in version. Every edit is audit-logged.
* Turn a message off by unticking "Send this email".

Syntax is Handlebars: `{{employee.name}}` (escaped), `{{#if comment}}…{{/if}}`, helpers `{{date leave.startDate}}`, `{{money netPay currency}}`.

## Document formats (Settings → Invoice & payslip formats)

Templates for **tax invoice, proforma invoice, quotation and payslip**.

**Layout options** (no HTML needed): title, paper size (A4/Letter/A5), heading colour, show logo, tax column, payment terms, bank details, terms and conditions, footer; for payslips, whether to show employer EPF/ETF.

**HTML & CSS** for full control. Available data:

| Document | Fields |
|---|---|
| Invoice / quotation / proforma | `company.*` (incl. `logo`), `doc.title number date dueDate currency reference notes`, `customer.name contactName address email tin vatNumber`, `lines[] description quantity unitPrice taxCode amount`, `totals.subtotal discount taxes[] total`, `options.*` |
| Payslip | `t.*` (labels in the chosen language), `period`, `employee.*`, `payslip.number workingDays employedDays noPayDays`, `earnings[]`, `deductions[]`, `employerContributions[]`, `totalEarnings`, `totalDeductions`, `netPay`, `currency` |

Helpers: `money`, `date` (company date format), `percent`, `eq`, `and`, `or`, `inc`.

**Sample PDF** downloads the template filled with sample data. The template version number increments on every save.

## PDF engine

Set `CHROMIUM_PATH` to a Chrome/Chromium binary. Rendering runs with JavaScript disabled. Without it, documents are delivered as print-ready HTML (attachments too), which any browser can save as PDF.

## Numbering (Settings → Document numbering)

Prefix, format (`{PREFIX}-{YYYY}-{SEQ}`), digits and yearly reset per document type. Numbers are allocated with a row lock inside the issuing transaction, so they are gap-free and never reused; the next number can only move forward.
