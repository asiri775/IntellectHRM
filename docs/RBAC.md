# Roles and permissions

Permissions follow **Module → Feature → Action** (`packages/shared/src/permissions.ts`). Roles are rows in the database: administrators can create roles and grant any permission with a **scope**.

| Scope | Employee-based data (HRM, attendance, leave, payroll) | Owner-based data (CRM) |
|---|---|---|
| OWN | The user's own employee record | Records they own |
| TEAM | Self, direct reports and same team | Records they own |
| DEPARTMENT | Same department | Whole company |
| COMPANY / ALL | Whole company | Whole company |

When a user has the same permission through several roles, the widest scope wins.

## Seeded roles

| Role | Highlights |
|---|---|
| Super admin | Everything; only a super admin can grant super admin |
| Top management | Company-wide view of people, attendance, leave, payroll, CRM; approves leave and payroll; audit log |
| Administrator | Users, roles, organization, settings, templates, audit log |
| HR manager | Employees incl. NIC/bank, contracts, documents, attendance corrections, leave configuration and approvals, holidays |
| Payroll officer | Prepares payroll, salaries and adjustments, statutory exports |
| Finance manager | Approves/posts/reverses payroll, statutory rules, quotations |
| Sales manager | All customers, leads, opportunities, pipeline settings |
| Sales executive | Own customers, leads and opportunities |
| Team lead | Team attendance, team leave approvals |
| Employee | Self-service: sign in/out, leave, own payslips, own profile |

## Built-in safeguards (independent of roles)

* No self-approval of leave; payroll approver ≠ preparer (unless super admin).
* Employees cannot correct their own attendance.
* NIC, passport, TIN and bank account are encrypted at rest (AES-256-GCM) and masked unless the user has `EMPLOYEE_SENSITIVE_VIEW`; every unmasked view of someone else's record is audited, as is every view of another person's salary or payslip.
* Leavers (status resigned/terminated/contract ended, or archived) lose sign-in immediately and their sessions are revoked.
