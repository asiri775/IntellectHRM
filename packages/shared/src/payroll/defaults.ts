import type { PayrollRuleSet } from './types';

/**
 * Seed values for Sri Lankan statutory rules.
 * These are DEFAULTS ONLY and are stored as versioned configuration in the
 * database. The client's accountant must confirm every value before go-live
 * (see docs/OPEN_QUESTIONS.md).
 */
export const DEFAULT_SRI_LANKA_RULES: PayrollRuleSet = {
  EPF_EMPLOYEE: { rate: 0.08, employmentTypes: ['PERMANENT', 'PROBATION', 'CONTRACT'] },
  EPF_EMPLOYER: { rate: 0.12, employmentTypes: ['PERMANENT', 'PROBATION', 'CONTRACT'] },
  ETF: { rate: 0.03, employmentTypes: ['PERMANENT', 'PROBATION', 'CONTRACT'] },
  APIT: {
    employmentTypes: ['PERMANENT', 'PROBATION', 'CONTRACT'],
    // Monthly equivalent of the annual slabs effective 1 April 2025
    // (relief LKR 1.8m p.a., then 1m @6%, 500k @18%, 500k @24%, 500k @30%, balance 36%).
    slabs: [
      { width: 150000, rate: 0 },
      { width: 83333.33, rate: 0.06 },
      { width: 41666.67, rate: 0.18 },
      { width: 41666.67, rate: 0.24 },
      { width: 41666.67, rate: 0.3 },
      { width: null, rate: 0.36 },
    ],
  },
  CONTRACT_EMPLOYEE_TAX: {
    employmentTypes: ['CONTRACT'],
    rate: 0.05,
    thresholdAmount: 150000,
    thresholdCurrency: 'LKR',
    thresholdPeriod: 'MONTHLY',
    comparison: 'GREATER_THAN',
    basis: 'FULL_AMOUNT',
    includedComponents: [],
    replacesApit: false,
    liabilityAccount: '2230',
  },
  GRATUITY: {
    employmentTypes: ['PERMANENT', 'PROBATION', 'CONTRACT'],
    monthsPerYearOfService: 0.5,
    eligibilityYears: 5,
  },
  NO_PAY: { divisor: 'WORKING_DAYS', fixedDivisor: 30 },
};

export const STATUTORY_RULE_META: Record<keyof PayrollRuleSet, { name: string; description: string }> = {
  EPF_EMPLOYEE: { name: 'EPF – employee contribution', description: 'Deducted from employee earnings liable for EPF.' },
  EPF_EMPLOYER: { name: 'EPF – employer contribution', description: 'Paid by the employer on earnings liable for EPF.' },
  ETF: { name: 'ETF – employer contribution', description: 'Employees’ Trust Fund contribution paid by the employer.' },
  APIT: { name: 'APIT / PAYE', description: 'Advance Personal Income Tax, monthly progressive slabs.' },
  CONTRACT_EMPLOYEE_TAX: {
    name: 'Contract employee tax',
    description: 'Deduct 5% from contract employees whose monthly gross salary is above LKR 150,000.',
  },
  GRATUITY: { name: 'Gratuity provision', description: 'Monthly accrual of gratuity liability.' },
  NO_PAY: { name: 'No-pay leave', description: 'How a no-pay day is valued against basic salary.' },
};
