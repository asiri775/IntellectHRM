export const EMPLOYMENT_TYPES = ['PERMANENT', 'PROBATION', 'CONTRACT', 'INTERN', 'CONSULTANT'] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const EMPLOYMENT_STATUSES = ['ACTIVE', 'ON_NOTICE', 'SUSPENDED', 'RESIGNED', 'TERMINATED', 'CONTRACT_ENDED'] as const;
export type EmploymentStatus = (typeof EMPLOYMENT_STATUSES)[number];

export const LANGUAGES = ['en', 'si', 'ta'] as const;
export type Language = (typeof LANGUAGES)[number];

export const ATTENDANCE_SOURCES = ['WEB', 'MOBILE', 'ADMIN'] as const;
export type AttendanceSource = (typeof ATTENDANCE_SOURCES)[number];

export const LEAVE_DAY_PORTIONS = ['FULL', 'FIRST_HALF', 'SECOND_HALF', 'SHORT'] as const;
export type LeaveDayPortion = (typeof LEAVE_DAY_PORTIONS)[number];

export const LEAD_STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'DISQUALIFIED', 'CONVERTED'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const PAYROLL_RUN_STATUSES = ['DRAFT', 'CALCULATED', 'APPROVED', 'POSTED', 'REVERSED'] as const;
export type PayrollRunStatus = (typeof PAYROLL_RUN_STATUSES)[number];

export const PERMISSION_SCOPES = ['OWN', 'TEAM', 'DEPARTMENT', 'COMPANY', 'ALL'] as const;
export type PermissionScope = (typeof PERMISSION_SCOPES)[number];

/** Wider scopes win when a user has the same permission through several roles. */
export const SCOPE_RANK: Record<PermissionScope, number> = {
  OWN: 1,
  TEAM: 2,
  DEPARTMENT: 3,
  COMPANY: 4,
  ALL: 5,
};

export const EMAIL_TEMPLATE_KEYS = [
  'LAYOUT',
  'WELCOME_USER',
  'LEAVE_REQUESTED',
  'LEAVE_APPROVED',
  'LEAVE_REJECTED',
  'PAYSLIP_PUBLISHED',
  'CONTRACT_ENDING',
  'MISSING_CHECKOUT',
  'LEAD_ASSIGNED',
  'FOLLOW_UP_REMINDER',
  'PROFORMA_INVOICE',
] as const;
export type EmailTemplateKey = (typeof EMAIL_TEMPLATE_KEYS)[number];

export const DOCUMENT_TEMPLATE_TYPES = ['INVOICE', 'PROFORMA_INVOICE', 'QUOTATION', 'PAYSLIP'] as const;
export type DocumentTemplateType = (typeof DOCUMENT_TEMPLATE_TYPES)[number];
