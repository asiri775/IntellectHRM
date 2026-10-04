import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Check, Plus, Trash2, Upload, X } from 'lucide-react';
import { del, get, post, type R } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { date, fullName } from '@/lib/format';
import { Button, Empty, ErrorNote, Field, Input, Modal, PageHeader, Panel, Select, Spinner, StatusBadge, Tabs, Textarea } from '@/components/ui';

type Tab = 'mine' | 'approvals' | 'team' | 'holidays';

export default function LeavePage() {
  const { t } = useTranslation();
  const { me, can } = useAuth();
  const params = useParams();
  const nav = useNavigate();
  const tab = ((params['*'] || (me?.employeeId ? 'mine' : 'approvals')) as Tab) ?? 'mine';
  const inbox = useQuery({ queryKey: ['leave', 'approvals'], queryFn: () => get<R[]>('/leave/approvals') });
  const tabs: { value: Tab; label: string; count?: number }[] = [];
  if (me?.employeeId) tabs.push({ value: 'mine', label: t('leave.myLeave') });
  tabs.push({ value: 'approvals', label: t('leave.approvals'), count: inbox.data?.length });
  if (can('LEAVE_VIEW')) tabs.push({ value: 'team', label: 'All requests' });
  tabs.push({ value: 'holidays', label: t('leave.holidays') });
  return (
    <div>
      <PageHeader title={t('nav.leave')} />
      <Tabs tabs={tabs} value={tab} onChange={(v) => nav(`/leave/${v}`)} />
      {tab === 'mine' && <Mine />}
      {tab === 'approvals' && <Approvals rows={inbox.data} loading={inbox.isLoading} />}
      {tab === 'team' && <AllRequests />}
      {tab === 'holidays' && <Holidays />}
    </div>
  );
}

