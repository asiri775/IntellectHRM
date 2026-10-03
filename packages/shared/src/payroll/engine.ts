import { applyRate, fromCents, prorate, toCents } from '../money';
import type {
  ApitRuleConfig,
  ContractTaxRuleConfig,
  PayrollRuleSet,
  PayslipInput,
  PayslipLine,
  PayslipResult,
} from './types';

const fmt = (cents: number) => fromCents(cents).toFixed(2);

/** Convert pay-currency cents to LKR cents. */
function toLkr(cents: number, rate: number): number {
  return rate === 1 ? cents : Math.round(cents * rate);
}
/** Convert LKR cents back to pay-currency cents. */
function fromLkr(cents: number, rate: number): number {
  return rate === 1 ? cents : Math.round(cents / rate);
}

/**
 * Section 13.2 contract employee tax.
 * Returns the deduction in LKR cents (0 when not applicable).
 */
export function calculateContractTaxLkr(
  employmentType: PayslipInput['employmentType'],
  baseLkrCents: number,
  rule: ContractTaxRuleConfig,
): { cents: number; note: string } {
  if (!rule.employmentTypes.includes(employmentType)) {
    return { cents: 0, note: `Not applicable to ${employmentType}` };
  }
  const threshold = toCents(rule.thresholdAmount);
  const over =
    rule.comparison === 'GREATER_THAN' ? baseLkrCents > threshold : baseLkrCents >= threshold;
  if (!over) {
    return {
      cents: 0,
      note: `Base LKR ${fmt(baseLkrCents)} is not ${rule.comparison === 'GREATER_THAN' ? 'above' : 'at or above'} threshold LKR ${fmt(threshold)}`,
    };
  }
  const taxable = rule.basis === 'FULL_AMOUNT' ? baseLkrCents : baseLkrCents - threshold;
  const cents = applyRate(taxable, rule.rate);
  return {
    cents,
    note:
      rule.basis === 'FULL_AMOUNT'
        ? `${(rule.rate * 100).toFixed(2)}% × LKR ${fmt(baseLkrCents)}`
        : `${(rule.rate * 100).toFixed(2)}% × (LKR ${fmt(baseLkrCents)} − LKR ${fmt(threshold)})`,
  };
}

/** Progressive monthly APIT in LKR cents. */
export function calculateApitLkr(taxableLkrCents: number, rule: ApitRuleConfig): number {
  let remaining = Math.max(0, taxableLkrCents);
  let tax = 0;
  for (const slab of rule.slabs) {
    if (remaining <= 0) break;
    const width = slab.width === null ? remaining : Math.min(remaining, toCents(slab.width));
    tax += applyRate(width, slab.rate);
    remaining -= width;
  }
  return tax;
}

/**
 * Calculate one employee's payslip for a period.
 * Pure function: same inputs and rule versions always produce the same output.
 */
