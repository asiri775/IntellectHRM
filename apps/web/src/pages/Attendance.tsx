import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Download, Pencil, Plus } from 'lucide-react';
import { download, get, patch, post, qs, type R } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { addDays, date, hours, time, todayYmd } from '@/lib/format';
import { PunchCard } from '@/components/PunchCard';
import { Button, Empty, ErrorNote, Field, Input, Modal, PageHeader, Panel, Select, Spinner, StatusBadge, Tabs, Textarea, Checkbox } from '@/components/ui';

type Tab = 'me' | 'team' | 'trends';

export default function AttendancePage() {
  const { t } = useTranslation();
  const { me, can } = useAuth();
  const [tab, setTab] = useState<Tab>(me?.employeeId ? 'me' : 'team');
  const tabs: { value: Tab; label: string }[] = [];
  if (me?.employeeId) tabs.push({ value: 'me', label: t('attendance.myHistory') });
  if (can('ATTENDANCE_VIEW')) tabs.push({ value: 'team', label: 'Daily board' }, { value: 'trends', label: 'Trends' });
  return (
    <div>
      <PageHeader title={t('nav.attendance')} />
      {tabs.length > 1 && <Tabs tabs={tabs} value={tab} onChange={setTab} />}
      {tab === 'me' && <Mine />}
      {tab === 'team' && <Board />}
      {tab === 'trends' && <Trends />}
    </div>
  );
}

function Mine() {
  const [from, setFrom] = useState(addDays(todayYmd(), -30));
  const [to, setTo] = useState(todayYmd());
  const { me } = useAuth();
  const q = useQuery({ queryKey: ['attendance', 'records', 'me', from, to], queryFn: () => get<R[]>(`/attendance/records${qs({ from, to, employeeId: me?.employeeId })}`) });
  return (
    <div className="space-y-6">
      <PunchCard />
      <Panel
        title="History"
        padded={false}
        actions={
          <div className="flex gap-2">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="!w-36 !py-1" aria-label="From" />
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="!w-36 !py-1" aria-label="To" />
          </div>
        }
      >
        <RecordsTable rows={q.data} loading={q.isLoading} />
      </Panel>
    </div>
  );
}

