import { describe, expect, it } from 'vitest';
import { DEFAULT_SRI_LANKA_RULES } from './defaults';
import { buildPayrollJournal, calculateApitLkr, calculatePayslip } from './engine';
import type { EarningInput, PayrollRuleSet, PayslipInput } from './types';
import type { EmploymentType } from '../enums';

const rules = DEFAULT_SRI_LANKA_RULES;

function basicOnly(amount: number): EarningInput[] {
  return [{ code: 'BASIC', name: 'Basic salary', amount, epfApplicable: true, taxable: true, fixed: true }];
}

function input(type: EmploymentType, gross: number, extra: Partial<PayslipInput> = {}): PayslipInput {
  return {
    employmentType: type,
    currency: 'LKR',
    exchangeRateToLkr: 1,
    earnings: basicOnly(gross),
    deductions: [],
    workingDays: 22,
    employedDays: 22,
    noPayDays: 0,
    ...extra,
  };
}

function withBasis(basis: 'FULL_AMOUNT' | 'EXCESS_OVER_THRESHOLD'): PayrollRuleSet {
  return { ...rules, CONTRACT_EMPLOYEE_TAX: { ...rules.CONTRACT_EMPLOYEE_TAX, basis } };
}

describe('Section 13.2 contract employee tax — required test table', () => {
  const cases: [string, EmploymentType, number, 'FULL_AMOUNT' | 'EXCESS_OVER_THRESHOLD', number, Partial<PayslipInput>?][] = [
    ['Contract 120,000 full', 'CONTRACT', 120000, 'FULL_AMOUNT', 0],
    ['Contract exactly 150,000 (not above threshold)', 'CONTRACT', 150000, 'FULL_AMOUNT', 0],
    ['Contract 150,001 full', 'CONTRACT', 150001, 'FULL_AMOUNT', 7500.05],
    ['Contract 200,000 full', 'CONTRACT', 200000, 'FULL_AMOUNT', 10000],
    ['Contract 200,000 excess over threshold', 'CONTRACT', 200000, 'EXCESS_OVER_THRESHOLD', 2500],
    ['Permanent 200,000 (rule not applicable)', 'PERMANENT', 200000, 'FULL_AMOUNT', 0],
    // Mid-month joiner: monthly 320,000, employed 11 of 22 working days => 160,000 earned
    ['Contract prorated, 160,000 earned', 'CONTRACT', 320000, 'FULL_AMOUNT', 8000, { employedDays: 11 }],
  ];

  it.each(cases)('%s', (_label, type, gross, basis, expected, extra) => {
    const r = calculatePayslip(input(type, gross, extra), withBasis(basis));
    expect(r.contractTax).toBe(expected);
  });

  it('prorated case really earns 160,000', () => {
    const r = calculatePayslip(input('CONTRACT', 320000, { employedDays: 11 }), rules);
    expect(r.grossEarnings).toBe(160000);
  });

  it('shows contract tax as a separate payslip line', () => {
    const r = calculatePayslip(input('CONTRACT', 200000), rules);
    const line = r.deductions.find((d) => d.code === 'CONTRACT_EMPLOYEE_TAX');
    expect(line?.amount).toBe(10000);
    expect(line?.name).toContain('5%');
  });

  it('GREATER_THAN_OR_EQUAL comparison deducts at exactly the threshold', () => {
    const r = calculatePayslip(input('CONTRACT', 150000), {
      ...rules,
      CONTRACT_EMPLOYEE_TAX: { ...rules.CONTRACT_EMPLOYEE_TAX, comparison: 'GREATER_THAN_OR_EQUAL' },
    });
    expect(r.contractTax).toBe(7500);
  });

  it('converts foreign-currency pay to LKR before comparing with the threshold', () => {
    // USD 600 at 300 LKR/USD = LKR 180,000 > 150,000 => 5% = LKR 9,000 = USD 30
    const r = calculatePayslip(input('CONTRACT', 600, { currency: 'USD', exchangeRateToLkr: 300 }), rules);
    expect(r.contractTax).toBe(30);
    // USD 400 = LKR 120,000 => no deduction
    const r2 = calculatePayslip(input('CONTRACT', 400, { currency: 'USD', exchangeRateToLkr: 300 }), rules);
    expect(r2.contractTax).toBe(0);
  });

  it('replacesApit suppresses APIT only when contract tax applies', () => {
    const replacing: PayrollRuleSet = {
      ...rules,
      CONTRACT_EMPLOYEE_TAX: { ...rules.CONTRACT_EMPLOYEE_TAX, replacesApit: true },
    };
    expect(calculatePayslip(input('CONTRACT', 200000), replacing).apit).toBe(0);
    expect(calculatePayslip(input('CONTRACT', 200000), rules).apit).toBeGreaterThan(0);
  });

  it('limits the base to included components when configured', () => {
    const r = calculatePayslip(
      input('CONTRACT', 140000, {
        earnings: [
          ...basicOnly(140000),
          { code: 'TRAVEL', name: 'Travel allowance', amount: 20000, epfApplicable: false, taxable: true, fixed: true },
        ],
      }),
      { ...rules, CONTRACT_EMPLOYEE_TAX: { ...rules.CONTRACT_EMPLOYEE_TAX, includedComponents: ['BASIC'] } },
    );
    expect(r.contractTax).toBe(0); // only BASIC 140,000 counts
  });
});

