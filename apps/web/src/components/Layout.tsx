import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import {
  Bell,
  Briefcase,
  CalendarDays,
  Clock,
  FileText,
  Home,
  KanbanSquare,
  LogOut,
  Menu,
  Moon,
  Settings,
  Sun,
  Target,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { get, post, type R } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { LANGUAGES } from '@/lib/i18n';
import { dateTime } from '@/lib/format';

function hexToRgb(hex: string) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? `${parseInt(m[1], 16)} ${parseInt(m[2], 16)} ${parseInt(m[3], 16)}` : null;
}

/** Applies the company's logo and colours from Settings → Branding. */
export function useBranding() {
  const q = useQuery({ queryKey: ['branding'], queryFn: () => get('/public/branding'), staleTime: 300_000 });
  useEffect(() => {
    if (!q.data) return;
    const brand = hexToRgb(q.data.primaryColor);
    const accent = hexToRgb(q.data.accentColor);
    if (brand) document.documentElement.style.setProperty('--brand', brand);
    if (accent) document.documentElement.style.setProperty('--accent', accent);
    document.title = `${q.data.name} HR`;
  }, [q.data]);
  return q.data as { name: string; logoUrl: string | null; primaryColor: string; accentColor: string } | undefined;
}

export function Logo({ branding, className }: { branding?: { name: string; logoUrl: string | null }; className?: string }) {
  if (branding?.logoUrl) return <img src={branding.logoUrl} alt={branding.name} className={clsx('max-h-9 max-w-[180px] object-contain', className)} />;
  return <span className={clsx('text-base font-bold tracking-tight', className)}>{branding?.name ?? 'IntellectHRM'}</span>;
}

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  show: boolean;
}