export function calculatePayslip(input: PayslipInput, rules: PayrollRuleSet): PayslipResult {
  const trace: string[] = [];
  const rate = input.exchangeRateToLkr || 1;
  const type = input.employmentType;
  const basicCode = input.basicCode ?? 'BASIC';

  if (input.workingDays <= 0) throw new Error('workingDays must be greater than zero');
  const employedDays = Math.max(0, Math.min(input.employedDays, input.workingDays));

  // 1. Earnings (prorate fixed components for partial months).
  const earnings: PayslipLine[] = [];
  const earnCents: { code: string; cents: number; epf: boolean; taxable: boolean }[] = [];
  for (const e of input.earnings) {
    const full = toCents(e.amount);
    const cents = e.fixed ? prorate(full, employedDays, input.workingDays) : full;
    const note =
      e.fixed && employedDays < input.workingDays
        ? `Prorated ${employedDays}/${input.workingDays} days of ${fmt(full)}`
        : undefined;
    earnings.push({ code: e.code, name: e.name, amount: fromCents(cents), note });
    earnCents.push({ code: e.code, cents, epf: e.epfApplicable, taxable: e.taxable });
  }

  // 2. No-pay deduction from basic.
  let noPay = 0;
  if (input.noPayDays > 0) {
    const basic = input.earnings.find((e) => e.code === basicCode);
    if (basic) {
      const divisor =
        rules.NO_PAY.divisor === 'FIXED' ? rules.NO_PAY.fixedDivisor : input.workingDays;
      noPay = prorate(toCents(basic.amount), input.noPayDays, divisor);
      trace.push(`No-pay: ${input.noPayDays} day(s) × basic ${fmt(toCents(basic.amount))} / ${divisor} = ${fmt(noPay)}`);
    }
  }

  const grossCents = earnCents.reduce((s, x) => s + x.cents, 0) - noPay;
  const epfBase = Math.max(0, earnCents.filter((x) => x.epf).reduce((s, x) => s + x.cents, 0) - noPay);
  const taxableCents = Math.max(0, earnCents.filter((x) => x.taxable).reduce((s, x) => s + x.cents, 0) - noPay);
  trace.push(`Gross earnings ${fmt(grossCents)}; EPF base ${fmt(epfBase)}; taxable ${fmt(taxableCents)}`);

  // 3. EPF / ETF.
  const epfEmployee = rules.EPF_EMPLOYEE.employmentTypes.includes(type)
    ? applyRate(epfBase, rules.EPF_EMPLOYEE.rate)
    : 0;
  const epfEmployer = rules.EPF_EMPLOYER.employmentTypes.includes(type)
    ? applyRate(epfBase, rules.EPF_EMPLOYER.rate)
    : 0;
  const etf = rules.ETF.employmentTypes.includes(type) ? applyRate(epfBase, rules.ETF.rate) : 0;
  trace.push(`EPF employee ${fmt(epfEmployee)}, EPF employer ${fmt(epfEmployer)}, ETF ${fmt(etf)}`);

  // 4. Contract employee tax (Section 13.2) — compared in LKR.
  const ct = rules.CONTRACT_EMPLOYEE_TAX;
  const ctBasePay =
    ct.includedComponents.length === 0
      ? grossCents
      : earnCents.filter((x) => ct.includedComponents.includes(x.code)).reduce((s, x) => s + x.cents, 0) -
        (ct.includedComponents.includes(basicCode) ? noPay : 0);
  const ctBaseLkr = toLkr(ctBasePay, rate);
  const ctResult = calculateContractTaxLkr(type, ctBaseLkr, ct);
  const contractTax = fromLkr(ctResult.cents, rate);
  trace.push(`Contract tax: ${ctResult.note} = ${fmt(ctResult.cents)} LKR`);

  // 5. APIT.
  let apit = 0;
  const apitSuppressed = ct.replacesApit && ctResult.cents > 0;
  if (rules.APIT.employmentTypes.includes(type) && !apitSuppressed) {
    apit = fromLkr(calculateApitLkr(toLkr(taxableCents, rate), rules.APIT), rate);
    trace.push(`APIT on taxable ${fmt(taxableCents)} = ${fmt(apit)}`);
  } else if (apitSuppressed) {
    trace.push('APIT not deducted: contract employee tax replaces APIT (replacesApit = true)');
  }

  // 6. Other deductions.
  const deductions: PayslipLine[] = [];
  if (noPay) deductions.push({ code: 'NO_PAY', name: 'No-pay leave', amount: fromCents(noPay), note: `${input.noPayDays} day(s)` });
  if (epfEmployee)
    deductions.push({ code: 'EPF_EMPLOYEE', name: `EPF employee (${(rules.EPF_EMPLOYEE.rate * 100).toFixed(0)}%)`, amount: fromCents(epfEmployee) });
  if (apit) deductions.push({ code: 'APIT', name: 'APIT / PAYE tax', amount: fromCents(apit) });
  if (contractTax)
    deductions.push({
      code: 'CONTRACT_EMPLOYEE_TAX',
      name: `Contract employee tax (${(ct.rate * 100).toFixed(2).replace(/\.00$/, '')}%)`,
      amount: fromCents(contractTax),
      note: ctResult.note,
    });
  let other = 0;
  for (const d of input.deductions) {
    const c = toCents(d.amount);
    other += c;
    deductions.push({ code: d.code, name: d.name, amount: fromCents(c) });
  }

  // Net pay = total earnings − all deductions (no-pay included) = gross − statutory − other.
  const totalEarnings = grossCents + noPay;
  const totalDeductions = noPay + epfEmployee + apit + contractTax + other;
  const net = totalEarnings - totalDeductions;

  // 7. Gratuity accrual (provision): monthsPerYear × basic / 12 per month.
  let gratuity = 0;
  if (rules.GRATUITY.employmentTypes.includes(type)) {
    const basic = earnCents.find((x) => x.code === basicCode)?.cents ?? 0;
    gratuity = applyRate(basic, rules.GRATUITY.monthsPerYearOfService / 12);
  }

  const employerContributions: PayslipLine[] = [];
  if (epfEmployer)
    employerContributions.push({ code: 'EPF_EMPLOYER', name: `EPF employer (${(rules.EPF_EMPLOYER.rate * 100).toFixed(0)}%)`, amount: fromCents(epfEmployer) });
  if (etf) employerContributions.push({ code: 'ETF', name: `ETF (${(rules.ETF.rate * 100).toFixed(0)}%)`, amount: fromCents(etf) });
  if (gratuity) employerContributions.push({ code: 'GRATUITY_ACCRUAL', name: 'Gratuity provision', amount: fromCents(gratuity) });

  trace.push(`Net pay ${fmt(net)}`);

  return {
    currency: input.currency,
    exchangeRateToLkr: rate,
    earnings,
    deductions,
    employerContributions,
    totalEarnings: fromCents(totalEarnings),
    grossEarnings: fromCents(grossCents),
    epfBase: fromCents(epfBase),
    taxableIncome: fromCents(taxableCents),
    epfEmployee: fromCents(epfEmployee),
    epfEmployer: fromCents(epfEmployer),
    etf: fromCents(etf),
    apit: fromCents(apit),
    contractTax: fromCents(contractTax),
    noPay: fromCents(noPay),
    otherDeductions: fromCents(other),
    totalDeductions: fromCents(totalDeductions),
    netPay: fromCents(net),
    gratuityAccrual: fromCents(gratuity),
    totalEmployerCost: fromCents(grossCents + epfEmployer + etf + gratuity),
    trace,
  };
}