function RecordsTable({ rows, loading, onEdit, showName }: { rows?: R[]; loading?: boolean; onEdit?: (r: R) => void; showName?: boolean }) {
  if (loading) return <Spinner />;
  if (!rows?.length) return <Empty title="No attendance records in this period." />;
  return (
    <div className="overflow-x-auto">
      <table className="table-base">
        <thead>
          <tr>
            {showName && <th>Employee</th>}
            <th>Date</th>
            <th>In</th>
            <th>Out</th>
            <th className="num">Worked</th>
            <th className="num">Break</th>
            <th className="num">Late</th>
            <th className="num">Overtime</th>
            <th>Status</th>
            {onEdit && <th />}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const tz = r.employee?.timezone ?? 'Asia/Colombo';
            return (
              <tr key={r.id}>
                {showName && (
                  <td>
                    {r.employee.firstName} {r.employee.lastName}
                  </td>
                )}
                <td>{date(r.workDate)}</td>
                <td>{time(r.signInAt, tz)}</td>
                <td>{time(r.signOutAt, tz)}</td>
                <td className="num">{hours(r.workedMinutes)}</td>
                <td className="num">{hours(r.breakMinutes)}</td>
                <td className="num">{r.lateMinutes ? `${r.lateMinutes}m` : '—'}</td>
                <td className="num">{r.overtimeMinutes ? hours(r.overtimeMinutes) : '—'}</td>
                <td className="space-x-1">
                  <StatusBadge status={r.status} />
                  {r.isRemote && <StatusBadge status="REMOTE" label="Remote" />}
                  {r.source === 'ADMIN' && <StatusBadge status="DRAFT" label="Manual" />}
                </td>
                {onEdit && (
                  <td>
                    <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => onEdit(r)} aria-label="Correct record" />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Board() {
  const { can } = useAuth();
  const [day, setDay] = useState(todayYmd());
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<R | null>(null);
  const [adding, setAdding] = useState(false);
  const q = useQuery({ queryKey: ['attendance', 'daily', day], queryFn: () => get(`/attendance/daily?date=${day}`) });
  const recs = useQuery({ queryKey: ['attendance', 'records', 'all', day], queryFn: () => get<R[]>(`/attendance/records${qs({ from: day, to: day })}`), enabled: can('ATTENDANCE_EDIT') });
  const rows: R[] = (q.data?.rows ?? []).filter((r: R) => !filter || r.status === filter);
  const recByEmp = new Map((recs.data ?? []).map((r) => [r.employeeId, r]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Date">
          <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        </Field>
        <Field label="Show">
          <Select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Everyone"
            options={['PRESENT', 'LATE', 'REMOTE', 'ON_LEAVE', 'ABSENT'].map((s) => ({ value: s, label: s.charAt(0) + s.slice(1).toLowerCase().replace('_', ' ') }))}
          />
        </Field>
        <div className="flex-1" />
        {can('ATTENDANCE_EDIT') && (
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>
            Manual entry
          </Button>
        )}
        {can('ATTENDANCE_EXPORT') && (
          <Button icon={<Download className="h-4 w-4" />} onClick={() => download(`/attendance/export.csv${qs({ from: addDays(day, -30), to: day })}`, 'attendance.csv')}>
            Export 30 days
          </Button>
        )}
      </div>
      {q.data && (
        <p className="text-sm text-ink-500">
          {q.data.summary.present} of {q.data.summary.total} present · {q.data.summary.late} late · {q.data.summary.onLeave} on leave · {q.data.summary.absent} absent
          {q.data.holiday && ` · ${q.data.holiday}`}
        </p>
      )}
      <Panel padded={false}>
        {q.isLoading ? (
          <Spinner />
        ) : !rows.length ? (
          <Empty title="Nobody matches this filter." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Department</th>
                  <th>In</th>
                  <th>Out</th>
                  <th className="num">Worked</th>
                  <th>Status</th>
                  {can('ATTENDANCE_EDIT') && <th />}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.employee.id}>
                    <td>
                      <div className="font-medium">{r.employee.name}</div>
                      <div className="text-xs text-ink-500">{r.employee.employeeNo}</div>
                    </td>
                    <td>{r.employee.department ?? '—'}</td>
                    <td>{r.signIn ?? '—'}</td>
                    <td>
                      {r.signOut ?? '—'}
                      {r.missingSignOut && <span className="ml-1 text-xs text-rose">missing</span>}
                    </td>
                    <td className="num">{r.workedMinutes ? hours(r.workedMinutes) : '—'}</td>
                    <td>
                      <StatusBadge status={r.status} />
                      {r.leaveType && <span className="ml-1 text-xs text-ink-500">{r.leaveType}</span>}
                    </td>
                    {can('ATTENDANCE_EDIT') && (
                      <td>
                        {recByEmp.get(r.employee.id) && <Button size="sm" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} aria-label="Correct" onClick={() => setEditing({ ...recByEmp.get(r.employee.id)!, name: r.employee.name, signIn: r.signIn, signOut: r.signOut })} />}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {editing && <CorrectionModal record={editing} onClose={() => setEditing(null)} />}
      {adding && <ManualEntryModal date={day} employees={q.data?.rows ?? []} onClose={() => setAdding(false)} />}
    </div>
  );
}

function CorrectionModal({ record, onClose }: { record: R; onClose: () => void }) {
  const qc = useQueryClient();
  const [signIn, setSignIn] = useState(record.signIn ?? '');
  const [signOut, setSignOut] = useState(record.signOut ?? '');
  const [breakMinutes, setBreak] = useState(String(record.breakMinutes ?? 0));
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => patch(`/attendance/${record.id}`, { signIn, signOut: signOut || null, breakMinutes: Number(breakMinutes), reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['attendance'] });
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`Correct attendance — ${record.name}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={m.isPending} onClick={() => m.mutate()}>
            Save correction
          </Button>
        </>
      }
    >
      <p className="text-sm text-ink-500">{date(record.workDate)} · times are the employee's local time. The change and your reason are kept in the audit log.</p>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Sign in">
          <Input type="time" value={signIn} onChange={(e) => setSignIn(e.target.value)} />
        </Field>
        <Field label="Sign out">
          <Input type="time" value={signOut} onChange={(e) => setSignOut(e.target.value)} />
        </Field>
        <Field label="Break (min)">
          <Input type="number" min={0} value={breakMinutes} onChange={(e) => setBreak(e.target.value)} />
        </Field>
      </div>
      <Field label="Reason for the change">
        <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} required />
      </Field>
      <ErrorNote error={m.error} />
    </Modal>
  );
}

function ManualEntryModal({ date: day, employees, onClose }: { date: string; employees: R[]; onClose: () => void }) {
  const qc = useQueryClient();
  const missing = employees.filter((r) => !r.signIn);
  const [employeeId, setEmployeeId] = useState(missing[0]?.employee.id ?? '');
  const [signIn, setSignIn] = useState('08:30');
  const [signOut, setSignOut] = useState('17:30');
  const [breakMinutes, setBreak] = useState('60');
  const [isRemote, setRemote] = useState(false);
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => post('/attendance', { employeeId, workDate: day, signIn, signOut: signOut || null, breakMinutes: Number(breakMinutes), isRemote, reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['attendance'] });
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`Manual attendance — ${date(day)}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={m.isPending} disabled={!employeeId} onClick={() => m.mutate()}>
            Add record
          </Button>
        </>
      }
    >
      <Field label="Employee (without a record on this day)">
        <Select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} options={missing.map((r) => ({ value: r.employee.id, label: `${r.employee.name} (${r.employee.employeeNo})` }))} />
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Sign in">
          <Input type="time" value={signIn} onChange={(e) => setSignIn(e.target.value)} />
        </Field>
        <Field label="Sign out">
          <Input type="time" value={signOut} onChange={(e) => setSignOut(e.target.value)} />
        </Field>
        <Field label="Break (min)">
          <Input type="number" min={0} value={breakMinutes} onChange={(e) => setBreak(e.target.value)} />
        </Field>
      </div>
      <Checkbox label="Worked remotely" checked={isRemote} onChange={(e) => setRemote(e.target.checked)} />
      <Field label="Reason">
        <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <ErrorNote error={m.error} />
    </Modal>
  );
}

function Trends() {
  const [to, setTo] = useState(todayYmd());
  const from = addDays(to, -29);
  const q = useQuery({ queryKey: ['attendance', 'summary', to], queryFn: () => get(`/attendance/summary${qs({ from, to })}`) });
  const d = q.data;
  const max = Math.max(1, ...(d?.trend ?? []).map((x: R) => x.present));
  return (
    <div className="space-y-6">
      <div className="flex items-end gap-3">
        <Field label="30 days ending">
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>
      <Panel title="Daily attendance">
        {!d ? (
          <Spinner />
        ) : !d.trend.length ? (
          <Empty title="No attendance recorded in this period." />
        ) : (
          <div className="flex h-40 items-end gap-1" role="img" aria-label="Daily present and late counts">
            {d.trend.map((x: R) => (
              <div key={x.date} className="group relative flex flex-1 flex-col justify-end" title={`${date(x.date)}: ${x.present} present, ${x.late} late`}>
                <div className="rounded-t-sm bg-accent" style={{ height: `${((x.present - x.late) / max) * 140}px` }} />
                <div className="bg-saffron" style={{ height: `${(x.late / max) * 140}px` }} />
              </div>
            ))}
          </div>
        )}
        <p className="mt-2 flex gap-4 text-xs text-ink-500">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm bg-accent" /> On time
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm bg-saffron" /> Late
          </span>
        </p>
      </Panel>
      <Panel title="By department" padded={false}>
        {d?.departments?.length ? (
          <table className="table-base">
            <thead>
              <tr>
                <th>Department</th>
                <th className="num">Records</th>
                <th className="num">Late rate</th>
                <th className="num">Avg hours/day</th>
                <th className="num">Overtime</th>
              </tr>
            </thead>
            <tbody>
              {d.departments.map((x: R) => (
                <tr key={x.department}>
                  <td>{x.department}</td>
                  <td className="num">{x.records}</td>
                  <td className="num">{x.lateRate}%</td>
                  <td className="num">{x.avgHours}</td>
                  <td className="num">{hours(x.overtimeMinutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty title="No data." />
        )}
      </Panel>
    </div>
  );
}
