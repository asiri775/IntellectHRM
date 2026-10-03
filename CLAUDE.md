# MASTER PROMPT — Integrated IT Company Platform (Sri Lanka Edition)

ERP · HRM · Payroll · CRM · Project Management · Accounting · Billing · Marketing · Employee Skill Management

> Usage: Save this file as `CLAUDE.md` in the root of your repository and run it with Claude Code. Feed ONE phase at a time (see Section 70). Do not paste the whole build into a single chat request.

---

## 0. ROLE

You are acting as the CTO, Solution Architect, Senior Product Manager, UX Architect, Security Architect and Senior Full-Stack Developer.

Build a production-ready integrated business management platform for a software/IT services company headquartered in **Sri Lanka**.

The system must combine:

1. HRM
2. Employee attendance
3. Employee sign-in/sign-out
4. Leave management
5. Payroll (including Sri Lankan statutory deductions)
6. CRM
7. Leads and sales pipeline
8. Customer management
9. Supplier/vendor management
10. Project management
11. Task management
12. Timesheets
13. Project budgeting
14. Resource allocation
15. Billing
16. Invoicing
17. Cash memo / cash sales
18. Accounting
19. Expenses
20. Budget management
21. Marketing
22. Customer support / ticketing
23. Employee skill management
24. Performance evaluation
25. Training
26. Management dashboards
27. Custom roles and permissions
28. Notifications
29. Reports
30. Audit logs
31. Data protection (PDPA) compliance

The system must be suitable for an IT company providing: software development, SaaS development, web development, mobile applications, cloud services, DevOps, QA, IT consulting, project management, maintenance/support, digital marketing, SEO, AI development and outsourcing services.

The system should initially support one company but MUST be architected to support multiple companies/business units later (including companies in other countries with different currencies, taxes and labour rules).

---

## 1. PRODUCT OBJECTIVE

Create one centralized platform where management can understand:

Who works for the company · who is working today · attendance · availability · skills · performance · employee cost · which projects employees are working on · hours spent · project profitability · customer profitability · sales pipeline · marketing performance · invoices · payments · expenses · cash transactions · accounts receivable · accounts payable · budgets · revenue · profit/loss · utilization · project progress · payroll cost and statutory liabilities · business KPIs.

The main goal is:

**"One source of truth for the entire IT business."**

---

## 2. SRI LANKA LOCALISATION (NEW — APPLIES TO ALL MODULES)

### 2.1 Defaults

- Country: Sri Lanka
- Base currency: **LKR**
- Time zone: **Asia/Colombo (UTC+05:30)** as company default; store all timestamps in UTC and display in the user's/company time zone
- Date format: DD/MM/YYYY (configurable)
- Fiscal year: **1 April – 31 March** (configurable)
- Languages: **English, Sinhala, Tamil** for employee-facing screens, notifications, payslips and HR letters. Use i18n from day one; never hard-code UI text.
- National identifiers: NIC (old 9-digit+V/X and new 12-digit formats), passport, EPF number, TIN. Validate formats; treat all as sensitive.

### 2.2 Statutory rules must be configurable, not hard-coded

All rates, thresholds, slabs and effective dates below must be stored as **versioned configuration with an effective-from date**, so that when the law changes an authorised user can add a new version without code changes. Historic payroll runs must keep the rules that applied at the time.

Seed values are defaults only. Before go-live the client's accountant/legal adviser must confirm every rate.

### 2.3 Labour and statutory items to support

- **EPF**: employee contribution 8%, employer contribution 12% of the configured earnings base
- **ETF**: employer contribution 3% of the configured earnings base
- **Gratuity**: liability tracking and calculation on termination for eligible employees (configurable eligibility period and formula)
- **APIT / PAYE**: progressive tax slabs, stored as a configurable slab table
- **Leave**: entitlements configurable per employment type, in line with the Shop and Office Employees Act and company policy
- **Public, bank and mercantile holidays** (including Poya days): importable holiday calendar per year
- Applicability of EPF/ETF/APIT/gratuity must be configurable **per employment type** (permanent, probation, contract, intern, consultant).

### 2.4 Indirect taxes and withholding (configurable)

Support configurable tax codes for VAT, SSCL, WHT and any future tax. Each tax code has: name, rate, inclusive/exclusive, applicable documents, account mapping, effective dates.

### 2.5 Statutory outputs

Generate exportable reports for: EPF return (Form C or current format), ETF return, APIT schedules, contract-employee tax deduction schedule (Section 13), WHT certificates, payroll summary per month. Formats must be configurable since authority formats change.

---

## 3. TECHNOLOGY STACK

### Frontend
React · TypeScript · Vite · professional enterprise UI · responsive (desktop, tablet, mobile) · reusable components.

Suggested: React Query, React Hook Form, Zod, a modern component library, i18n library (e.g. i18next) with Sinhala and Tamil font support.

### Backend
Node.js · NestJS · TypeScript · modular architecture · REST API · Swagger/OpenAPI documentation.

Modules:

auth, users, roles, permissions, companies, employees, hr, attendance, leave, payroll, statutory, skills, performance, training, customers, suppliers, crm, leads, opportunities, marketing, support, projects, tasks, timesheets, resources, budgets, billing, invoices, cash, accounting, expenses, payments, notifications, reports, dashboard, audit, data-protection, i18n, settings.

### Database
PostgreSQL · Prisma ORM · UUID identifiers.

Every major entity contains: `id, company_id, created_at, updated_at, created_by, updated_by`.

Use soft deletion where appropriate. Create proper indexes. Use database transactions for financial and payroll operations. Store money as integer minor units (cents) or `DECIMAL`, never floating point.

NEVER modify financial or payroll transactions without maintaining an audit trail.

---

## 4. CORE ARCHITECTURE

Use a modular monolith for the initial version. Do NOT use microservices unnecessarily. The architecture must allow future extraction into microservices.

```
Frontend
   |
  API
   |
NestJS modules
   |
PostgreSQL · Redis · Object storage
```

Redis: caching, sessions where appropriate, queues, notifications, background jobs (payroll runs, report generation, emails).

Object storage: employee documents, payslips, invoices, receipts, contracts, customer documents, marketing assets.

### Hosting and data residency
Document where personal data is stored and processed. Support deployment in a region chosen by the client. Any processing outside Sri Lanka (cloud hosting, email, AI providers) must be recorded as a cross-border transfer (see Section 54).

---

## 5. USER TYPES

Default roles:

SUPER_ADMIN, TOP_MANAGEMENT, ADMIN, HR_MANAGER, PAYROLL_OFFICER, FINANCE_MANAGER, ACCOUNTANT, SALES_MANAGER, SALES_USER, PROJECT_MANAGER, TEAM_LEAD, EMPLOYEE, MARKETING_MANAGER, MARKETING_USER, SUPPORT_AGENT, DATA_PROTECTION_OFFICER, CUSTOMER.

DO NOT hard-code authorization based only on these roles. The system must support configurable roles.

---

## 6. CUSTOM ROLE MANAGEMENT

Tables: Roles, Permissions, RolePermissions, UserRoles.

Permissions are structured as Module → Feature → Action. Examples:

```
PROJECT:    PROJECT_CREATE, PROJECT_VIEW, PROJECT_EDIT, PROJECT_DELETE
EMPLOYEE:   EMPLOYEE_CREATE, EMPLOYEE_VIEW, EMPLOYEE_EDIT
PAYROLL:    PAYROLL_RUN, PAYROLL_VIEW, PAYROLL_APPROVE, PAYSLIP_VIEW_OWN
INVOICE:    INVOICE_CREATE, INVOICE_VIEW, INVOICE_EDIT, INVOICE_APPROVE, INVOICE_DELETE
ACCOUNTING: JOURNAL_CREATE, JOURNAL_VIEW, JOURNAL_APPROVE
```

Actions: Create, Read, Update, Delete, Approve, Export, Print, Import.

Scopes: Own records, Team records, Department records, Company records, All records.

Example: a Project Manager may view projects assigned to their department but not company-wide financial or salary information.

---

## 7. ORGANIZATION STRUCTURE

Entities: Company, Business Unit, Department, Team, Designation, Job Level, Location.

```
Company
 ├─ Software Development
 │   ├─ PHP Team
 │   ├─ React Team
 │   └─ QA
 ├─ Sales
 ├─ Marketing
 ├─ Finance
 └─ HR
```

Employees belong to: Company, Department, Team, Designation, Manager, Location.

---

## 8. EMPLOYEE MASTER

Fields: Employee ID, first name, last name, name with initials, preferred name, NIC/passport number, EPF number, TIN, email, phone, date of birth, address, emergency contact, joining date, **employment type** (Permanent, Probation, **Contract**, Intern, Consultant), contract start date, contract end date, department, team, designation, manager, employment status, work location, work schedule, time zone, salary information, bank information, tax information, skills, certifications, documents, preferred language (English/Sinhala/Tamil).

Sensitive information (NIC, salary, bank, tax, medical, disciplinary) must have additional access restrictions and field-level encryption where appropriate.

### Contract employees
- Contract start and end dates are mandatory.
- Notify HR 60 / 30 / 7 days before a contract ends (configurable).
- Contract renewal creates a new contract record and keeps history.
- Statutory applicability (EPF, ETF, APIT, gratuity, contract tax deduction) is driven by employment-type configuration (Section 2.3).

---

## 9. EMPLOYEE DOCUMENT MANAGEMENT

Documents: employment contract, NIC/passport copies, certificates, qualifications, visa/work authorization documents, performance documents, warning letters, other HR documents.

Support: upload, preview, download, versioning, expiry date, document category, retention period (Section 54). Create expiry notifications.

---

## 10. EMPLOYEE SIGN-IN / SIGN-OUT

Employees can: SIGN IN, SIGN OUT, START BREAK, END BREAK.

Record: employee, date, time, IP address where appropriate, device, location only if company policy permits **and** the employee has been informed, attendance source (Web, Mobile, Admin entry).

Calculate: working hours, break hours, overtime, late arrival, early departure, missing checkout.

Do not rely on client-side time. Use server timestamps (UTC), displayed in the employee's time zone. Admin entries and corrections require a reason and are audit-logged.

