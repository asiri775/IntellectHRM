import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, RotateCcw } from 'lucide-react';
import { get, post, put, qs, type Page, type R } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { date, dateTime, titleCase } from '@/lib/format';
import { Badge, Button, Checkbox, Empty, ErrorNote, Field, Input, Modal, Pagination, Panel, Select, Spinner, StatusBadge } from '@/components/ui';
import { EMPLOYMENT_TYPES } from '../Employees';

// ─── Organization ───
export function OrganizationSettings() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const L = useQuery({ queryKey: ['org', 'lookups'], queryFn: () => get('/org/lookups') });
  const [dept, setDept] = useState({ code: '', name: '' });
  const [team, setTeam] = useState({ departmentId: '', name: '' });
  const [desig, setDesig] = useState('');
  const [sched, setSched] = useState({ name: '', startTime: '08:30', endTime: '17:30', breakMinutes: '60', graceMinutes: '15', workDays: [1, 2, 3, 4, 5], isDefault: false });
  const done = () => qc.invalidateQueries({ queryKey: ['org'] });
  const addDept = useMutation({ mutationFn: () => post('/org/departments', dept), onSuccess: () => (done(), setDept({ code: '', name: '' })) });
  const addTeam = useMutation({ mutationFn: () => post('/org/teams', team), onSuccess: () => (done(), setTeam({ ...team, name: '' })) });
  const addDesig = useMutation({ mutationFn: () => post('/org/designations', { name: desig }), onSuccess: () => (done(), setDesig('')) });
  const addSched = useMutation({ mutationFn: () => post('/org/work-schedules', { ...sched, breakMinutes: Number(sched.breakMinutes), graceMinutes: Number(sched.graceMinutes) }), onSuccess: () => done() });
  if (!L.data) return <Spinner />;
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Panel title="Departments and teams">
        <ul className="mb-4 space-y-1 text-sm">
          {L.data.departments.map((d: R) => (
            <li key={d.id}>
              <span className="font-medium">{d.name}</span> <span className="text-xs text-ink-500">{d.code}</span>
              <span className="ml-2 text-ink-500">{L.data.teams.filter((t: R) => t.departmentId === d.id).map((t: R) => t.name).join(', ')}</span>
            </li>
          ))}
        </ul>
        {can('ORG_MANAGE') && (
          <div className="space-y-3">
            <div className="grid grid-cols-[6rem_1fr_auto] items-end gap-2">
              <Field label="Code">
                <Input value={dept.code} onChange={(e) => setDept({ ...dept, code: e.target.value.toUpperCase() })} />
              </Field>
              <Field label="New department">
                <Input value={dept.name} onChange={(e) => setDept({ ...dept, name: e.target.value })} />
              </Field>
              <Button disabled={!dept.code || !dept.name} loading={addDept.isPending} onClick={() => addDept.mutate()}>
                Add
              </Button>
            </div>
            <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
              <Field label="Department">
                <Select value={team.departmentId} onChange={(e) => setTeam({ ...team, departmentId: e.target.value })} placeholder="Choose…" options={L.data.departments.map((d: R) => ({ value: d.id, label: d.name }))} />
              </Field>
              <Field label="New team">
                <Input value={team.name} onChange={(e) => setTeam({ ...team, name: e.target.value })} placeholder="e.g. React Team" />
              </Field>
              <Button disabled={!team.departmentId || !team.name} loading={addTeam.isPending} onClick={() => addTeam.mutate()}>
                Add
              </Button>
            </div>
            <ErrorNote error={addDept.error ?? addTeam.error} />
          </div>
        )}
      </Panel>
      <Panel title="Designations">
        <div className="mb-4 flex flex-wrap gap-1.5">
          {L.data.designations.map((d: R) => (
            <Badge key={d.id}>{d.name}</Badge>
          ))}
        </div>
        {can('ORG_MANAGE') && (
          <div className="flex items-end gap-2">
            <Field label="New designation" className="flex-1">
              <Input value={desig} onChange={(e) => setDesig(e.target.value)} />
            </Field>
            <Button disabled={!desig} loading={addDesig.isPending} onClick={() => addDesig.mutate()}>
              Add
            </Button>
          </div>
        )}
        <ErrorNote error={addDesig.error} />
      </Panel>
      <Panel title="Work schedules" className="xl:col-span-2">
        <table className="table-base mb-4">
          <thead>
            <tr>
              <th>Schedule</th>
              <th>Hours</th>
              <th>Break</th>
              <th>Late after</th>
              <th>Days</th>
            </tr>
          </thead>
          <tbody>
            {L.data.schedules.map((s: R) => (
              <tr key={s.id}>
                <td>
                  {s.name} {s.isDefault && <Badge tone="blue">Default</Badge>}
                </td>
                <td>
                  {s.startTime}–{s.endTime}
                </td>
                <td>{s.breakMinutes} min</td>
                <td>{s.graceMinutes} min grace</td>
                <td>{s.workDays.map((d: number) => days[d - 1]).join(' ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {can('SCHEDULE_MANAGE') && (
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-5">
              <Field label="Name">
                <Input value={sched.name} onChange={(e) => setSched({ ...sched, name: e.target.value })} placeholder="e.g. Saturday half day" />
              </Field>
              <Field label="Start">
                <Input type="time" value={sched.startTime} onChange={(e) => setSched({ ...sched, startTime: e.target.value })} />
              </Field>
              <Field label="End">
                <Input type="time" value={sched.endTime} onChange={(e) => setSched({ ...sched, endTime: e.target.value })} />
              </Field>
              <Field label="Break (min)">
                <Input type="number" value={sched.breakMinutes} onChange={(e) => setSched({ ...sched, breakMinutes: e.target.value })} />
              </Field>
              <Field label="Grace (min)">
                <Input type="number" value={sched.graceMinutes} onChange={(e) => setSched({ ...sched, graceMinutes: e.target.value })} />
              </Field>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              {days.map((d, i) => (
                <Checkbox key={d} label={d} checked={sched.workDays.includes(i + 1)} onChange={(e) => setSched({ ...sched, workDays: e.target.checked ? [...sched.workDays, i + 1].sort() : sched.workDays.filter((x) => x !== i + 1) })} />
              ))}
              <Checkbox label="Default for new employees" checked={sched.isDefault} onChange={(e) => setSched({ ...sched, isDefault: e.target.checked })} />
              <Button disabled={!sched.name} loading={addSched.isPending} onClick={() => addSched.mutate()}>
                Add schedule
              </Button>
            </div>
            <ErrorNote error={addSched.error} />
          </div>
        )}
      </Panel>
    </div>
  );
}

// ─── Leave types ───
export function LeaveTypeSettings() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['leave', 'types'], queryFn: () => get<R[]>('/leave/types') });
  const [editing, setEditing] = useState<R | null>(null);
  const [rollYear, setRollYear] = useState(new Date().getFullYear());
  const save = useMutation({
    mutationFn: (t: R) => {
      const body = { code: t.code, name: t.name, isPaid: t.isPaid, allowHalfDay: t.allowHalfDay, allowShortLeave: t.allowShortLeave, color: t.color, isActive: t.isActive, rules: t.rules.map((r: R) => ({ employmentType: r.employmentType, daysPerYear: Number(r.daysPerYear), carryForwardMax: Number(r.carryForwardMax), prorate: r.prorate })) };
      return t.id ? put(`/leave/types/${t.id}`, body) : post('/leave/types', body);
    },
    onSuccess: () => (qc.invalidateQueries({ queryKey: ['leave'] }), setEditing(null)),
  });
  const roll = useMutation({ mutationFn: () => post<R>('/leave/balances/rollover', { fromYear: rollYear }) });
  if (q.isLoading) return <Spinner />;
  return (
    <div className="space-y-4">
      <Panel
        title="Leave types and yearly entitlements"
        padded={false}
        actions={
          <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setEditing({ code: '', name: '', isPaid: true, allowHalfDay: true, allowShortLeave: false, color: '#1F4FD8', isActive: true, rules: [] })}>
            Add leave type
          </Button>
        }
      >
        <table className="table-base">
          <thead>
            <tr>
              <th>Leave type</th>
              {EMPLOYMENT_TYPES.map((t) => (
                <th key={t} className="num">
                  {titleCase(t)}
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {q.data?.map((t) => (
              <tr key={t.id} className={t.isActive ? '' : 'opacity-50'}>
                <td>
                  <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ background: t.color }} />
                  {t.name} {!t.isPaid && <Badge>No-pay</Badge>}
                </td>
                {EMPLOYMENT_TYPES.map((et) => {
                  const r = t.rules.find((x: R) => x.employmentType === et);
                  return (
                    <td key={et} className="num">
                      {r ? Number(r.daysPerYear) : '—'}
                    </td>
                  );
                })}
                <td className="text-right">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(structuredClone(t))}>
                    Edit
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <Panel title="Year-end carry forward">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Carry unused leave from year">
            <Input type="number" value={rollYear} onChange={(e) => setRollYear(Number(e.target.value))} className="!w-28" />
          </Field>
          <Button loading={roll.isPending} onClick={() => confirm(`Carry forward unused ${rollYear} leave into ${rollYear + 1}, up to each type's limit?`) && roll.mutate()}>
            Run carry forward
          </Button>
          {roll.data && (
            <span className="text-sm text-leaf">
              Updated {roll.data.balances} balances for {roll.data.toYear}.
            </span>
          )}
        </div>
        <ErrorNote error={roll.error} />
      </Panel>
      {editing && (
        <Modal
          open
          wide
          onClose={() => setEditing(null)}
          title={editing.id ? `Edit ${editing.name}` : 'New leave type'}
          footer={
            <>
              <Button onClick={() => setEditing(null)}>Cancel</Button>
              <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(editing)}>
                Save leave type
              </Button>
            </>
          }
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Name">
              <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </Field>
            <Field label="Code">
              <Input value={editing.code} disabled={!!editing.id} onChange={(e) => setEditing({ ...editing, code: e.target.value.toUpperCase() })} className="font-mono" />
            </Field>
            <Field label="Colour">
              <input type="color" value={editing.color} onChange={(e) => setEditing({ ...editing, color: e.target.value })} className="h-9 w-16 rounded border border-ink-100" />
            </Field>
          </div>
          <div className="flex flex-wrap gap-5">
            <Checkbox label="Paid" checked={editing.isPaid} onChange={(e) => setEditing({ ...editing, isPaid: e.target.checked })} />
            <Checkbox label="Half days allowed" checked={editing.allowHalfDay} onChange={(e) => setEditing({ ...editing, allowHalfDay: e.target.checked })} />
            <Checkbox label="Short leave" checked={editing.allowShortLeave} onChange={(e) => setEditing({ ...editing, allowShortLeave: e.target.checked })} />
            <Checkbox label="Active" checked={editing.isActive} onChange={(e) => setEditing({ ...editing, isActive: e.target.checked })} />
          </div>
          <table className="table-base">
            <thead>
              <tr>
                <th>Employment type</th>
                <th className="num">Days per year</th>
                <th className="num">Max carry forward</th>
                <th>Prorate for joiners</th>
              </tr>
            </thead>
            <tbody>
              {EMPLOYMENT_TYPES.map((et) => {
                const r = editing.rules.find((x: R) => x.employmentType === et);
                const setRule = (p: R | null) =>
                  setEditing({ ...editing, rules: p === null ? editing.rules.filter((x: R) => x.employmentType !== et) : [...editing.rules.filter((x: R) => x.employmentType !== et), { employmentType: et, daysPerYear: 0, carryForwardMax: 0, prorate: true, ...r, ...p }] });
                return (
                  <tr key={et}>
                    <td>
                      <Checkbox label={titleCase(et)} checked={!!r} onChange={(e) => setRule(e.target.checked ? {} : null)} />
                    </td>
                    <td className="num">{r && <Input type="number" step="0.5" value={Number(r.daysPerYear)} onChange={(e) => setRule({ daysPerYear: e.target.value })} className="!w-24 text-right" />}</td>
                    <td className="num">{r && <Input type="number" step="0.5" value={Number(r.carryForwardMax)} onChange={(e) => setRule({ carryForwardMax: e.target.value })} className="!w-24 text-right" />}</td>
                    <td>{r && <Checkbox label="" checked={r.prorate} onChange={(e) => setRule({ prorate: e.target.checked })} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <ErrorNote error={save.error} />
        </Modal>
      )}
    </div>
  );
}

// ─── Numbering ───
export function NumberingSettings() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['sequences'], queryFn: () => get<R[]>('/sequences') });
  const [editing, setEditing] = useState<R | null>(null);
  const save = useMutation({
    mutationFn: () => put(`/sequences/${editing!.key}`, { prefix: editing!.prefix, format: editing!.format, padding: Number(editing!.padding), resetYearly: editing!.resetYearly, nextValue: Number(editing!.nextValue) }),
    onSuccess: () => (qc.invalidateQueries({ queryKey: ['sequences'] }), setEditing(null)),
  });
  const example = (s: R) =>
    s.format
      .replace('{PREFIX}', s.prefix)
      .replace('{YYYY}', String(new Date().getFullYear()))
      .replace('{YY}', String(new Date().getFullYear()).slice(-2))
      .replace('{MM}', String(new Date().getMonth() + 1).padStart(2, '0'))
      .replace('{SEQ}', String(s.nextValue).padStart(Number(s.padding), '0'));
  return (
    <Panel title="Document numbering" padded={false}>
      {q.isLoading ? (
        <Spinner />
      ) : !q.data?.length ? (
        <Empty title="Sequences appear here once the first document of each kind is created." />
      ) : (
        <table className="table-base">
          <thead>
            <tr>
              <th>Document</th>
              <th>Format</th>
              <th>Next number</th>
              <th>Resets yearly</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {q.data.map((s) => (
              <tr key={s.id}>
                <td>{titleCase(s.key)}</td>
                <td className="font-mono text-xs">{s.format}</td>
                <td className="font-mono">{example(s)}</td>
                <td>{s.resetYearly ? 'Yes' : 'No'}</td>
                <td className="text-right">
                  <Button size="sm" variant="ghost" onClick={() => setEditing({ ...s })}>
                    Edit
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editing && (
        <Modal
          open
          onClose={() => setEditing(null)}
          title={`Numbering — ${titleCase(editing.key)}`}
          footer={
            <>
              <Button onClick={() => setEditing(null)}>Cancel</Button>
              <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
                Save
              </Button>
            </>
          }
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Prefix">
              <Input value={editing.prefix} onChange={(e) => setEditing({ ...editing, prefix: e.target.value })} />
            </Field>
            <Field label="Digits">
              <Input type="number" min={1} max={10} value={editing.padding} onChange={(e) => setEditing({ ...editing, padding: e.target.value })} />
            </Field>
          </div>
          <Field label="Format" hint="Use {PREFIX}, {YYYY}, {YY}, {MM} and {SEQ}">
            <Input value={editing.format} onChange={(e) => setEditing({ ...editing, format: e.target.value })} className="font-mono" />
          </Field>
          <Field label="Next number" hint="Can only move forward, so numbers are never reused.">
            <Input type="number" min={editing.nextValue} value={editing.nextValue} onChange={(e) => setEditing({ ...editing, nextValue: e.target.value })} />
          </Field>
          <Checkbox label="Restart at 1 each year" checked={editing.resetYearly} onChange={(e) => setEditing({ ...editing, resetYearly: e.target.checked })} />
          <p className="text-sm">
            Example: <span className="font-mono">{example(editing)}</span>
          </p>
          <ErrorNote error={save.error} />
        </Modal>
      )}
    </Panel>
  );
}

// ─── Tax & currency ───
export function TaxCurrencySettings() {
  const qc = useQueryClient();
  const taxes = useQuery({ queryKey: ['tax-codes'], queryFn: () => get<R[]>('/tax-codes') });
  const rates = useQuery({ queryKey: ['exchange-rates'], queryFn: () => get<R[]>('/exchange-rates') });
  const [tax, setTax] = useState({ code: '', name: '', rate: '', effectiveFrom: '' });
  const [rate, setRate] = useState({ fromCurrency: 'USD', rate: '', effectiveDate: '', source: 'CBSL' });
  const addTax = useMutation({ mutationFn: () => post('/tax-codes', { ...tax, rate: Number(tax.rate) / 100 }), onSuccess: () => (qc.invalidateQueries({ queryKey: ['tax-codes'] }), setTax({ code: '', name: '', rate: '', effectiveFrom: '' })) });
  const addRate = useMutation({ mutationFn: () => post('/exchange-rates', { ...rate, rate: Number(rate.rate) }), onSuccess: () => qc.invalidateQueries({ queryKey: ['exchange-rates'] }) });
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Panel title="Tax codes" padded={false}>
        <table className="table-base">
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th className="num">Rate</th>
              <th>From</th>
            </tr>
          </thead>
          <tbody>
            {(taxes.data ?? []).map((t) => (
              <tr key={t.id}>
                <td className="font-mono">{t.code}</td>
                <td>{t.name}</td>
                <td className="num">{+(Number(t.rate) * 100).toFixed(3)}%</td>
                <td>{date(t.effectiveFrom)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-5 sm:items-end">
          <Field label="Code">
            <Input value={tax.code} onChange={(e) => setTax({ ...tax, code: e.target.value.toUpperCase() })} />
          </Field>
          <Field label="Name">
            <Input value={tax.name} onChange={(e) => setTax({ ...tax, name: e.target.value })} />
          </Field>
          <Field label="Rate %">
            <Input type="number" step="0.01" value={tax.rate} onChange={(e) => setTax({ ...tax, rate: e.target.value })} />
          </Field>
          <Field label="From">
            <Input type="date" value={tax.effectiveFrom} onChange={(e) => setTax({ ...tax, effectiveFrom: e.target.value })} />
          </Field>
          <Button disabled={!tax.code || !tax.effectiveFrom} loading={addTax.isPending} onClick={() => addTax.mutate()}>
            Add
          </Button>
        </div>
        <div className="px-4 pb-3">
          <ErrorNote error={addTax.error} />
        </div>
      </Panel>
      <Panel title="Exchange rates to LKR" padded={false}>
        <table className="table-base">
          <thead>
            <tr>
              <th>Currency</th>
              <th className="num">1 unit = LKR</th>
              <th>Date</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {(rates.data ?? []).slice(0, 20).map((r) => (
              <tr key={r.id}>
                <td>{r.fromCurrency}</td>
                <td className="num">{Number(r.rate).toFixed(4)}</td>
                <td>{date(r.effectiveDate)}</td>
                <td>{r.source ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-5 sm:items-end">
          <Field label="Currency">
            <Select value={rate.fromCurrency} onChange={(e) => setRate({ ...rate, fromCurrency: e.target.value })} options={['USD', 'NZD', 'AUD', 'GBP', 'EUR', 'CAD'].map((c) => ({ value: c, label: c }))} />
          </Field>
          <Field label="Rate">
            <Input type="number" step="0.0001" value={rate.rate} onChange={(e) => setRate({ ...rate, rate: e.target.value })} />
          </Field>
          <Field label="Date">
            <Input type="date" value={rate.effectiveDate} onChange={(e) => setRate({ ...rate, effectiveDate: e.target.value })} />
          </Field>
          <Field label="Source">
            <Input value={rate.source} onChange={(e) => setRate({ ...rate, source: e.target.value })} />
          </Field>
          <Button disabled={!rate.rate || !rate.effectiveDate} loading={addRate.isPending} onClick={() => addRate.mutate()}>
            Add
          </Button>
        </div>
        <div className="px-4 pb-3">
          <ErrorNote error={addRate.error} />
        </div>
      </Panel>
    </div>
  );
}

// ─── Outbox ───
export function OutboxSettings() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['outbox', status, page], queryFn: () => get<Page<R>>(`/email-outbox${qs({ status, page, pageSize: 25 })}`), placeholderData: keepPreviousData, refetchInterval: 15_000 });
  const retry = useMutation({ mutationFn: (id: string) => post(`/email-outbox/${id}/retry`), onSuccess: () => qc.invalidateQueries({ queryKey: ['outbox'] }) });
  return (
    <Panel
      title="Email outbox"
      padded={false}
      actions={<Select aria-label="Status" value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))} placeholder="All" options={['QUEUED', 'SENT', 'FAILED'].map((s) => ({ value: s, label: titleCase(s) }))} className="!w-32 !py-1" />}
    >
      {q.isLoading ? (
        <Spinner />
      ) : !q.data?.items.length ? (
        <Empty title="No emails." />
      ) : (
        <>
          <table className="table-base">
            <thead>
              <tr>
                <th>To</th>
                <th>Subject</th>
                <th>Template</th>
                <th>Created</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {q.data.items.map((m) => (
                <tr key={m.id}>
                  <td>{m.to}</td>
                  <td className="max-w-xs truncate">{m.subject}</td>
                  <td className="font-mono text-xs">{m.templateKey}</td>
                  <td>{dateTime(m.createdAt)}</td>
                  <td>
                    <StatusBadge status={m.status} />
                    {m.lastError && <div className="max-w-xs truncate text-xs text-rose" title={m.lastError}>{m.lastError}</div>}
                  </td>
                  <td>{m.status === 'FAILED' && <Button size="sm" variant="ghost" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => retry.mutate(m.id)}>Retry</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination page={page} pageSize={25} total={q.data.total} onPage={setPage} />
        </>
      )}
    </Panel>
  );
}

// ─── Audit ───
export function AuditSettings() {
  const [module, setModule] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<R | null>(null);
  const q = useQuery({ queryKey: ['audit', module, page], queryFn: () => get<Page<R>>(`/audit-logs${qs({ module, page, pageSize: 50 })}`), placeholderData: keepPreviousData });
  return (
    <Panel
      title="Audit log"
      padded={false}
      actions={<Select aria-label="Module" value={module} onChange={(e) => (setModule(e.target.value), setPage(1))} placeholder="All modules" options={['AUTH', 'ADMIN', 'ORG', 'HRM', 'ATTENDANCE', 'LEAVE', 'PAYROLL', 'CRM'].map((m) => ({ value: m, label: titleCase(m) }))} className="!w-40 !py-1" />}
    >
      {q.isLoading ? (
        <Spinner />
      ) : (
        <>
          <table className="table-base">
            <thead>
              <tr>
                <th>When</th>
                <th>Action</th>
                <th>Record</th>
                <th>Reason</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {q.data?.items.map((a) => (
                <tr key={a.id} className="cursor-pointer" onClick={() => setOpen(a)}>
                  <td className="whitespace-nowrap">{dateTime(a.createdAt)}</td>
                  <td>
                    <Badge>{a.module}</Badge> {titleCase(a.action)}
                  </td>
                  <td className="text-ink-500">
                    {a.entity} <span className="font-mono text-xs">{a.entityId?.slice(0, 8)}</span>
                  </td>
                  <td className="max-w-xs truncate">{a.reason ?? '—'}</td>
                  <td className="font-mono text-xs">{a.ip ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {q.data && <Pagination page={page} pageSize={50} total={q.data.total} onPage={setPage} />}
        </>
      )}
      {open && (
        <Modal open wide onClose={() => setOpen(null)} title={`${open.module} · ${titleCase(open.action)}`}>
          <p className="text-sm text-ink-500">
            {dateTime(open.createdAt)} · user {open.userId ?? 'system'} · {open.entity} {open.entityId}
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <div className="mb-1 text-xs font-semibold">Before</div>
              <pre className="max-h-96 overflow-auto rounded-ctl bg-ink-50 p-2 text-xs dark:bg-ink-700">{JSON.stringify(open.oldValue, null, 2) ?? '—'}</pre>
            </div>
            <div>
              <div className="mb-1 text-xs font-semibold">After</div>
              <pre className="max-h-96 overflow-auto rounded-ctl bg-ink-50 p-2 text-xs dark:bg-ink-700">{JSON.stringify(open.newValue, null, 2) ?? '—'}</pre>
            </div>
          </div>
        </Modal>
      )}
    </Panel>
  );
}