function Mine() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [applying, setApplying] = useState(false);
  const balances = useQuery({ queryKey: ['leave', 'balances', 'me'], queryFn: () => get<R[]>('/leave/balances/me') });
  const requests = useQuery({ queryKey: ['leave', 'requests', 'mine'], queryFn: () => get<R[]>('/leave/requests?mine=true') });
  const cancel = useMutation({
    mutationFn: (id: string) => post(`/leave/requests/${id}/cancel`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leave'] }),
  });
  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setApplying(true)}>
          {t('leave.apply')}
        </Button>
      </div>
      <Panel title={t('leave.balances')} padded={false}>
        {balances.isLoading ? (
          <Spinner />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>{t('leave.leaveType')}</th>
                  <th className="num">{t('leave.entitled')}</th>
                  <th className="num">{t('leave.carried')}</th>
                  <th className="num">{t('leave.used')}</th>
                  <th className="num">{t('leave.pending')}</th>
                  <th className="num">{t('leave.available')}</th>
                </tr>
              </thead>
              <tbody>
                {(balances.data ?? []).map((b) => (
                  <tr key={b.id}>
                    <td>
                      <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ background: b.leaveType.color }} />
                      {b.leaveType.name}
                    </td>
                    <td className="num">{b.entitled + b.adjustment}</td>
                    <td className="num">{b.carriedForward || '—'}</td>
                    <td className="num">{b.used}</td>
                    <td className="num">{b.pending || '—'}</td>
                    <td className="num font-semibold">{b.leaveType.isPaid ? b.available : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Panel title={t('leave.requests')} padded={false}>
        <RequestsTable
          rows={requests.data}
          loading={requests.isLoading}
          action={(r) =>
            ['PENDING', 'APPROVED'].includes(r.status) && r.startDate.slice(0, 10) > new Date().toISOString().slice(0, 10) ? (
              <Button size="sm" variant="ghost" loading={cancel.isPending} onClick={() => confirm(t('leave.cancelRequest') + '?') && cancel.mutate(r.id)}>
                {t('leave.cancelRequest')}
              </Button>
            ) : null
          }
        />
        <div className="px-4 pb-3">
          <ErrorNote error={cancel.error} />
        </div>
      </Panel>
      {applying && <ApplyModal balances={balances.data ?? []} onClose={() => setApplying(false)} />}
    </div>
  );
}

function RequestsTable({ rows, loading, showEmployee, action }: { rows?: R[]; loading?: boolean; showEmployee?: boolean; action?: (r: R) => ReactNode }) {
  const { t } = useTranslation();
  if (loading) return <Spinner />;
  if (!rows?.length) return <Empty title={t('common.nothingHere')} />;
  return (
    <div className="overflow-x-auto">
      <table className="table-base">
        <thead>
          <tr>
            {showEmployee && <th>Employee</th>}
            <th>{t('common.type')}</th>
            <th>{t('common.from')}</th>
            <th>{t('common.to')}</th>
            <th className="num">{t('common.days')}</th>
            <th>{t('common.reason')}</th>
            <th>{t('common.status')}</th>
            {action && <th />}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              {showEmployee && <td className="font-medium">{fullName(r.employee)}</td>}
              <td>
                <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ background: r.leaveType.color }} />
                {r.leaveType.name}
                {r.portion !== 'FULL' && <span className="ml-1 text-xs text-ink-500">({r.portion.replace('_', ' ').toLowerCase()})</span>}
              </td>
              <td>{date(r.startDate)}</td>
              <td>{date(r.endDate)}</td>
              <td className="num">{Number(r.days)}</td>
              <td className="max-w-xs truncate text-ink-500">{r.reason ?? '—'}</td>
              <td>
                <StatusBadge status={r.status} label={t(`leave.status_${r.status}`)} />
                {r.stepName && <div className="mt-0.5 text-xs text-ink-500">{r.stepName}</div>}
              </td>
              {action && <td className="text-right">{action(r)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ApplyModal({ balances, onClose }: { balances: R[]; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const types = useQuery({ queryKey: ['leave', 'types'], queryFn: () => get<R[]>('/leave/types') });
  const active = (types.data ?? []).filter((x) => x.isActive);
  const [leaveTypeId, setType] = useState('');
  const [startDate, setStart] = useState('');
  const [endDate, setEnd] = useState('');
  const [portion, setPortion] = useState('FULL');
  const [reason, setReason] = useState('');
  const type = active.find((x) => x.id === leaveTypeId) ?? active[0];
  const bal = balances.find((b) => b.leaveType.id === type?.id);
  const portions = useMemo(() => {
    const o = [{ value: 'FULL', label: t('leave.full') }];
    if (type?.allowHalfDay) o.push({ value: 'FIRST_HALF', label: t('leave.firstHalf') }, { value: 'SECOND_HALF', label: t('leave.secondHalf') });
    if (type?.allowShortLeave) o.push({ value: 'SHORT', label: t('leave.short') });
    return o;
  }, [type, t]);
  const m = useMutation({
    mutationFn: () => post('/leave/requests', { leaveTypeId: type.id, startDate, endDate: portion === 'FULL' ? endDate || startDate : startDate, portion, reason: reason || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leave'] });
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={t('leave.apply')}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" loading={m.isPending} disabled={!type || !startDate} onClick={() => m.mutate()}>
            {t('leave.submit')}
          </Button>
        </>
      }
    >
      <Field label={t('leave.leaveType')} hint={bal && type?.isPaid ? `${bal.available} ${t('leave.available')}` : undefined}>
        <Select value={type?.id ?? ''} onChange={(e) => (setType(e.target.value), setPortion('FULL'))} options={active.map((x) => ({ value: x.id, label: x.name }))} />
      </Field>
      <Field label={t('leave.portion')}>
        <Select value={portion} onChange={(e) => setPortion(e.target.value)} options={portions} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={portion === 'FULL' ? t('common.from') : t('common.date')}>
          <Input type="date" value={startDate} onChange={(e) => setStart(e.target.value)} required />
        </Field>
        {portion === 'FULL' && (
          <Field label={t('common.to')}>
            <Input type="date" value={endDate} min={startDate} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        )}
      </div>
      <Field label={t('common.reason')}>
        <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <p className="text-xs text-ink-500">Weekends and company holidays are not counted.</p>
      <ErrorNote error={m.error} />
    </Modal>
  );
}

function Approvals({ rows, loading }: { rows?: R[]; loading: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [rejecting, setRejecting] = useState<R | null>(null);
  const [comment, setComment] = useState('');
  const decide = useMutation({
    mutationFn: ({ id, action, comment }: { id: string; action: 'approve' | 'reject'; comment?: string }) => post(`/leave/requests/${id}/${action}`, { comment }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leave'] });
      setRejecting(null);
      setComment('');
    },
  });
  return (
    <Panel padded={false}>
      {!loading && !rows?.length ? (
        <Empty title={t('home.nothingToApprove')} />
      ) : (
        <RequestsTable
          rows={rows}
          loading={loading}
          showEmployee
          action={(r) => (
            <div className="flex justify-end gap-1">
              <Button size="sm" variant="primary" icon={<Check className="h-3.5 w-3.5" />} loading={decide.isPending && decide.variables?.id === r.id} onClick={() => decide.mutate({ id: r.id, action: 'approve' })}>
                Approve
              </Button>
              <Button size="sm" icon={<X className="h-3.5 w-3.5" />} onClick={() => setRejecting(r)}>
                Reject
              </Button>
            </div>
          )}
        />
      )}
      <div className="px-4 pb-3">
        <ErrorNote error={decide.error} />
      </div>
      {rejecting && (
        <Modal
          open
          onClose={() => setRejecting(null)}
          title={`Reject leave — ${fullName(rejecting.employee)}`}
          footer={
            <>
              <Button onClick={() => setRejecting(null)}>{t('common.cancel')}</Button>
              <Button variant="danger" loading={decide.isPending} onClick={() => decide.mutate({ id: rejecting.id, action: 'reject', comment })}>
                Reject request
              </Button>
            </>
          }
        >
          <Field label="Comment for the employee">
            <Textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
          </Field>
        </Modal>
      )}
    </Panel>
  );
}

function AllRequests() {
  const [status, setStatus] = useState('');
  const q = useQuery({ queryKey: ['leave', 'requests', 'all', status], queryFn: () => get<R[]>(`/leave/requests${status ? `?status=${status}` : ''}`) });
  return (
    <div className="space-y-3">
      <Field label="Status" className="max-w-xs">
        <Select value={status} onChange={(e) => setStatus(e.target.value)} placeholder="All" options={['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'].map((s) => ({ value: s, label: s.charAt(0) + s.slice(1).toLowerCase() }))} />
      </Field>
      <Panel padded={false}>
        <RequestsTable rows={q.data} loading={q.isLoading} showEmployee />
      </Panel>
    </div>
  );
}

function Holidays() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [year, setYear] = useState(new Date().getFullYear());
  const [importing, setImporting] = useState(false);
  const [csv, setCsv] = useState('');
  const [form, setForm] = useState({ date: '', name: '', type: 'PUBLIC' });
  const q = useQuery({ queryKey: ['leave', 'holidays', year], queryFn: () => get<R[]>(`/leave/holidays?year=${year}`) });
  const add = useMutation({ mutationFn: () => post('/leave/holidays', form), onSuccess: () => (qc.invalidateQueries({ queryKey: ['leave', 'holidays'] }), setForm({ date: '', name: '', type: 'PUBLIC' })) });
  const remove = useMutation({ mutationFn: (id: string) => del(`/leave/holidays/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['leave', 'holidays'] }) });
  const imp = useMutation({ mutationFn: () => post<R>('/leave/holidays/import', { csv }), onSuccess: () => qc.invalidateQueries({ queryKey: ['leave', 'holidays'] }) });
  const types = ['PUBLIC', 'BANK', 'MERCANTILE', 'POYA', 'COMPANY'].map((v) => ({ value: v, label: v.charAt(0) + v.slice(1).toLowerCase() }));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Year">
          <Input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} className="!w-28" />
        </Field>
        <div className="flex-1" />
        {can('HOLIDAY_MANAGE') && (
          <Button icon={<Upload className="h-4 w-4" />} onClick={() => setImporting(true)}>
            Import calendar
          </Button>
        )}
      </div>
      {can('HOLIDAY_MANAGE') && (
        <Panel title="Add a holiday">
          <div className="grid gap-3 sm:grid-cols-[10rem_1fr_10rem_auto] sm:items-end">
            <Field label="Date">
              <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </Field>
            <Field label="Name">
              <Input value={form.name} placeholder="e.g. Vesak Full Moon Poya Day" onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Type">
              <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} options={types} />
            </Field>
            <Button variant="primary" loading={add.isPending} disabled={!form.date || !form.name} onClick={() => add.mutate()}>
              Add
            </Button>
          </div>
          <ErrorNote error={add.error} />
        </Panel>
      )}
      <Panel padded={false}>
        {q.isLoading ? (
          <Spinner />
        ) : !q.data?.length ? (
          <Empty title={`No holidays entered for ${year}. Import the official Sri Lankan calendar to get started.`} />
        ) : (
          <table className="table-base">
            <thead>
              <tr>
                <th>Date</th>
                <th>Holiday</th>
                <th>Type</th>
                {can('HOLIDAY_MANAGE') && <th />}
              </tr>
            </thead>
            <tbody>
              {q.data.map((h) => (
                <tr key={h.id}>
                  <td>{date(h.date)}</td>
                  <td>{h.name}</td>
                  <td>{h.type.charAt(0) + h.type.slice(1).toLowerCase()}</td>
                  {can('HOLIDAY_MANAGE') && (
                    <td className="text-right">
                      <Button size="sm" variant="ghost" aria-label="Delete" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => confirm(`Delete ${h.name}?`) && remove.mutate(h.id)} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
      {importing && (
        <Modal
          open
          onClose={() => setImporting(false)}
          title="Import holiday calendar"
          footer={
            <>
              <Button onClick={() => setImporting(false)}>Close</Button>
              <Button variant="primary" loading={imp.isPending} disabled={!csv.trim()} onClick={() => imp.mutate()}>
                Import
              </Button>
            </>
          }
        >
          <p className="text-sm text-ink-500">One holiday per line: date, name, type (PUBLIC, BANK, MERCANTILE, POYA or COMPANY). Existing holidays are skipped.</p>
          <Textarea rows={8} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={'2027-01-14,Tamil Thai Pongal Day,PUBLIC\n2027-01-22,Duruthu Full Moon Poya Day,POYA'} className="font-mono text-xs" />
          {imp.data && (
            <p className="text-sm">
              Imported {imp.data.imported}, skipped {imp.data.skipped}.{imp.data.errors.length > 0 && <span className="text-rose"> {imp.data.errors.join(' ')}</span>}
            </p>
          )}
          <ErrorNote error={imp.error} />
        </Modal>
      )}
    </div>
  );
}
