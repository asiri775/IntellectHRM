/**
 * Seed: reference data required to run the system (permissions, roles, statutory
 * rules, leave types, templates, pipeline). Safe to re-run: existing rows are kept.
 *
 *   SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD   first super-admin account (required on first run)
 *   SEED_COMPANY_NAME                       default "Intellect Choice"
 *   SEED_DEMO=true + SEED_DEMO_PASSWORD     optional demo employees/CRM data (never use in production)
 */
import { PrismaClient, Prisma, type EmploymentType, type PermissionScope } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { DEFAULT_SRI_LANKA_RULES, PERMISSIONS, STATUTORY_RULE_META, type PermissionCode } from '@ihrm/shared';
import { DEFAULT_DOCUMENT_TEMPLATES, DEFAULT_EMAIL_TEMPLATES } from '../src/templates/defaults';
import { seedDemo } from './seed-data/demo';

const prisma = new PrismaClient();

const SELF: PermissionCode[] = ['ATTENDANCE_SELF', 'LEAVE_REQUEST', 'PAYSLIP_VIEW_OWN', 'ORG_VIEW'];
type Grant = [PermissionCode, PermissionScope];
const all = (codes: PermissionCode[], scope: PermissionScope): Grant[] => codes.map((c) => [c, scope]);

export const ROLES: { code: string; name: string; description: string; grants: Grant[] }[] = [
  { code: 'SUPER_ADMIN', name: 'Super admin', description: 'Full access to everything', grants: all(PERMISSIONS.map((p) => p.code), 'ALL') },
  {
    code: 'TOP_MANAGEMENT',
    name: 'Top management',
    description: 'Company-wide dashboards, HR analytics, CRM and approvals',
    grants: [
      ...all(['EMPLOYEE_VIEW', 'ATTENDANCE_VIEW', 'LEAVE_VIEW', 'LEAVE_APPROVE', 'PAYROLL_VIEW', 'PAYROLL_APPROVE', 'CUSTOMER_VIEW', 'LEAD_VIEW', 'OPPORTUNITY_VIEW', 'DASHBOARD_MANAGEMENT', 'AUDIT_VIEW'], 'COMPANY'),
      ...all(SELF, 'OWN'),
    ],
  },
  {
    code: 'ADMIN',
    name: 'Administrator',
    description: 'Users, roles, organization, settings, templates',
    grants: [...all(['USER_VIEW', 'USER_MANAGE', 'ROLE_VIEW', 'ROLE_MANAGE', 'ORG_MANAGE', 'SETTINGS_MANAGE', 'TEMPLATE_MANAGE', 'AUDIT_VIEW', 'SCHEDULE_MANAGE'], 'COMPANY'), ...all(SELF, 'OWN')],
  },
  {
    code: 'HR_MANAGER',
    name: 'HR manager',
    description: 'Employees, contracts, attendance, leave, holidays',
    grants: [
      ...all(
        ['EMPLOYEE_VIEW', 'EMPLOYEE_CREATE', 'EMPLOYEE_EDIT', 'EMPLOYEE_DELETE', 'EMPLOYEE_SENSITIVE_VIEW', 'EMPLOYEE_EXPORT', 'EMPLOYEE_IMPORT', 'CONTRACT_MANAGE', 'DOCUMENT_VIEW', 'DOCUMENT_MANAGE', 'ATTENDANCE_VIEW', 'ATTENDANCE_EDIT', 'ATTENDANCE_EXPORT', 'SCHEDULE_MANAGE', 'LEAVE_VIEW', 'LEAVE_APPROVE', 'LEAVE_CONFIG', 'HOLIDAY_MANAGE', 'ORG_MANAGE', 'USER_VIEW'],
        'COMPANY',
      ),
      ...all(SELF, 'OWN'),
    ],
  },
  {
    code: 'PAYROLL_OFFICER',
    name: 'Payroll officer',
    description: 'Prepares payroll, salaries and statutory reports',
    grants: [...all(['PAYROLL_VIEW', 'PAYROLL_RUN', 'PAYROLL_EXPORT', 'SALARY_MANAGE', 'EMPLOYEE_VIEW', 'EMPLOYEE_SENSITIVE_VIEW', 'LEAVE_VIEW', 'ATTENDANCE_VIEW'], 'COMPANY'), ...all(SELF, 'OWN')],
  },
  {
    code: 'FINANCE_MANAGER',
    name: 'Finance manager',
    description: 'Approves and posts payroll, statutory rules, tax codes',
    grants: [...all(['PAYROLL_VIEW', 'PAYROLL_APPROVE', 'PAYROLL_EXPORT', 'STATUTORY_MANAGE', 'EMPLOYEE_VIEW', 'CUSTOMER_VIEW', 'OPPORTUNITY_VIEW', 'INVOICE_PRINT', 'DASHBOARD_MANAGEMENT'], 'COMPANY'), ...all(SELF, 'OWN')],
  },
  {
    code: 'SALES_MANAGER',
    name: 'Sales manager',
    description: 'All customers, leads, opportunities and pipeline settings',
    grants: [...all(['CUSTOMER_VIEW', 'CUSTOMER_MANAGE', 'LEAD_VIEW', 'LEAD_MANAGE', 'OPPORTUNITY_VIEW', 'OPPORTUNITY_MANAGE', 'PIPELINE_CONFIG', 'INVOICE_PRINT'], 'COMPANY'), ...all(SELF, 'OWN')],
  },
  {
    code: 'SALES_USER',
    name: 'Sales executive',
    description: 'Own customers, leads and opportunities',
    grants: [...all(['CUSTOMER_VIEW', 'CUSTOMER_MANAGE', 'LEAD_VIEW', 'LEAD_MANAGE', 'OPPORTUNITY_VIEW', 'OPPORTUNITY_MANAGE', 'INVOICE_PRINT'], 'OWN'), ...all(SELF, 'OWN')],
  },
  {
    code: 'TEAM_LEAD',
    name: 'Team lead / manager',
    description: 'Team attendance and leave approvals',
    grants: [...all(['EMPLOYEE_VIEW', 'ATTENDANCE_VIEW', 'LEAVE_VIEW', 'LEAVE_APPROVE'], 'TEAM'), ...all(SELF, 'OWN')],
  },
  { code: 'EMPLOYEE', name: 'Employee', description: 'Self-service: attendance, leave, payslips', grants: [...all(['EMPLOYEE_VIEW'], 'OWN'), ...all(SELF, 'OWN')] },
];

