import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import clsx from 'clsx';
import { useAuth } from '@/lib/auth';
import { PageHeader } from '@/components/ui';
import { BrandingSettings } from './Branding';
import { EmailTemplates } from './EmailTemplates';
import { DocumentTemplates } from './DocumentTemplates';
import { UsersSettings, RolesSettings } from './Access';
import { OrganizationSettings, NumberingSettings, TaxCurrencySettings, OutboxSettings, AuditSettings, LeaveTypeSettings } from './Misc';

export default function SettingsPage() {
  const { can } = useAuth();
  const sections = [
    { path: 'branding', label: 'Company & branding', show: can('SETTINGS_MANAGE'), el: <BrandingSettings /> },
    { path: 'email-templates', label: 'Email templates', show: can('TEMPLATE_MANAGE'), el: <EmailTemplates /> },
    { path: 'document-templates', label: 'Invoice & payslip formats', show: can('TEMPLATE_MANAGE'), el: <DocumentTemplates /> },
    { path: 'users', label: 'Users', show: can('USER_VIEW', 'USER_MANAGE'), el: <UsersSettings /> },
    { path: 'roles', label: 'Roles & permissions', show: can('ROLE_VIEW'), el: <RolesSettings /> },
    { path: 'organization', label: 'Organization', show: can('ORG_MANAGE', 'SCHEDULE_MANAGE'), el: <OrganizationSettings /> },
    { path: 'leave-types', label: 'Leave types', show: can('LEAVE_CONFIG'), el: <LeaveTypeSettings /> },
    { path: 'numbering', label: 'Document numbering', show: can('SETTINGS_MANAGE'), el: <NumberingSettings /> },
    { path: 'tax', label: 'Tax & currency', show: can('SETTINGS_MANAGE'), el: <TaxCurrencySettings /> },
    { path: 'outbox', label: 'Email outbox', show: can('TEMPLATE_MANAGE'), el: <OutboxSettings /> },
    { path: 'audit', label: 'Audit log', show: can('AUDIT_VIEW'), el: <AuditSettings /> },
  ].filter((s) => s.show);
  return (
    <div>
      <PageHeader title="Settings" />
      <div className="grid gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <nav className="flex gap-1 overflow-x-auto lg:flex-col" aria-label="Settings sections">
          {sections.map((s) => (
            <NavLink
              key={s.path}
              to={`/settings/${s.path}`}
              className={({ isActive }) => clsx('whitespace-nowrap rounded-ctl px-3 py-1.5 text-sm', isActive ? 'bg-brand/10 font-medium text-brand' : 'text-ink-500 hover:bg-ink-50 dark:text-ink-300 dark:hover:bg-ink-700')}
            >
              {s.label}
            </NavLink>
          ))}
        </nav>
        <div className="min-w-0">
          <Routes>
            {sections.map((s) => (
              <Route key={s.path} path={s.path} element={s.el} />
            ))}
            <Route path="*" element={sections[0] ? <Navigate to={`/settings/${sections[0].path}`} replace /> : <p>No settings available.</p>} />
          </Routes>
        </div>
      </div>
    </div>
  );
}