---

## 11. ATTENDANCE DASHBOARD

- Employee: today's status, sign-in time, sign-out time, working hours, breaks.
- Manager: team attendance — present, absent, late, on leave, working remotely.
- Management: company attendance statistics, trends, department comparison, late arrivals, absence trends.

---

## 12. LEAVE MANAGEMENT

Leave types: Annual, Casual, Sick/Medical, Unpaid (no-pay), Maternity, Paternity, Lieu leave, Short leave, other configurable types. Entitlements configurable per employment type and pro-rated for new joiners and contract staff.

Features: leave request, half-day and short leave, approval workflow, leave balance, carry-forward rules, calendar, Sri Lankan holiday calendar (Section 2.3), department restrictions.

Approval: Employee → Manager → HR. Approval levels configurable.

Approved no-pay leave must feed payroll automatically.

---

## 13. PAYROLL (NEW)

### 13.1 Payroll run

Monthly payroll run per company (frequency configurable). Steps:

1. Lock attendance, overtime and no-pay leave for the period.
2. Calculate earnings: basic salary, fixed allowances, variable allowances, overtime, bonuses, arrears.
3. Calculate deductions: no-pay, EPF employee (8%), APIT, **contract employee tax deduction (13.2)**, loans/advances, other deductions.
4. Calculate employer contributions: EPF employer (12%), ETF (3%), gratuity accrual.
5. Review → Approve (configurable workflow, e.g. Payroll Officer → HR Manager → Finance Manager).
6. Post the approved payroll to accounting as a balanced journal entry.
7. Generate payslips (PDF, in the employee's preferred language) and a bank transfer file.

Payroll runs use states Draft → Calculated → Approved → Posted → Reversed. A posted payroll is never edited; corrections are made by reversal or adjustment in the next run.

### 13.2 Contract employee tax deduction (REQUIRED)

Business rule:

> For employees whose employment type is **Contract**, deduct tax at **5% (0.05)** when the monthly gross salary is **above LKR 150,000**.

Implementation requirements:

- Create a configurable deduction rule `CONTRACT_EMPLOYEE_TAX` with fields:
  - `employment_types`: [CONTRACT]
  - `rate`: 0.05
  - `threshold_amount`: 150000
  - `threshold_currency`: LKR
  - `threshold_period`: MONTHLY
  - `comparison`: GREATER_THAN (salary must be strictly above LKR 150,000; exactly LKR 150,000 = no deduction)
  - `calculation_basis`: FULL_AMOUNT (default) or EXCESS_OVER_THRESHOLD
  - `salary_base`: GROSS_MONTHLY_SALARY (configurable list of included earning components)
  - `effective_from`, `effective_to`
  - `liability_account`: e.g. 2230 Contract Employee Tax Payable
- Default behaviour (FULL_AMOUNT): if gross > 150,000, deduction = gross × 0.05; otherwise 0.
- Alternative (EXCESS_OVER_THRESHOLD): deduction = (gross − 150,000) × 0.05.
- Round to 2 decimal places (rounding rule configurable).
- If an employee is paid in a currency other than LKR, convert at the payroll-date exchange rate before comparing with the threshold; store the rate used.
- Whether this deduction replaces or applies in addition to APIT must be a configurable setting (`replaces_apit`: true/false, default false), to be confirmed by the client's accountant.
- Show the deduction as a separate line on the payslip.
- Post the deduction to the liability account and clear it when paid to the tax authority.
- Provide a monthly **Contract Employee Tax Deduction Report**: employee, NIC, TIN, gross, threshold, rate, deduction, period.
- Changes to the rule are audit-logged and versioned; past payroll runs keep the version used.

Required unit tests (must pass):

| Employment type | Gross monthly (LKR) | Basis | Expected deduction (LKR) |
|---|---|---|---|
| Contract | 120,000 | FULL_AMOUNT | 0.00 |
| Contract | 150,000 | FULL_AMOUNT | 0.00 |
| Contract | 150,001 | FULL_AMOUNT | 7,500.05 |
| Contract | 200,000 | FULL_AMOUNT | 10,000.00 |
| Contract | 200,000 | EXCESS_OVER_THRESHOLD | 2,500.00 |
| Permanent | 200,000 | FULL_AMOUNT | 0.00 (rule not applicable) |
| Contract (prorated, mid-month join) | 160,000 earned | FULL_AMOUNT | 8,000.00 |

### 13.3 Payroll security

Salary, payslip and payroll-run data is visible only to users with explicit payroll permissions. Employees see only their own payslips. Every view of another person's salary is audit-logged.

---

## 14. CRM

Customer master: company, contact, industry, country, website, phone, email, address, TIN/VAT number, account owner, status, tags, notes.

Pipeline: Lead → Qualified → Opportunity → Proposal → Negotiation → Won / Lost. Custom pipeline stages allowed.

---

## 15. LEAD MANAGEMENT

Sources: website, email, social media, manual entry, referral, campaign, import/API.

Fields: name, company, email, phone, country, source, campaign, service interest, estimated value, probability, owner, next follow-up, consent status (marketing).

Create follow-up reminders.

---

## 16. OPPORTUNITY MANAGEMENT

Fields: customer, lead/contact, service, expected value, currency, probability, expected close date, sales owner, sales stage, notes.

Weighted pipeline value = Expected Value × Probability.

Dashboard: pipeline value, weighted pipeline, won, lost, conversion rate, average deal size.

---

## 17. CUSTOMER 360

Display: customer information, contacts, leads, opportunities, projects, contracts, invoices, payments, outstanding balance, support tickets, documents, communication history, profitability.

Management should understand the entire customer relationship from one screen.

---

## 18. SUPPLIER / VENDOR MANAGEMENT (NEW)

Supplier master: name, contact, country, TIN/VAT number, bank details, payment terms, default expense account, WHT applicability, status, documents.

Supplier bills: bill number, supplier, date, due date, line items, tax, WHT, total, status (Draft, Approved, Partially Paid, Paid, Cancelled). Bills feed Accounts Payable and generate accounting entries.

---

## 19. CUSTOMER SUPPORT / TICKETING (NEW)

Tickets: number, customer, contact, project, subject, description, priority, status (Open, In Progress, Waiting on Customer, Resolved, Closed), assignee, SLA target, time spent, attachments.

Time spent on tickets can be logged as timesheet entries and billed under maintenance/support contracts.

---

## 20. PROJECT MANAGEMENT

Projects connect directly to CRM/customer records.

Fields: project ID, customer, opportunity, contract, project manager, team, start date, end date, status, priority, budget, billing model, currency, required skills.

Billing models: Fixed Price, Time & Material, Retainer, Milestone, Hourly, Monthly.

---

## 21. PROJECT TASK MANAGEMENT

Entities: Projects, Epics, Tasks, Subtasks, Milestones.

Task fields: title, description, assignee, reporter, priority, status, due date, estimated hours, actual hours, tags.

Configurable statuses: Backlog, To Do, In Progress, Review, Testing, Done, Blocked.

---

## 22. PROJECT RESOURCE MANAGEMENT

Show: employee availability, assigned projects, allocated hours, available hours, utilization, over-allocation. Availability must account for approved leave and public holidays.

Example: Employee 160 available hours; Project A 80 hours; Project B 60 hours; Available 20 hours.

Show warnings when employees exceed capacity.

---

## 23. TIMESHEETS

Record time against: customer, project, task, support ticket, activity.

Fields: date, start time, end time, break, hours, description, billable/non-billable.

Managers approve timesheets. Approved timesheets feed billing, project cost, employee utilization and accounting.

---

## 24. BILLABLE HOURS

Calculate: employee cost rate, billable rate, billable hours, non-billable hours, revenue, gross margin.

Employee cost rate should be derivable from payroll cost (salary + employer EPF/ETF + gratuity accrual + allocated overheads), configurable.

Example: cost $20/hour, billing $60/hour, gross contribution $40/hour.

Do NOT expose sensitive employee cost information to normal users.

---

## 25. PROJECT BUDGETING

Budget categories: employee cost, development, QA, project management, cloud, third-party services, marketing, other expenses.

Track: budget, actual, committed, remaining, variance.

Example: Budget $20,000; Actual $15,000; Remaining $5,000.

Warnings at 70%, 80%, 90%, 100% (thresholds configurable).

---

## 26. INVOICING

Fields: invoice number, customer, customer TIN/VAT number, project, billing period, currency, exchange rate, tax, discount, line items, subtotal, tax, total, payment terms, due date, notes.

Statuses: Draft, Pending Approval, Approved, Sent, Partially Paid, Paid, Overdue, Cancelled.

Support tax invoice format where VAT applies, and export (zero-rated) invoices for foreign customers, configurable.

Invoice numbering configurable. PDF generation required. Email invoice to customer.

---

## 27. CASH MEMO / CASH SALES

Fields: number, customer, date, items/services, quantity, unit price, discount, tax, total, payment method, cashier, notes.

Payment methods: cash, bank transfer, card, online, other.

A cash memo automatically creates the appropriate accounting transaction.

---

## 28. PAYMENT MANAGEMENT

Record: customer payments, supplier payments, payroll payments, statutory payments (EPF, ETF, APIT, contract employee tax, WHT), expenses, refunds.

Fields: reference, date, amount, currency, exchange rate, payment method, account, customer/supplier/employee, invoice/bill, notes.

Support partial payments.

---

## 29. ACCOUNTING ENGINE

Implement proper double-entry accounting. DO NOT create a simplistic income/expense table and call it accounting.

Entities: Chart of Accounts, Accounts, Journal Entries, Journal Lines, Fiscal Periods (with period close/lock), Tax Codes, Currencies, Exchange Rates, Bank Accounts, Cash Accounts.

Every financial transaction must produce balanced debit/credit entries.

Rule: **Total Debit = Total Credit.** Always validate before posting. Posting into a closed period is blocked.

---

## 30. CHART OF ACCOUNTS

Default structure (configurable):

```
1000 Assets
  1100 Bank
  1200 Cash
  1300 Accounts Receivable
  1400 Employee Advances & Loans
2000 Liabilities
  2100 Accounts Payable
  2200 Tax Payable
    2210 VAT Payable
    2220 APIT Payable
    2230 Contract Employee Tax Payable
    2240 WHT Payable
  2300 EPF Payable
  2310 ETF Payable
  2320 Salaries Payable
  2400 Gratuity Provision
3000 Equity
4000 Revenue
  4100 Software Development Revenue
  4200 Consulting Revenue
  4300 Maintenance Revenue
5000 Cost of Sales
6000 Operating Expenses
  6100 Salaries
  6110 EPF Employer Contribution
  6120 ETF Contribution
  6130 Gratuity Expense
  6200 Rent
  6300 Marketing
  6400 Software
  6500 Cloud
  6600 Travel
```

Administrators/accountants can configure accounts.

---

## 31. ACCOUNTING AUTOMATION

Automatically generate entries for: invoice, customer payment, cash memo, supplier bill, supplier payment, expense, refund, credit note, debit note, **payroll posting**, statutory payment.

Examples:

Invoice — Dr Accounts Receivable; Cr Service Revenue; Cr Tax Payable.

Payment — Dr Bank; Cr Accounts Receivable.

Payroll (contract employee, gross LKR 200,000, FULL_AMOUNT basis, assuming EPF applicable):
```
Dr 6100 Salaries                          200,000.00
Dr 6110 EPF Employer (12%)                 24,000.00
Dr 6120 ETF (3%)                            6,000.00
   Cr 2300 EPF Payable (8% + 12%)                     40,000.00
   Cr 2310 ETF Payable                                 6,000.00
   Cr 2230 Contract Employee Tax Payable              10,000.00
   Cr 2320 Salaries Payable (net)                    174,000.00
Total Dr 230,000.00 = Total Cr 230,000.00
```

Maintain full transaction references to the source document.

---

## 32. FINANCIAL REPORTS

Profit & Loss, Balance Sheet, Trial Balance, General Ledger, Cash Flow, Accounts Receivable ageing, Accounts Payable ageing, Expense Report, Revenue Report, Tax Report (VAT, SSCL, WHT, APIT, contract employee tax), Payroll Cost Report, Project Profitability, Customer Profitability.

Filters: date range, fiscal year, department, project, customer, supplier, account, currency.

Export: PDF, Excel, CSV.

---

## 33. BUDGET MANAGEMENT

Budgets: annual, department, project, marketing, employee/payroll, expense.

Track: budget, actual, forecast, variance.

Dashboard: budget utilization, over-budget departments, forecasted revenue, forecasted expenses, expected profit.

---

## 34. EXPENSE MANAGEMENT

Categories: travel, meals, accommodation, software, hardware, internet, transport, other.

Workflow: Employee → Manager → Finance → Paid. Attach receipts. Reimbursements can be paid through payroll or separately. OCR integration can be added later.

---

## 35. MARKETING MANAGEMENT

Campaign: name, channel, start date, end date, budget, target audience, owner, status.

Channels: Google Ads, Facebook, Instagram, LinkedIn, Email, SEO, Website, Other.

Track: spend, leads, conversions, revenue, cost per lead, customer acquisition cost, ROI. Connect campaigns to CRM leads.

---

## 36. EMAIL MARKETING

Campaign creation, templates, contact lists, segmentation, scheduling, delivery tracking, unsubscribe handling, consent tracking.

Integrate through a provider interface (SendGrid, Amazon SES, Mailchimp, Constant Contact). Do not hard-code one provider.

---

## 37. EMPLOYEE SKILL MANAGEMENT

Skill: category, name, description. Examples: PHP, Laravel, React, Node.js, AWS, Azure, Docker, Kubernetes, Python, AI, Machine Learning, SEO, Google Ads, Project Management, Business Analysis, QA.

Employee skills: skill, level, years experience, last assessed, certification, assessor.

Levels: Beginner (1–2), Intermediate (3), Advanced (4), Expert (5). Numeric score 1–5 internally.

---

## 38. SKILL GAP ANALYSIS

Each project defines required skills (e.g. Laravel – Advanced, React – Intermediate, AWS – Intermediate).

Compare required vs employee skills; calculate Skill Match %; show strong match, partial match, skill gap.

Management dashboard: missing skills, employees ready for projects, training requirements, critical company skill gaps.

---

## 39. PERFORMANCE EVALUATION

Configurable forms. Categories: technical, quality, communication, teamwork, leadership, problem solving, productivity, customer satisfaction, time management, learning.

Managers evaluate; optional self-assessment. Cycles: monthly, quarterly, half-yearly, annual (configurable).

---

## 40. PERFORMANCE SCORE

Example weights: Technical 25%, Quality 20%, Productivity 15%, Communication 10%, Teamwork 10%, Leadership 10%, Learning 10%. Weights configurable; must total 100%.

Calculate overall score. Do NOT automatically use performance scores for employment, pay or contract-renewal decisions without human review.

---

## 41. TRAINING MANAGEMENT

Courses (internal/external), certifications, training requests.

Track: employee, course, cost, date, status, result, certificate expiry. Connect training to skill gaps (e.g. gap AWS Advanced → recommend AWS Solutions Architect).

---

## 42. TOP MANAGEMENT DASHBOARD

KPIs: revenue, expenses, gross profit, net profit, cash balance, AR, AP, MRR, sales pipeline, new leads, conversion rate, active customers, active projects, project profitability, employee count (by employment type), payroll cost, statutory liabilities due, employee utilization, attendance, leave, skill gaps, marketing ROI, open support tickets.

Charts: revenue, expense and profit trends; sales pipeline; project profitability; utilization; department performance.

---

## 43. PROJECT MANAGER DASHBOARD

My projects, status, tasks, milestones, budget, actual cost, hours, billable hours, team utilization, overdue tasks, risks, customer status, linked support tickets.

---

## 44. HR DASHBOARD

Employee count, new employees, departures, contracts ending soon, attendance, absences, leave, utilization, skills, skill gaps, performance, training, document expirations, payroll status.

---

## 45. FINANCE DASHBOARD

Revenue, expenses, profit, cash, bank balances, outstanding invoices, overdue invoices, AP, tax and statutory liabilities due (VAT, EPF, ETF, APIT, contract employee tax, WHT), project profitability, customer profitability.

---

## 46. SALES DASHBOARD

Leads, opportunities, pipeline, won, lost, conversion, expected revenue, salesperson performance, campaign sources.

---

## 47. MARKETING DASHBOARD

Campaign spend, leads, conversions, cost per lead, CAC, revenue, ROI, channel performance.

---

## 48. EMPLOYEE DASHBOARD

Only permitted information: today's attendance, sign in/out, leave balance, my tasks, my projects, timesheets, my payslips, my skills, training, performance, notifications, documents, my data/privacy requests.

---

## 49. NOTIFICATION ENGINE

Channels: in-app, email, push, SMS (via provider interface, for Sri Lankan mobile numbers).

Events: new task, task assigned, leave approval, timesheet approval, invoice approval, payment received, invoice overdue, budget warning, payroll ready for approval, payslip published, statutory payment due, contract ending, skill assessment, training reminder, document expiry, birthday (if enabled).

Notifications in the user's preferred language.

---

## 50. APPROVAL WORKFLOW ENGINE

Configurable workflows, e.g.:

- Leave: Employee → Manager → HR
- Expense: Employee → Manager → Finance
- Invoice: Project Manager → Finance → Management
- Purchase: Employee → Manager → Finance
- Payroll: Payroll Officer → HR Manager → Finance Manager
- Contract renewal: Manager → HR → Management

Future workflows must be configurable without rewriting code. Support delegation when an approver is on leave.

---

## 51. AUDIT LOG

Log every sensitive action: user, action, module, record, old value, new value, IP, timestamp.

Especially: financial changes, payroll runs and tax rule changes, employee changes, salary views and changes, permissions, roles, invoices, payments, accounting entries, personal data exports and deletions.

Audit logs are append-only and not editable by normal administrators.

---

## 52. SECURITY

RBAC, permission checks, JWT, refresh token rotation, password hashing (Argon2 or bcrypt), MFA (required for admin, payroll and finance roles), rate limiting, input validation, secure file uploads (type/size checks, malware scanning hook), SQL injection protection, XSS protection, CSRF protection where applicable, audit logging, encryption at rest for sensitive fields (NIC, bank, salary, tax), TLS in transit.

Never store plaintext passwords. Never store payment card information.

---

## 53. MULTI-CURRENCY

Support: LKR (base), USD, NZD, AUD, GBP, CAD, EUR. Currencies configurable.

Exchange rates configurable/importable (e.g. Central Bank of Sri Lanka rates).

Store transaction currency, base currency, and exchange rate. Never overwrite original transaction amounts. Record realised and unrealised exchange gains/losses.

---

## 54. DATA PROTECTION — SRI LANKA PDPA (NEW)

The Personal Data Protection Act No. 9 of 2022 (as amended) has key provisions operating from 1 January 2027. Build for compliance from the start:

- **Lawful basis and purpose** recorded for each category of personal data (employee, candidate, customer contact, lead).
- **Privacy notices** for employees, candidates and customers; record acknowledgement.
- **Consent management** for marketing and optional processing (e.g. location tracking, birthday notifications).
- **Data minimisation**: collect only fields required for each purpose.
- **Retention policies** per data category with automated review/anonymisation after the retention period.
- **Data subject requests**: log and track access, correction and deletion requests with deadlines (build ready even where rights are not yet in force).
- **Breach register** and notification workflow.
- **Records of processing** and **DPIA** templates (attendance location tracking, AI candidate/employee analysis, payroll are likely high-risk).
- **Cross-border transfer register**: list every external provider (hosting, email, SMS, AI) and where it processes data.
- **Data Protection Officer** role with access to the above.

The client's legal adviser must confirm obligations before go-live.

---

## 55. MULTI-TAX

Tax configuration: name, rate, inclusive/exclusive, account mapping, applicable documents, effective dates. Do not hard-code tax rules. Tax configuration must be country/company configurable (Sri Lankan taxes seeded per Section 2.4).

---

## 56. DOCUMENT NUMBERING

Configurable sequences for: Employee ID, Customer ID, Supplier ID, Lead ID, Project ID, Ticket, Invoice, Cash Memo, Supplier Bill, Payment, Expense, Payroll Run, Journal Entry.

Example: `INV-2026-000001`. Administrators configure prefixes, sequences and fiscal-year reset. Numbers must be gap-free for invoices where required.

---

## 57. SEARCH

Global search across permitted records: employees, customers, suppliers, projects, tasks, tickets, invoices, leads, expenses, documents. Respect permissions. Salary data never appears in search results.

---

## 58. IMPORT / EXPORT

Import (CSV, Excel): employees, customers, suppliers, leads, products/services, opening balances, opening leave balances, holiday calendars, exchange rates.

Export reports: CSV, Excel, PDF. Exports of personal data are audit-logged.

---

## 59. BACKUP

Document: daily backups, point-in-time recovery, retention, encryption of backups, off-site copy, recovery time and recovery point objectives, disaster recovery, tested restore procedures.

---

## 60. API INTEGRATION ARCHITECTURE

Integration interfaces for: payment providers, email, SMS (Sri Lankan gateways), AI, accounting export, bank feeds and bank transfer files (Sri Lankan bank formats), marketing platforms, calendar, cloud storage.

Do not tightly couple the application to external providers.

---

## 61. AI FEATURES

AI is optional and can be disabled per company.

Potential features: skill recommendations, project resource recommendations, lead scoring, CRM summaries, customer communication drafting, marketing content, invoice/expense classification, financial report summaries, skill-gap recommendations, project risk detection, task estimation assistance.

Example: "Based on project requirements and employee skills, recommend the best available team."

Rules:
- AI recommendations must be explainable and subject to human approval.
- AI must never make or finalise hiring, termination, pay, payroll or contract-renewal decisions.
- Send only the minimum personal data needed; never send NIC, bank or salary data to AI providers unless explicitly configured and recorded in the cross-border transfer register.
- Log every AI request and recommendation (`ai_requests`, `ai_recommendations`).

---

## 62. REPORT BUILDER

Authorised users select fields, filters, grouping, sorting, date ranges. Save reports. Schedule reports by email. Field-level permissions apply (no salary fields unless permitted).

---

## 63. DATABASE TABLES

At minimum:

**Core:** companies, business_units, departments, teams, designations, job_levels, locations, users, roles, permissions, role_permissions, user_roles, settings

**HR:** employees, employment_contracts, employee_documents, employee_skills, skills, skill_categories, certifications, training, training_records, performance_cycles, performance_reviews

**Attendance & leave:** attendance, attendance_breaks, leave_types, leave_entitlement_rules, leave_balances, leave_requests, holidays

**Payroll & statutory:** salary_structures, earning_components, deduction_components, statutory_rules, statutory_rule_versions, tax_slabs, payroll_runs, payroll_run_lines, payslips, employee_loans, gratuity_records, statutory_payments

**CRM & support:** customers, customer_contacts, leads, lead_sources, opportunities, sales_stages, activities, communications, support_tickets, ticket_comments

**Suppliers:** suppliers, supplier_bills, supplier_bill_lines

**Projects:** projects, project_members, project_required_skills, project_tasks, task_comments, task_attachments, milestones, timesheets, time_entries, resource_allocations

**Budgets:** budgets, budget_lines, project_budgets

**Billing:** invoices, invoice_lines, credit_notes, debit_notes, payments, payment_allocations, cash_memos, cash_memo_lines

**Expenses:** expenses, expense_categories, expense_claims

**Accounting:** chart_of_accounts, accounts, journal_entries, journal_lines, fiscal_periods, tax_codes, currencies, exchange_rates, bank_accounts

**Marketing:** marketing_campaigns, marketing_channels, campaign_leads, marketing_expenses, marketing_consents

**Data protection:** privacy_notices, consents, processing_records, retention_policies, data_subject_requests, breach_register, cross_border_transfers

**Platform:** notifications, documents, audit_logs, approval_workflows, approval_steps, approval_requests, number_sequences, translations, ai_requests, ai_recommendations

---

## 64. FINANCIAL AND PAYROLL INTEGRITY

Extremely important.

- Never delete posted financial or payroll transactions.
- States: Draft → Posted → Reversed.
- If a transaction is wrong, create a reversal transaction.
- Maintain complete audit history.
- Journal entries must always balance.
- Use database transactions when posting financial documents and payroll.
- Closed fiscal periods cannot be posted to.

---

## 65. USER ACCESS EXAMPLE

- SUPER ADMIN: everything.
- TOP MANAGEMENT: company-wide dashboards, financial reports, payroll summaries, projects, HR analytics, CRM, marketing, approvals.
- ADMIN: operational administration according to permissions.
- HR: employees, contracts, attendance, leave, skills, performance, training.
- PAYROLL OFFICER: payroll runs, payslips, statutory reports.
- FINANCE: invoices, supplier bills, payments, expenses, accounting, budgets, payroll posting.
- PROJECT MANAGER: assigned projects, tasks, timesheets, resources, project budgets.
- SALES: leads, CRM, customers, opportunities.
- MARKETING: campaigns, marketing analytics, leads.
- SUPPORT AGENT: tickets for assigned customers.
- DATA PROTECTION OFFICER: privacy registers, requests, breach log, audit logs (read-only).
- EMPLOYEE: own HR, attendance, leave, payslips, tasks, projects, timesheets, skills, training.

Every permission must be configurable.

---

## 66. DESIGN

Enterprise SaaS interface: sidebar, top navigation, breadcrumbs, dashboard cards, charts, tables, filters, modal forms, drawer forms, tabs. Dark and light mode. Language switcher (English/Sinhala/Tamil) with correct fonts and line heights for Sinhala and Tamil scripts.

Professional and modern. Do not make it look like an old accounting application.

---

## 67. DASHBOARD CUSTOMIZATION

Widgets can be enabled, disabled, moved, resized. Default dashboards depend on role.

---

## 68. MOBILE RESPONSIVENESS

Works on desktop, laptop, tablet, mobile. Employee attendance, leave requests and payslip viewing must be especially easy on mobile. Later provide a React Native app using the same APIs.

---

## 69. PERFORMANCE

Support: 1,000 employees, 10,000 customers, 100,000 CRM activities, 1,000,000 time entries, millions of accounting records, payroll run for 1,000 employees in under 2 minutes.

Use pagination, lazy loading, indexes, caching, background jobs. Never load huge tables into the browser.

---

## 70. DEVELOPMENT PROCESS

DO NOT attempt to generate the whole system at once. Build in phases. Each phase ends with a working, tested, deployable increment.

| Phase | Scope |
|---|---|
| 0 | Architecture, ERD, UI design, security architecture, PDPA design |
| 1 | Authentication, users, roles, permissions, organization, i18n, audit log |
| 2 | Employee HRM, contracts, attendance, sign-in/out, leave, holidays |
| 3 | Payroll and statutory deductions (EPF, ETF, APIT, contract employee tax, gratuity) |
| 4 | CRM, customers, leads, opportunities, support tickets |
| 5 | Projects, tasks, timesheets, resources |
| 6 | Suppliers, budgeting, expenses, billing, invoices, cash memo |
| 7 | Accounting, chart of accounts, journals, payments, payroll posting, financial reports |
| 8 | Marketing |
| 9 | Skills, performance, training |
| 10 | Dashboards, report builder, AI |
| 11 | Security hardening, PDPA review, testing, performance, deployment |

**Recommended MVP:** Phases 0–3. Validate with real users before continuing.

### Acceptance criteria
Before starting each phase, write acceptance criteria as testable statements (e.g. "Leave balance decreases only after final HR approval"; "A contract employee with gross LKR 200,000 has LKR 10,000.00 contract tax deducted"). A phase is not complete until all criteria pass.

---

## 71. CLAUDE WORKING RULES

Before coding:
1. Understand the entire architecture.
2. Create the repository structure.
3. Create the database ERD.
4. Identify module dependencies.
5. Identify security boundaries.
6. Identify financial and payroll transaction flows.
7. Identify personal data flows (PDPA).

For every phase:
1. Explain objective and acceptance criteria.
2. Implement code.
3. Create migrations.
4. Create API endpoints.
5. Create frontend screens.
6. Create unit, integration and end-to-end tests.
7. Run lint.
8. Run tests.
9. Fix errors.
10. Review security and data protection.
11. Document changes.
12. Stop and wait for approval before the next phase.

Never pretend functionality has been implemented if it has not. Do not create fake APIs. Do not use mock data in production functionality; mock data may only be used for UI development and must be clearly separated. Never hard-code statutory rates; always read them from versioned configuration. When a legal or tax rule is unclear, flag it in `docs/OPEN_QUESTIONS.md` instead of guessing.

---

## 72. REPOSITORY STRUCTURE

```
/apps
  /web
  /api
/packages
  /shared
  /ui
  /config
  /types
  /i18n
/infrastructure
/docs
/tests
```

---

## 73. REQUIRED DOCUMENTATION

README.md, ARCHITECTURE.md, DATABASE.md, API.md, SECURITY.md, DEPLOYMENT.md, ACCOUNTING.md, PAYROLL.md (including statutory rules and the contract employee tax rule), RBAC.md, HRM.md, CRM.md, PROJECTS.md, DATA_PROTECTION.md, TESTING.md, ENVIRONMENT.md, OPEN_QUESTIONS.md.

---

## 74. INITIAL DELIVERABLE

DO NOT start by writing hundreds of files. First produce:

1. Product architecture
2. Module architecture
3. System architecture diagram
4. Database ERD
5. Entity relationship explanation
6. RBAC model
7. Accounting architecture
8. Payroll and statutory deduction architecture (including the contract employee tax rule and its test cases)
9. Attendance architecture
10. Approval workflow architecture
11. Data protection (PDPA) architecture
12. API architecture
13. Repository structure
14. UI navigation structure
15. Development roadmap with acceptance criteria per phase
16. Estimated development effort
17. Infrastructure architecture
18. Open questions for the client (legal, tax, payroll)

Use Mermaid diagrams wherever useful.

Then wait for approval before implementing Phase 1.

The objective is to build a real integrated IT company management platform, not a collection of disconnected CRUD screens.