const LEAVE_TYPES: { code: string; name: string; isPaid: boolean; allowHalfDay: boolean; allowShortLeave: boolean; color: string; days: Partial<Record<EmploymentType, number>>; carry?: number }[] = [
  { code: 'ANNUAL', name: 'Annual leave', isPaid: true, allowHalfDay: true, allowShortLeave: false, color: '#1F4FD8', days: { PERMANENT: 14, PROBATION: 0, CONTRACT: 14 }, carry: 7 },
  { code: 'CASUAL', name: 'Casual leave', isPaid: true, allowHalfDay: true, allowShortLeave: false, color: '#0EA5A4', days: { PERMANENT: 7, PROBATION: 7, CONTRACT: 7, INTERN: 3 } },
  { code: 'MEDICAL', name: 'Medical leave', isPaid: true, allowHalfDay: true, allowShortLeave: false, color: '#E11D48', days: { PERMANENT: 7, PROBATION: 7, CONTRACT: 7, INTERN: 3 } },
  { code: 'SHORT', name: 'Short leave', isPaid: true, allowHalfDay: false, allowShortLeave: true, color: '#F59E0B', days: { PERMANENT: 24, PROBATION: 24, CONTRACT: 24, INTERN: 12 } },
  { code: 'MATERNITY', name: 'Maternity leave', isPaid: true, allowHalfDay: false, allowShortLeave: false, color: '#DB2777', days: { PERMANENT: 84, PROBATION: 84, CONTRACT: 84 } },
  { code: 'PATERNITY', name: 'Paternity leave', isPaid: true, allowHalfDay: false, allowShortLeave: false, color: '#7C3AED', days: { PERMANENT: 3, PROBATION: 3, CONTRACT: 3 } },
  { code: 'LIEU', name: 'Lieu leave', isPaid: true, allowHalfDay: true, allowShortLeave: false, color: '#059669', days: { PERMANENT: 0, PROBATION: 0, CONTRACT: 0 } },
  { code: 'NOPAY', name: 'No-pay leave', isPaid: false, allowHalfDay: true, allowShortLeave: false, color: '#6B7280', days: {} },
];