export interface JournalLine {
  account: string;
  name: string;
  debit: number;
  credit: number;
}

export const DEFAULT_PAYROLL_ACCOUNTS = {
  SALARIES: { code: '6100', name: 'Salaries' },
  EPF_EMPLOYER_EXPENSE: { code: '6110', name: 'EPF Employer Contribution' },
  ETF_EXPENSE: { code: '6120', name: 'ETF Contribution' },
  GRATUITY_EXPENSE: { code: '6130', name: 'Gratuity Expense' },
  EPF_PAYABLE: { code: '2300', name: 'EPF Payable' },
  ETF_PAYABLE: { code: '2310', name: 'ETF Payable' },
  APIT_PAYABLE: { code: '2220', name: 'APIT Payable' },
  CONTRACT_TAX_PAYABLE: { code: '2230', name: 'Contract Employee Tax Payable' },
  SALARIES_PAYABLE: { code: '2320', name: 'Salaries Payable' },
  GRATUITY_PROVISION: { code: '2400', name: 'Gratuity Provision' },
  OTHER_DEDUCTIONS: { code: '1400', name: 'Employee Advances & Loans' },
} as const;

/**
 * Build the balanced payroll journal (Section 31) for a set of payslips.
 * Throws if debits and credits do not balance.
 */
export function buildPayrollJournal(
  slips: Pick<
    PayslipResult,
    'grossEarnings' | 'epfEmployee' | 'epfEmployer' | 'etf' | 'apit' | 'contractTax' | 'otherDeductions' | 'netPay' | 'gratuityAccrual'
  >[],
  accounts: typeof DEFAULT_PAYROLL_ACCOUNTS = DEFAULT_PAYROLL_ACCOUNTS,
): { lines: JournalLine[]; totalDebit: number; totalCredit: number } {
  const sum = (k: keyof (typeof slips)[number]) => slips.reduce((s, x) => s + toCents(x[k] as number), 0);
  const gross = sum('grossEarnings');
  const epfEe = sum('epfEmployee');
  const epfEr = sum('epfEmployer');
  const etf = sum('etf');
  const apit = sum('apit');
  const ct = sum('contractTax');
  const other = sum('otherDeductions');
  const net = sum('netPay');
  const grat = sum('gratuityAccrual');

  const raw: [keyof typeof accounts, number, number][] = [
    ['SALARIES', gross, 0],
    ['EPF_EMPLOYER_EXPENSE', epfEr, 0],
    ['ETF_EXPENSE', etf, 0],
    ['GRATUITY_EXPENSE', grat, 0],
    ['EPF_PAYABLE', 0, epfEe + epfEr],
    ['ETF_PAYABLE', 0, etf],
    ['APIT_PAYABLE', 0, apit],
    ['CONTRACT_TAX_PAYABLE', 0, ct],
    ['OTHER_DEDUCTIONS', 0, other],
    ['GRATUITY_PROVISION', 0, grat],
    ['SALARIES_PAYABLE', 0, net],
  ];
  const lines = raw
    .filter(([, d, c]) => d !== 0 || c !== 0)
    .map(([k, d, c]) => ({ account: accounts[k].code, name: accounts[k].name, debit: fromCents(d), credit: fromCents(c) }));
  const td = raw.reduce((s, x) => s + x[1], 0);
  const tc = raw.reduce((s, x) => s + x[2], 0);
  if (td !== tc) {
    throw new Error(`Payroll journal does not balance: debit ${fmt(td)} vs credit ${fmt(tc)}`);
  }
  return { lines, totalDebit: fromCents(td), totalCredit: fromCents(tc) };
}