export function Layout() {
  const { t, i18n } = useTranslation();
  const { me, can, logout } = useAuth();
  const branding = useBranding();
  const [open, setOpen] = useState(false);
  const [dark, setDark] = useState(() => localStorage.getItem('ihrm.dark') === '1');
  const location = useLocation();

  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('ihrm.dark', dark ? '1' : '0');
  }, [dark]);

  const groups: { label: string; items: NavItem[] }[] = [
    {
      label: t('nav.me'),
      items: [
        { to: '/', label: t('nav.home'), icon: <Home className="h-4 w-4" />, show: true },
        { to: '/attendance', label: t('nav.attendance'), icon: <Clock className="h-4 w-4" />, show: can('ATTENDANCE_SELF', 'ATTENDANCE_VIEW') },
        { to: '/leave', label: t('nav.leave'), icon: <CalendarDays className="h-4 w-4" />, show: can('LEAVE_REQUEST', 'LEAVE_VIEW', 'LEAVE_APPROVE') },
        { to: '/payroll/my-payslips', label: t('nav.myPayslips'), icon: <FileText className="h-4 w-4" />, show: can('PAYSLIP_VIEW_OWN') && !!me?.employeeId },
      ],
    },
    {
      label: t('nav.people'),
      items: [
        { to: '/employees', label: t('nav.employees'), icon: <Users className="h-4 w-4" />, show: me?.permissions.EMPLOYEE_VIEW !== undefined && me?.permissions.EMPLOYEE_VIEW !== 'OWN' },
        { to: '/payroll', label: t('nav.payroll'), icon: <Wallet className="h-4 w-4" />, show: can('PAYROLL_VIEW', 'STATUTORY_MANAGE') },
      ],
    },
    {
      label: t('nav.sales'),
      items: [
        { to: '/crm/leads', label: t('nav.leads'), icon: <Target className="h-4 w-4" />, show: can('LEAD_VIEW') },
        { to: '/crm/pipeline', label: t('nav.pipeline'), icon: <KanbanSquare className="h-4 w-4" />, show: can('OPPORTUNITY_VIEW') },
        { to: '/crm/customers', label: t('nav.customers'), icon: <Briefcase className="h-4 w-4" />, show: can('CUSTOMER_VIEW') },
      ],
    },
    {
      label: '',
      items: [
        {
          to: '/settings',
          label: t('nav.settings'),
          icon: <Settings className="h-4 w-4" />,
          show: can('SETTINGS_MANAGE', 'TEMPLATE_MANAGE', 'USER_VIEW', 'ROLE_VIEW', 'AUDIT_VIEW', 'ORG_MANAGE', 'LEAVE_CONFIG'),
        },
      ],
    },
  ];

  const nav = (
    <nav className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-4">
      {groups.map((g, i) => {
        const items = g.items.filter((x) => x.show);
        if (!items.length) return null;
        return (
          <div key={i}>
            {g.label && <div className="mb-1 px-2 text-xs text-ink-300">{g.label}</div>}
            {items.map((it) => (
              <NavLink
                key={it.to}
                to={it.to}
                end={it.to === '/' || it.to === '/payroll'}
                className={({ isActive }) =>
                  clsx('flex items-center gap-2.5 rounded-ctl px-2 py-1.5 text-sm', isActive ? 'bg-white/10 font-medium text-white' : 'text-ink-100 hover:bg-white/5 hover:text-white')
                }
              >
                {it.icon}
                {it.label}
              </NavLink>
            ))}
          </div>
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className={clsx('fixed inset-y-0 left-0 z-40 flex w-60 flex-col bg-ink text-white transition-transform lg:translate-x-0', open ? 'translate-x-0' : '-translate-x-full')}>
        <div className="flex h-14 items-center justify-between gap-2 border-b border-white/10 px-4">
          <div className="rounded bg-white px-2 py-1">
            <Logo branding={branding} className="!max-h-7 text-ink" />
          </div>
          <button className="lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu">
            <X className="h-5 w-5" />
          </button>
        </div>
        {nav}
        <div className="border-t border-white/10 p-3 text-xs text-ink-100">
          <div className="truncate font-medium text-white">{me?.displayName}</div>
          <div className="truncate">{me?.email}</div>
        </div>
      </aside>
      {open && <div className="fixed inset-0 z-30 bg-ink-900/40 lg:hidden" onClick={() => setOpen(false)} />}

      <div className="flex min-w-0 flex-1 flex-col lg:pl-60">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-ink-100 bg-white/90 px-4 backdrop-blur dark:border-ink-700 dark:bg-ink-900/90">
          <button className="lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex-1" />
          <select
            aria-label={t('common.language')}
            value={i18n.language}
            onChange={(e) => i18n.changeLanguage(e.target.value)}
            className="rounded-ctl border border-ink-100 bg-transparent px-2 py-1 text-sm dark:border-ink-700"
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
          <button onClick={() => setDark((d) => !d)} aria-label={t('common.darkMode')} className="rounded-ctl p-2 text-ink-500 hover:bg-ink-50 dark:text-ink-100 dark:hover:bg-ink-700">
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <Notifications />
          <button onClick={() => logout()} aria-label={t('common.signOut')} title={t('common.signOut')} className="rounded-ctl p-2 text-ink-500 hover:bg-ink-50 dark:text-ink-100 dark:hover:bg-ink-700">
            <LogOut className="h-4 w-4" />
          </button>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function Notifications() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['notifications'], queryFn: () => get<{ items: R[]; unread: number }>('/notifications'), refetchInterval: 60_000 });
  const unread = q.data?.unread ?? 0;
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-label={t('common.notifications')} className="relative rounded-ctl p-2 text-ink-500 hover:bg-ink-50 dark:text-ink-100 dark:hover:bg-ink-700">
        <Bell className="h-4 w-4" />
        {unread > 0 && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-saffron" />}
      </button>
      {open && (
        <div className="panel absolute right-0 top-11 z-30 w-80 max-w-[90vw] shadow-lg">
          <div className="flex items-center justify-between border-b border-ink-50 px-3 py-2 dark:border-ink-700">
            <span className="text-sm font-semibold">{t('common.notifications')}</span>
            {unread > 0 && (
              <button
                className="text-xs text-brand"
                onClick={async () => {
                  await post('/notifications/read-all');
                  qc.invalidateQueries({ queryKey: ['notifications'] });
                }}
              >
                {t('common.markAllRead')}
              </button>
            )}
          </div>
          <ul className="max-h-96 overflow-auto">
            {(q.data?.items ?? []).length === 0 && <li className="p-4 text-sm text-ink-500">{t('common.noNotifications')}</li>}
            {q.data?.items.map((n) => (
              <li key={n.id} className={clsx('border-b border-ink-50 px-3 py-2 text-sm last:border-0 dark:border-ink-700', !n.readAt && 'bg-brand/5')}>
                <NavLink to={n.link ?? '#'} onClick={() => setOpen(false)} className="block">
                  <div className="font-medium">{n.title}</div>
                  {n.body && <div className="text-ink-500">{n.body}</div>}
                  <div className="mt-0.5 text-xs text-ink-300">{dateTime(n.createdAt)}</div>
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
