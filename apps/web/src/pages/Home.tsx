import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { get, type R } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { compactMoney, date, fullName, monthName, money } from '@/lib/format';
import { PunchCard } from '@/components/PunchCard';
import { Badge, Empty, Panel, Stat, StatStrip, StatusBadge } from '@/components/ui';

export function HomePage() {
  const { t } = useTranslation();
  const { me, can, scope } = useAuth();
  const hour = new Date().getHours();
  const part = hour < 12 ? t('home.morning') : hour < 17 ? t('home.afternoon') : t('home.evening');
  const isSelfService = !!me?.employeeId;
  const seesTeam = can('ATTENDANCE_VIEW');
  const seesHr = !!scope('EMPLOYEE_VIEW') && scope('EMPLOYEE_VIEW') !== 'OWN';

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">{t('home.greeting', { part, name: me?.displayName.split(' ')[0] })}</h1>

      {isSelfService && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <PunchCard />
          <MyLeave />
        </div>
      )}

      <Approvals />
      {seesHr && <HrSummary />}
      {seesTeam && <TeamToday />}
      {can('OPPORTUNITY_VIEW') && <SalesSummary />}
    </div>
  );
}

function MyLeave() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['leave', 'balances', 'me'], queryFn: () => get<R[]>('/leave/balances/me') });
  // Special-purpose leave (maternity, paternity) is listed on the Leave page; here only once it's in use.
  const special = ['MATERNITY', 'PATERNITY'];
  const balances = (q.data ?? []).filter((b) => b.entitled + b.carriedForward + b.adjustment > 0 && (!special.includes(b.leaveType.code) || b.used + b.pending > 0));
  return (
    <Panel
      title={t('leave.balances')}
      actions={
        <Link to="/leave" className="text-sm font-medium text-brand">
          {t('leave.apply')}
        </Link>
      }
    >
      {balances.length === 0 ? (
        <p className="text-sm text-ink-500">{t('common.nothingHere')}</p>
      ) : (
        <ul className="space-y-3">
          {balances.map((b) => {
            const total = b.entitled + b.carriedForward + b.adjustment;
            return (
              <li key={b.id}>
                <div className="flex items-baseline justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: b.leaveType.color }} />
                    {b.leaveType.name}
                  </span>
                  <span className="tabular-nums">
                    <strong>{b.available}</strong> <span className="text-ink-500">/ {total}</span>
                  </span>
                </div>
                <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-ink-50 dark:bg-ink-700">
                  <div style={{ width: `${(b.used / total) * 100}%`, background: b.leaveType.color }} />
                  <div style={{ width: `${(b.pending / total) * 100}%`, background: b.leaveType.color, opacity: 0.4 }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function Approvals() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['leave', 'approvals'], queryFn: () => get<R[]>('/leave/approvals') });
  if (!q.data?.length) return null;
  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          {t('home.waitingForYou')} <Badge tone="amber">{q.data.length}</Badge>
        </span>
      }
      actions={
        <Link to="/leave/approvals" className="text-sm font-medium text-brand">
          {t('common.view')}
        </Link>
      }
      padded={false}
    >
      <ul className="divide-y divide-ink-50 dark:divide-ink-700">
        {q.data.slice(0, 5).map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
            <span>
              <strong>{fullName(r.employee)}</strong> · {r.leaveType.name}
            </span>
            <span className="text-ink-500">
              {date(r.startDate)}
              {r.endDate !== r.startDate && ` – ${date(r.endDate)}`} · {Number(r.days)} {t('common.days').toLowerCase()}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function HrSummary() {
  const q = useQuery({ queryKey: ['dashboard', 'hr'], queryFn: () => get('/dashboard/hr') });
  const d = q.data;
  if (!d) return null;
  return (
    <div className="space-y-3">
      <StatStrip>
        <Stat label="Headcount" value={d.headcount} />
        <Stat label="Joined this month" value={d.joinersThisMonth} tone="good" />
        <Stat label="On leave today" value={d.onLeaveToday} />
        <Stat label="Leave requests pending" value={d.pendingLeaveRequests} tone={d.pendingLeaveRequests ? 'warn' : 'default'} />
      </StatStrip>
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Contracts ending in 30 days" padded={false}>
          {d.contractsEnding.length === 0 ? (
            <Empty title="No contracts end in the next 30 days." />
          ) : (
            <ul className="divide-y divide-ink-50 dark:divide-ink-700">
              {d.contractsEnding.map((c: R) => (
                <li key={c.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <Link to={`/employees/${c.employee.id}`} className="font-medium hover:text-brand">
                    {fullName(c.employee)} <span className="text-ink-500">{c.employee.employeeNo}</span>
                  </Link>
                  <span className="text-saffron">{date(c.endDate)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Headcount by employment type">
          <ul className="space-y-2 text-sm">
            {d.byEmploymentType.map((x: R) => (
              <li key={x.employmentType} className="flex items-center gap-3">
                <span className="w-24 text-ink-500">{x.employmentType.charAt(0) + x.employmentType.slice(1).toLowerCase()}</span>
                <span className="h-2 rounded-full bg-brand" style={{ width: `${(x.count / Math.max(1, d.headcount)) * 100}%`, minWidth: 6 }} />
                <span className="tabular-nums">{x.count}</span>
              </li>
            ))}
          </ul>
          {d.lastPayroll && (
            <p className="mt-4 border-t border-ink-50 pt-3 text-sm dark:border-ink-700">
              Last payroll:{' '}
              <Link to={`/payroll/runs/${d.lastPayroll.id}`} className="font-medium text-brand">
                {monthName(d.lastPayroll.month)} {d.lastPayroll.year}
              </Link>{' '}
              <StatusBadge status={d.lastPayroll.status} /> · net {money(d.lastPayroll.totalNet, 'LKR')}
            </p>
          )}
        </Panel>
      </div>
    </div>
  );
}

function TeamToday() {
  const { t } = useTranslation();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' });
  const q = useQuery({ queryKey: ['attendance', 'daily', today], queryFn: () => get(`/attendance/daily?date=${today}`) });
  const d = q.data;
  if (!d) return null;
  return (
    <Panel
      title={t('attendance.team')}
      actions={
        <Link to="/attendance" className="text-sm font-medium text-brand">
          {t('common.view')}
        </Link>
      }
      padded={false}
    >
      <div className="grid grid-cols-3 divide-x divide-ink-50 border-b border-ink-50 sm:grid-cols-5 dark:divide-ink-700 dark:border-ink-700">
        <Stat label="Present" value={`${d.summary.present}/${d.summary.total}`} tone="good" />
        <Stat label="Late" value={d.summary.late} tone={d.summary.late ? 'warn' : 'default'} />
        <Stat label="Remote" value={d.summary.remote} />
        <Stat label="On leave" value={d.summary.onLeave} />
        <Stat label="Absent" value={d.summary.absent} tone={d.summary.absent ? 'bad' : 'default'} />
      </div>
      {d.holiday && <p className="px-4 py-3 text-sm">Today is {d.holiday}.</p>}
    </Panel>
  );
}

function SalesSummary() {
  const q = useQuery({ queryKey: ['crm', 'summary'], queryFn: () => get('/crm/pipeline/summary') });
  const d = q.data;
  if (!d) return null;
  return (
    <Panel
      title="Sales pipeline"
      actions={
        <Link to="/crm/pipeline" className="text-sm font-medium text-brand">
          Open pipeline
        </Link>
      }
      padded={false}
    >
      <div className="grid grid-cols-2 divide-ink-50 sm:grid-cols-4 sm:divide-x dark:divide-ink-700">
        <Stat label="Open pipeline" value={compactMoney(d.pipelineValue)} />
        <Stat label="Weighted" value={compactMoney(d.weightedPipeline)} />
        <Stat label="Won" value={`${d.won} · ${compactMoney(d.wonValue)}`} tone="good" />
        <Stat label="Win rate" value={`${d.winRate}%`} />
      </div>
    </Panel>
  );
}
