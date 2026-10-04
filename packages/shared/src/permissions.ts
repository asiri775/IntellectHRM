/**
 * Permission catalogue: Module -> Feature -> Action.
 * Roles are configurable in the database; these codes are the building blocks.
 */
export interface PermissionDef {
  code: string;
  module: string;
  feature: string;
  action: 'CREATE' | 'READ' | 'UPDATE' | 'DELETE' | 'APPROVE' | 'EXPORT' | 'PRINT' | 'IMPORT' | 'MANAGE';
  description: string;
}

const p = (
  code: string,
  module: string,
  feature: string,
  action: PermissionDef['action'],
  description: string,
): PermissionDef => ({ code, module, feature, action, description });

export const PERMISSIONS = [
  // Administration
  p('USER_VIEW', 'ADMIN', 'USER', 'READ', 'View users'),
  p('USER_MANAGE', 'ADMIN', 'USER', 'MANAGE', 'Create, edit and deactivate users'),
  p('ROLE_VIEW', 'ADMIN', 'ROLE', 'READ', 'View roles and permissions'),
  p('ROLE_MANAGE', 'ADMIN', 'ROLE', 'MANAGE', 'Create and edit roles and assign permissions'),
  p('ORG_VIEW', 'ADMIN', 'ORGANIZATION', 'READ', 'View departments, teams, designations, locations'),
  p('ORG_MANAGE', 'ADMIN', 'ORGANIZATION', 'MANAGE', 'Manage organization structure'),
  p('SETTINGS_MANAGE', 'ADMIN', 'SETTINGS', 'MANAGE', 'Manage company settings and branding'),
  p('TEMPLATE_MANAGE', 'ADMIN', 'TEMPLATE', 'MANAGE', 'Edit email and document (invoice/payslip) templates'),
  p('AUDIT_VIEW', 'ADMIN', 'AUDIT', 'READ', 'View audit logs'),

  // HRM
  p('EMPLOYEE_VIEW', 'HRM', 'EMPLOYEE', 'READ', 'View employees'),
  p('EMPLOYEE_CREATE', 'HRM', 'EMPLOYEE', 'CREATE', 'Create employees'),
  p('EMPLOYEE_EDIT', 'HRM', 'EMPLOYEE', 'UPDATE', 'Edit employees'),
  p('EMPLOYEE_DELETE', 'HRM', 'EMPLOYEE', 'DELETE', 'Archive employees'),
  p('EMPLOYEE_SENSITIVE_VIEW', 'HRM', 'EMPLOYEE_SENSITIVE', 'READ', 'View NIC, bank and tax details'),
  p('EMPLOYEE_EXPORT', 'HRM', 'EMPLOYEE', 'EXPORT', 'Export employee data'),
  p('EMPLOYEE_IMPORT', 'HRM', 'EMPLOYEE', 'IMPORT', 'Import employees'),
  p('CONTRACT_MANAGE', 'HRM', 'CONTRACT', 'MANAGE', 'Create and renew employment contracts'),
  p('DOCUMENT_VIEW', 'HRM', 'DOCUMENT', 'READ', 'View employee documents'),
  p('DOCUMENT_MANAGE', 'HRM', 'DOCUMENT', 'MANAGE', 'Upload and delete employee documents'),

  // Attendance
  p('ATTENDANCE_SELF', 'ATTENDANCE', 'SIGN_IN', 'CREATE', 'Sign in/out and record own breaks'),
  p('ATTENDANCE_VIEW', 'ATTENDANCE', 'RECORD', 'READ', 'View attendance records'),
  p('ATTENDANCE_EDIT', 'ATTENDANCE', 'RECORD', 'UPDATE', 'Correct attendance records (reason required)'),
  p('ATTENDANCE_EXPORT', 'ATTENDANCE', 'RECORD', 'EXPORT', 'Export attendance'),
  p('SCHEDULE_MANAGE', 'ATTENDANCE', 'SCHEDULE', 'MANAGE', 'Manage work schedules'),

  // Leave
  p('LEAVE_REQUEST', 'LEAVE', 'REQUEST', 'CREATE', 'Apply for leave'),
  p('LEAVE_VIEW', 'LEAVE', 'REQUEST', 'READ', 'View leave requests and balances'),
  p('LEAVE_APPROVE', 'LEAVE', 'REQUEST', 'APPROVE', 'Approve or reject leave'),
  p('LEAVE_CONFIG', 'LEAVE', 'CONFIG', 'MANAGE', 'Manage leave types, entitlements and balances'),
  p('HOLIDAY_MANAGE', 'LEAVE', 'HOLIDAY', 'MANAGE', 'Manage holiday calendar'),

  // Payroll
  p('PAYROLL_VIEW', 'PAYROLL', 'RUN', 'READ', 'View payroll runs and salaries'),
  p('PAYROLL_RUN', 'PAYROLL', 'RUN', 'CREATE', 'Create and calculate payroll runs'),
  p('PAYROLL_APPROVE', 'PAYROLL', 'RUN', 'APPROVE', 'Approve, post and reverse payroll runs'),
  p('PAYROLL_EXPORT', 'PAYROLL', 'RUN', 'EXPORT', 'Export statutory and bank files'),
  p('SALARY_MANAGE', 'PAYROLL', 'SALARY', 'MANAGE', 'Edit employee salary and payroll adjustments'),
  p('STATUTORY_MANAGE', 'PAYROLL', 'STATUTORY', 'MANAGE', 'Edit statutory rule versions (EPF, ETF, APIT, contract tax)'),
  p('PAYSLIP_VIEW_OWN', 'PAYROLL', 'PAYSLIP', 'READ', 'View own payslips'),

  // CRM
  p('CUSTOMER_VIEW', 'CRM', 'CUSTOMER', 'READ', 'View customers'),
  p('CUSTOMER_MANAGE', 'CRM', 'CUSTOMER', 'MANAGE', 'Create and edit customers and contacts'),
  p('LEAD_VIEW', 'CRM', 'LEAD', 'READ', 'View leads'),
  p('LEAD_MANAGE', 'CRM', 'LEAD', 'MANAGE', 'Create, edit, assign and convert leads'),
  p('OPPORTUNITY_VIEW', 'CRM', 'OPPORTUNITY', 'READ', 'View opportunities and pipeline'),
  p('OPPORTUNITY_MANAGE', 'CRM', 'OPPORTUNITY', 'MANAGE', 'Create, edit and move opportunities'),
  p('PIPELINE_CONFIG', 'CRM', 'PIPELINE', 'MANAGE', 'Configure pipeline stages and lead sources'),
  p('INVOICE_PRINT', 'CRM', 'PROFORMA', 'PRINT', 'Generate and email quotations/proforma invoices'),

  // Dashboard
  p('DASHBOARD_MANAGEMENT', 'DASHBOARD', 'MANAGEMENT', 'READ', 'View company-wide dashboard KPIs'),
] as const satisfies readonly PermissionDef[];

export type PermissionCode = (typeof PERMISSIONS)[number]['code'];

export const PERMISSION_CODES = PERMISSIONS.map((x) => x.code) as PermissionCode[];
