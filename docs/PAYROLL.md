# Payroll and statutory rules (Sri Lanka)

## Monthly process

| Step | Who | What happens |
|---|---|---|
| 1. Create run | Payroll officer (`PAYROLL_RUN`) | One active run per month. Number from the `PAYROLL_RUN` sequence. |
| 2. Calculate | Payroll officer | Everyone with a salary effective in the period. Reads salaries, this month's adjustments, approved no-pay leave, holidays and the statutory rule versions in force at the period end. Can be repeated. |
| 3. Approve | Finance manager (`PAYROLL_APPROVE`) | Must be a different person from the preparer (super admin excepted). Can be sent back with a reason. |
| 4. Post | Finance manager | Payslip numbers are assigned, payslips become visible to employees, the run becomes immutable. |
| 5. Email payslips | Finance manager | Each employee gets the PAYSLIP_PUBLISHED email in their language with the PDF attached. |
| 6. Files | `PAYROLL_EXPORT` | EPF, ETF, APIT, contract employee tax and bank transfer CSVs. |
| Corrections | Finance manager | Posted payroll is never edited: reverse it (reason required) and create a new run. |

## Calculation (per employee)

All arithmetic is in integer cents with half-up rounding (`packages/shared/src/money.ts`).

1. **Earnings.** Fixed components (BASIC, allowances) are prorated by employed working days / working days in the month (joiners and leavers). Variable items (overtime, bonus) are not prorated.
2. **No-pay.** `basic ÷ working days × no-pay days` (or a fixed divisor such as 30 — configurable).
3. **Gross** = earnings − no-pay. **EPF base** = EPF-liable earnings − no-pay.
4. **EPF** employee 8% and employer 12%, **ETF** 3% of the EPF base, for the employment types configured on each rule.
5. **Contract employee tax** — see below.
6. **APIT** — progressive monthly slabs on taxable income.
7. **Other deductions** — loans, advances.
8. **Net** = total earnings − all deductions.
9. **Gratuity provision** — `monthsPerYearOfService ÷ 12 × basic` per month (default half a month per year).

Every line stores a human-readable trace (`detail.trace`) so the payroll officer can see exactly how each figure was reached.

## Contract employee tax (Section 13.2)

> For employees whose employment type is **Contract**, deduct tax at **5%** when the **monthly gross salary is above LKR 150,000**.

Configured as the `CONTRACT_EMPLOYEE_TAX` rule (Payroll → Statutory rules):

| Setting | Default | Options |
|---|---|---|
| Employment types | CONTRACT | any |
| Rate | 5% | |
| Threshold | LKR 150,000 / month | |
| Comparison | Above (exactly 150,000 → no deduction) | at or above |
| Basis | **Full amount** (200,000 → 10,000) | Excess over threshold (200,000 → 2,500) |
| Salary base | All gross earnings | Selected components only |
| Replaces APIT | **No** — deducted in addition to APIT | Yes |
| Liability account | 2230 Contract Employee Tax Payable | |

Foreign-currency salaries are converted to LKR at the latest exchange rate on or before the period end, compared with the threshold, and the deduction converted back.

Required test cases — all pass (`packages/shared/src/payroll/engine.test.ts`) and the LKR 200,000 case is also verified end-to-end through the API:

| Type | Gross (LKR) | Basis | Deduction |
|---|---|---|---|
| Contract | 120,000 | Full | 0.00 |
| Contract | 150,000 | Full | 0.00 |
| Contract | 150,001 | Full | 7,500.05 |
| Contract | 200,000 | Full | 10,000.00 |
| Contract | 200,000 | Excess | 2,500.00 |
| Permanent | 200,000 | Full | 0.00 |
| Contract, mid-month joiner | 160,000 earned | Full | 8,000.00 |

## Versioned rules

Rules are never edited in place. Adding a version with an effective date closes the previous version the day before. A version cannot start inside a period that is already approved or posted. Each run stores a snapshot of the exact rule versions it used, so past payroll never changes when the law does.

Seeded defaults (effective 1 April 2025 — **confirm with your accountant**, see OPEN_QUESTIONS.md):

| Rule | Default |
|---|---|
| EPF employee / employer | 8% / 12% — Permanent, Probation, Contract |
| ETF | 3% — Permanent, Probation, Contract |
| APIT (monthly) | 0% to 150,000; 6% next 83,333.33; 18%, 24%, 30% on next 41,666.67 each; 36% above |
| Contract employee tax | 5% of full gross when gross > 150,000; in addition to APIT |
| Gratuity | ½ month basic per year; payable after 5 years |
| No-pay | basic ÷ working days |

## Payroll journal

Calculated with every run (in LKR) and shown on the run page. It will be posted to the general ledger when the accounting module (Phase 7) is built.

| Account | Debit | Credit |
|---|---|---|
| 6100 Salaries | gross | |
| 6110 EPF employer | 12% | |
| 6120 ETF | 3% | |
| 6130 Gratuity expense | provision | |
| 2300 EPF payable | | 8% + 12% |
| 2310 ETF payable | | 3% |
| 2220 APIT payable | | APIT |
| 2230 Contract employee tax payable | | contract tax |
| 1400 Employee advances & loans | | other deductions |
| 2400 Gratuity provision | | provision |
| 2320 Salaries payable | | net |

The engine throws if debits and credits differ by even one cent.
