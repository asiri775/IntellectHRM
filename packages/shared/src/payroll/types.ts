import type { EmploymentType } from '../enums';

/** A simple percentage contribution such as EPF or ETF. */
export interface PercentageRuleConfig {
  rate: number; // 0.08 = 8%
  employmentTypes: EmploymentType[];
}

export interface TaxSlab {
  /** Width of this slab in LKR per month. null = unlimited (final slab). */
  width: number | null;
  rate: number;
}

export interface ApitRuleConfig {
  employmentTypes: EmploymentType[];
  /** Monthly progressive slabs applied to taxable income in LKR, in order. */
  slabs: TaxSlab[];
}

export type ContractTaxBasis = 'FULL_AMOUNT' | 'EXCESS_OVER_THRESHOLD';
export type ThresholdComparison = 'GREATER_THAN' | 'GREATER_THAN_OR_EQUAL';

/** Section 13.2: contract employee tax deduction (default 5% when gross > LKR 150,000). */
export interface ContractTaxRuleConfig {
  employmentTypes: EmploymentType[];
  rate: number;
  thresholdAmount: number;
  thresholdCurrency: 'LKR';
  thresholdPeriod: 'MONTHLY';
  comparison: ThresholdComparison;
  basis: ContractTaxBasis;
  /** Earning component codes included in the salary base. Empty = all gross earnings. */
  includedComponents: string[];
  /** If true, APIT is not deducted for employees this rule applies to. */
  replacesApit: boolean;
  liabilityAccount: string;
}

export interface GratuityRuleConfig {
  employmentTypes: EmploymentType[];
  /** Months of basic salary accrued per year of service (Sri Lanka: half a month = 0.5). */
  monthsPerYearOfService: number;
  /** Minimum years of service before gratuity is payable (accrual still starts on day one). */
  eligibilityYears: number;
}

export interface NoPayRuleConfig {
  /** WORKING_DAYS = basic / working days in period; FIXED = basic / fixedDivisor. */
  divisor: 'WORKING_DAYS' | 'FIXED';
  fixedDivisor: number;
}

export interface PayrollRuleSet {
  EPF_EMPLOYEE: PercentageRuleConfig;
  EPF_EMPLOYER: PercentageRuleConfig;
  ETF: PercentageRuleConfig;
  APIT: ApitRuleConfig;
  CONTRACT_EMPLOYEE_TAX: ContractTaxRuleConfig;
  GRATUITY: GratuityRuleConfig;
  NO_PAY: NoPayRuleConfig;
}

export type StatutoryRuleCode = keyof PayrollRuleSet;

export interface EarningInput {
  code: string;
  name: string;
  /** Monthly amount in the employee's pay currency. */
  amount: number;
  epfApplicable: boolean;
  taxable: boolean;
  /** Fixed earnings are prorated for partial months; variable ones (overtime, bonus) are not. */
  fixed: boolean;
}

export interface DeductionInput {
  code: string;
  name: string;
  amount: number;
}

export interface PayslipInput {
  employmentType: EmploymentType;
  currency: string;
  /** Rate to convert 1 unit of pay currency to LKR. 1 for LKR. */
  exchangeRateToLkr: number;
  earnings: EarningInput[];
  deductions: DeductionInput[];
  /** Working days in the period per the employee's schedule and holiday calendar. */
  workingDays: number;
  /** Working days the employee was employed in the period (proration for joiners/leavers). */
  employedDays: number;
  /** Approved no-pay leave days in the period. */
  noPayDays: number;
  /** Code of the earning that no-pay is calculated from (usually BASIC). */
  basicCode?: string;
  /** Completed years of service at the period end (for gratuity eligibility reporting). */
  yearsOfService?: number;
}

export interface PayslipLine {
  code: string;
  name: string;
  amount: number;
  /** Human-readable explanation of how the amount was calculated. */
  note?: string;
}

export interface PayslipResult {
  currency: string;
  exchangeRateToLkr: number;
  earnings: PayslipLine[];
  deductions: PayslipLine[];
  employerContributions: PayslipLine[];
  /** Sum of earnings after proration, before no-pay. */
  totalEarnings: number;
  /** Total earnings less no-pay: the salary cost and the base for statutory calculations. */
  grossEarnings: number;
  epfBase: number;
  taxableIncome: number;
  epfEmployee: number;
  epfEmployer: number;
  etf: number;
  apit: number;
  contractTax: number;
  noPay: number;
  otherDeductions: number;
  /** All deductions shown on the payslip, including no-pay. */
  totalDeductions: number;
  netPay: number;
  gratuityAccrual: number;
  totalEmployerCost: number;
  /** Step-by-step trace for audit and explainability. */
  trace: string[];
}