describe('EPF / ETF / APIT / no-pay', () => {
  it('calculates EPF 8%/12% and ETF 3% on EPF-liable earnings', () => {
    const r = calculatePayslip(input('PERMANENT', 100000), rules);
    expect(r.epfEmployee).toBe(8000);
    expect(r.epfEmployer).toBe(12000);
    expect(r.etf).toBe(3000);
  });

  it('does not apply EPF to consultants', () => {
    const r = calculatePayslip(input('CONSULTANT', 100000), rules);
    expect(r.epfEmployee).toBe(0);
    expect(r.etf).toBe(0);
  });

  it('APIT is zero at or below LKR 150,000 per month', () => {
    expect(calculateApitLkr(15000000, rules.APIT)).toBe(0);
  });

  it('APIT on LKR 200,000 is 6% of 50,000 = 3,000', () => {
    expect(calculateApitLkr(20000000, rules.APIT) / 100).toBe(3000);
  });

  it('APIT on LKR 300,000 uses multiple slabs', () => {
    // 83,333.33 @6% = 5,000.00 ; 41,666.67 @18% = 7,500.00 ; 25,000.00 @24% = 6,000.00
    expect(calculateApitLkr(30000000, rules.APIT) / 100).toBe(18500);
  });

  it('deducts no-pay from basic and reduces EPF base', () => {
    const r = calculatePayslip(input('PERMANENT', 110000, { noPayDays: 2 }), rules);
    expect(r.noPay).toBe(10000); // 110,000 / 22 × 2
    expect(r.grossEarnings).toBe(100000);
    expect(r.epfEmployee).toBe(8000);
    expect(r.netPay).toBe(r.totalEarnings - r.totalDeductions);
  });

  it('includes other deductions in net pay', () => {
    const r = calculatePayslip(
      input('PERMANENT', 100000, { deductions: [{ code: 'LOAN', name: 'Staff loan', amount: 5000 }] }),
      rules,
    );
    expect(r.netPay).toBe(100000 - 8000 - 5000);
  });
});

describe('payroll journal (Section 31)', () => {
  it('matches the master prompt example when APIT is excluded', () => {
    const noApit: PayrollRuleSet = { ...rules, APIT: { ...rules.APIT, employmentTypes: [] }, GRATUITY: { ...rules.GRATUITY, employmentTypes: [] } };
    const slip = calculatePayslip(input('CONTRACT', 200000), noApit);
    expect(slip.netPay).toBe(174000);
    const j = buildPayrollJournal([slip]);
    expect(j.totalDebit).toBe(230000);
    expect(j.totalCredit).toBe(230000);
    const byAcct = Object.fromEntries(j.lines.map((l) => [l.account, l]));
    expect(byAcct['2300'].credit).toBe(40000);
    expect(byAcct['2310'].credit).toBe(6000);
    expect(byAcct['2230'].credit).toBe(10000);
    expect(byAcct['2320'].credit).toBe(174000);
  });

  it('always balances across a mixed payroll', () => {
    const slips = [
      calculatePayslip(input('CONTRACT', 187654.33, { noPayDays: 1 }), rules),
      calculatePayslip(input('PERMANENT', 412345.67), rules),
      calculatePayslip(input('CONSULTANT', 90000, { deductions: [{ code: 'ADV', name: 'Advance', amount: 1234.56 }] }), rules),
      calculatePayslip(input('CONTRACT', 600, { currency: 'USD', exchangeRateToLkr: 299.5 }), rules),
    ];
    const j = buildPayrollJournal(slips);
    expect(j.totalDebit).toBe(j.totalCredit);
  });
});