async function main() {
  // Permissions catalogue
  for (const p of PERMISSIONS) {
    await prisma.permission.upsert({ where: { code: p.code }, create: { ...p }, update: { module: p.module, feature: p.feature, action: p.action, description: p.description } });
  }
  const perms = new Map((await prisma.permission.findMany()).map((p) => [p.code, p.id]));

  // Company
  let company = await prisma.company.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!company) {
    company = await prisma.company.create({
      data: {
        name: process.env.SEED_COMPANY_NAME ?? 'Intellect Choice',
        website: 'https://intellectchoice.co.nz',
        country: 'LK',
        baseCurrency: 'LKR',
        timezone: 'Asia/Colombo',
        settings: { attendance: { captureLocation: false, allowRemote: true }, contractReminderDays: [60, 30, 7] },
      },
    });
    console.log(`Created company ${company.name}`);
  }
  const companyId = company.id;

  // Roles (permissions of system roles are refreshed; custom roles untouched)
  for (const r of ROLES) {
    const role = await prisma.role.upsert({
      where: { companyId_code: { companyId, code: r.code } },
      create: { companyId, code: r.code, name: r.name, description: r.description, isSystem: true },
      update: {},
    });
    const existing = await prisma.rolePermission.count({ where: { roleId: role.id } });
    if (existing === 0 || r.code === 'SUPER_ADMIN') {
      await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
      await prisma.rolePermission.createMany({ data: r.grants.map(([code, scope]) => ({ roleId: role.id, permissionId: perms.get(code)!, scope })), skipDuplicates: true });
    }
  }

  // First admin
  const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? 'admin@intellectchoice.co.nz').toLowerCase();
  if (!(await prisma.user.findUnique({ where: { email: adminEmail } }))) {
    let password = process.env.SEED_ADMIN_PASSWORD;
    const generated = !password;
    if (!password) password = randomBytes(12).toString('base64url') + '9a';
    const superAdmin = await prisma.role.findUniqueOrThrow({ where: { companyId_code: { companyId, code: 'SUPER_ADMIN' } } });
    await prisma.user.create({
      data: {
        companyId,
        email: adminEmail,
        displayName: 'System administrator',
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
        mustChangePassword: generated,
        roles: { create: [{ roleId: superAdmin.id }] },
      },
    });
    console.log(`Created super admin ${adminEmail}${generated ? ` with temporary password: ${password}  (change it on first sign-in)` : ''}`);
  }

  // Statutory rules — effective 1 April 2025 (confirm with your accountant)
  for (const [code, cfg] of Object.entries(DEFAULT_SRI_LANKA_RULES)) {
    const meta = STATUTORY_RULE_META[code as keyof typeof STATUTORY_RULE_META];
    const rule = await prisma.statutoryRule.upsert({ where: { companyId_code: { companyId, code } }, create: { companyId, code, name: meta.name, description: meta.description }, update: {} });
    if ((await prisma.statutoryRuleVersion.count({ where: { ruleId: rule.id } })) === 0) {
      await prisma.statutoryRuleVersion.create({ data: { ruleId: rule.id, effectiveFrom: new Date('2025-04-01T00:00:00Z'), config: cfg as unknown as Prisma.InputJsonValue, note: 'Seed default — confirm with accountant' } });
    }
  }

  // Earning components
  const components = [
    { code: 'BASIC', name: 'Basic salary', isFixed: true, epfApplicable: true, taxable: true, sortOrder: 1 },
    { code: 'FIXED_ALLOWANCE', name: 'Fixed allowance', isFixed: true, epfApplicable: true, taxable: true, sortOrder: 2 },
    { code: 'TRAVEL', name: 'Travel allowance', isFixed: true, epfApplicable: false, taxable: true, sortOrder: 3 },
    { code: 'COMMUNICATION', name: 'Communication allowance', isFixed: true, epfApplicable: false, taxable: true, sortOrder: 4 },
    { code: 'OVERTIME', name: 'Overtime', isFixed: false, epfApplicable: false, taxable: true, sortOrder: 10 },
    { code: 'BONUS', name: 'Bonus', isFixed: false, epfApplicable: false, taxable: true, sortOrder: 11 },
  ];
  for (const c of components) await prisma.earningComponent.upsert({ where: { companyId_code: { companyId, code: c.code } }, create: { ...c, companyId }, update: {} });

  // Leave types & entitlements (Shop and Office Employees Act defaults — confirm against company policy)
  for (const t of LEAVE_TYPES) {
    const exists = await prisma.leaveType.findUnique({ where: { companyId_code: { companyId, code: t.code } } });
    if (exists) continue;
    await prisma.leaveType.create({
      data: {
        companyId,
        code: t.code,
        name: t.name,
        isPaid: t.isPaid,
        allowHalfDay: t.allowHalfDay,
        allowShortLeave: t.allowShortLeave,
        color: t.color,
        rules: { create: Object.entries(t.days).map(([employmentType, daysPerYear]) => ({ employmentType: employmentType as EmploymentType, daysPerYear, carryForwardMax: t.carry ?? 0, prorate: t.code !== 'SHORT' })) },
      },
    });
  }

  // Leave approval workflow: manager, then HR
  if (!(await prisma.approvalWorkflow.findUnique({ where: { companyId_entityType: { companyId, entityType: 'LEAVE' } } }))) {
    await prisma.approvalWorkflow.create({
      data: {
        companyId,
        entityType: 'LEAVE',
        name: 'Leave approval',
        steps: { create: [{ order: 1, name: 'Line manager', approverType: 'MANAGER' }, { order: 2, name: 'HR', approverType: 'ROLE', roleCode: 'HR_MANAGER' }] },
      },
    });
  }

  // Work schedule & organization
  if (!(await prisma.workSchedule.findFirst({ where: { companyId } }))) {
    await prisma.workSchedule.create({ data: { companyId, name: 'Standard (08:30–17:30, Mon–Fri)', startTime: '08:30', endTime: '17:30', breakMinutes: 60, graceMinutes: 15, workDays: [1, 2, 3, 4, 5], isDefault: true } });
  }
  for (const [code, name] of [['DEV', 'Software Development'], ['QA', 'Quality Assurance'], ['SALES', 'Sales'], ['MKT', 'Marketing'], ['FIN', 'Finance'], ['HR', 'Human Resources']]) {
    await prisma.department.upsert({ where: { companyId_code: { companyId, code } }, create: { companyId, code, name }, update: {} });
  }
  for (const name of ['Software Engineer', 'Senior Software Engineer', 'Tech Lead', 'QA Engineer', 'Project Manager', 'Business Analyst', 'Sales Executive', 'HR Executive', 'Accountant']) {
    await prisma.designation.upsert({ where: { companyId_name: { companyId, name } }, create: { companyId, name }, update: {} });
  }
  await prisma.location.upsert({ where: { companyId_name: { companyId, name: 'Colombo office' } }, create: { companyId, name: 'Colombo office', timezone: 'Asia/Colombo' }, update: {} });

  // CRM
  const stages = [
    { name: 'Qualified', order: 1, probability: 20 },
    { name: 'Needs analysis', order: 2, probability: 35 },
    { name: 'Proposal', order: 3, probability: 50 },
    { name: 'Negotiation', order: 4, probability: 75 },
    { name: 'Won', order: 90, probability: 100, isWon: true },
    { name: 'Lost', order: 99, probability: 0, isLost: true },
  ];
  for (const s of stages) await prisma.pipelineStage.upsert({ where: { companyId_name: { companyId, name: s.name } }, create: { ...s, companyId }, update: {} });
  for (const name of ['Website', 'Email', 'Social media', 'Referral', 'Campaign', 'Manual entry', 'Import/API']) {
    await prisma.leadSource.upsert({ where: { companyId_name: { companyId, name } }, create: { companyId, name }, update: {} });
  }

  // Tax codes (confirm rates and dates with your accountant)
  for (const t of [
    { code: 'VAT', name: 'VAT', rate: 0.18, effectiveFrom: '2024-01-01' },
    { code: 'VAT0', name: 'VAT zero-rated (export)', rate: 0, effectiveFrom: '2024-01-01' },
    { code: 'SSCL', name: 'Social Security Contribution Levy', rate: 0.025, effectiveFrom: '2024-01-01' },
  ]) {
    const effectiveFrom = new Date(`${t.effectiveFrom}T00:00:00Z`);
    await prisma.taxCode.upsert({ where: { companyId_code_effectiveFrom: { companyId, code: t.code, effectiveFrom } }, create: { ...t, effectiveFrom, companyId }, update: {} });
  }

  // Email & document templates (never overwrite edited templates)
  for (const t of DEFAULT_EMAIL_TEMPLATES) {
    await prisma.emailTemplate.upsert({ where: { companyId_key_language: { companyId, key: t.key, language: t.language } }, create: { ...t, companyId }, update: {} });
  }
  for (const t of DEFAULT_DOCUMENT_TEMPLATES) {
    if (!(await prisma.documentTemplate.findFirst({ where: { companyId, type: t.type } }))) {
      await prisma.documentTemplate.create({ data: { companyId, type: t.type, name: t.name, html: t.html, css: t.css, options: t.options, isDefault: true } });
    }
  }

  // Audit log is append-only at the database level.
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION audit_logs_append_only() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'audit_logs is append-only'; END; $$ LANGUAGE plpgsql;`);
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS audit_logs_no_update ON audit_logs;`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();`);

  if (process.env.SEED_DEMO === 'true') await seedDemo(prisma, companyId);
  console.log('Seed complete');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
