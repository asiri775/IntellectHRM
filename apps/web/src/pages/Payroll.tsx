import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { del, get, post, qs, type R } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { date, fullName, money, monthName, titleCase } from '@/lib/format';
import { Badge, Button, Checkbox, Empty, ErrorNote, Field, Input, Modal, PageHeader, Panel, Select, Spinner, StatusBadge, Tabs, Textarea } from '@/components/ui';
import { EMPLOYMENT_TYPES } from './Employees';

type Tab = 'runs' | 'adjustments' | 'rules';

export default function PayrollPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>(can('PAYROLL_VIEW') ? 'runs' : 'rules');
  const tabs: { value: Tab; label: string }[] = [];
  if (can('PAYROLL_VIEW')) tabs.push({ value: 'runs', label: 'Payroll runs' });
  if (can('SALARY_MANAGE', 'PAYROLL_VIEW')) tabs.push({ value: 'adjustments', label: 'Monthly adjustments' });
  tabs.push({ value: 'rules', label: 'Statutory rules' });
  return (
    <div>
      <PageHeader title="Payroll" subtitle="Monthly payroll with EPF, ETF, APIT and contract employee tax" />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'runs' && <Runs />}
      {tab === 'adjustments' && <Adjustments />}
      {tab === 'rules' && <Rules />}
    </div>
  );
}

function Runs() {
  const { can } = useAuth();
  const nav = useNavigate();
  const now = new Date();
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });
  const q = useQuery({ queryKey: ['payroll', 'runs'], queryFn: () => get<R[]>('/payroll/runs') });
  const create = useMutation({ mutationFn: () => post<R>('/payroll/runs', period), onSuccess: (r) => nav(`/payroll/runs/${r.id}`) });
  return (
    <>
      <div className="mb-4 flex justify-end">
        {can('PAYROLL_RUN') && (
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>
            New payroll run
          </Button>
        )}
      </div>
      <Panel padded={false}>
        {q.isLoading ? (
          <Spinner />
        ) : !q.data?.length ? (
          <Empty title="No payroll runs yet. Start one for this month." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Period</th>
                  <th>Run</th>
                  <th className="num">Employees</th>
                  <th className="num">Gross</th>
                  <th className="num">EPF + ETF</th>
                  <th className="num">Tax (APIT + contract)</th>
                  <th className="num">Net pay</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {q.data.map((r) => (
                  <tr key={r.id} className="cursor-pointer" onClick={() => nav(`/payroll/runs/${r.id}`)}>
                    <td className="font-medium">
                      <Link to={`/payroll/runs/${r.id}`} onClick={(e) => e.stopPropagation()} className="hover:text-brand">
                        {monthName(r.month)} {r.year}
                      </Link>
                    </td>
                    <td className="text-ink-500">{r.number}</td>
                    <td className="num">{r.employeeCount}</td>
                    <td className="num">{money(r.totalGross)}</td>
                    <td className="num">{money(Number(r.totalEpfEmployee) + Number(r.totalEpfEmployer) + Number(r.totalEtf))}</td>
                    <td className="num">{money(Number(r.totalApit) + Number(r.totalContractTax))}</td>
                    <td className="num font-medium">{money(r.totalNet)}</td>
                    <td>
                      <StatusBadge status={r.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {open && (
        <Modal
          open
          onClose={() => setOpen(false)}
          title="New payroll run"
          footer={
            <>
              <Button onClick={() => setOpen(false)}>Cancel</Button>
              <Button variant="primary" loading={create.isPending} onClick={() => create.mutate()}>
                Create run
              </Button>
            </>
          }
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Month">
              <Select value={String(period.month)} onChange={(e) => setPeriod({ ...period, month: Number(e.target.value) })} options={Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: monthName(i + 1) }))} />
            </Field>
            <Field label="Year">
              <Input type="number" value={period.year} onChange={(e) => setPeriod({ ...period, year: Number(e.target.value) })} />
            </Field>
          </div>
          <p className="text-sm text-ink-500">Everyone with a salary in this period is included. Approved no-pay leave and this month's adjustments are applied when you calculate.</p>
          <ErrorNote error={create.error} />
        </Modal>
      )}
    </>
  );
}

function Adjustments() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const now = new Date();
  const [period, setPeriod] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });
  const [open, setOpen] = useState(false);
  const empty = { employeeId: '', kind: 'EARNING', code: 'OVERTIME', name: 'Overtime', amount: '', epfApplicable: false, taxable: true, note: '' };
  const [form, setForm] = useState(empty);
  const q = useQuery({ queryKey: ['payroll', 'adjustments', period], queryFn: () => get<R[]>(`/payroll/adjustments${qs(period)}`) });
  const lookups = useQuery({ queryKey: ['org', 'lookups'], queryFn: () => get('/org/lookups') });
  const add = useMutation({
    mutationFn: () => post('/payroll/adjustments', { ...form, ...period, amount: Number(form.amount), code: form.code.toUpperCase().replace(/[^A-Z0-9_]/g, '_'), note: form.note || undefined }),
    onSuccess: () => (qc.invalidateQueries({ queryKey: ['payroll', 'adjustments'] }), setOpen(false), setForm(empty)),
  });
  const remove = useMutation({ mutationFn: (id: string) => del(`/payroll/adjustments/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['payroll', 'adjustments'] }) });
  const presets: Record<string, { kind: string; name: string; epf: boolean }> = {
    OVERTIME: { kind: 'EARNING', name: 'Overtime', epf: false },
    BONUS: { kind: 'EARNING', name: 'Bonus', epf: false },
    ARREARS: { kind: 'EARNING', name: 'Salary arrears', epf: true },
    LOAN: { kind: 'DEDUCTION', name: 'Staff loan instalment', epf: false },
    ADVANCE: { kind: 'DEDUCTION', name: 'Salary advance recovery', epf: false },
    OTHER: { kind: 'DEDUCTION', name: 'Other deduction', epf: false },
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Month">
          <Select value={String(period.month)} onChange={(e) => setPeriod({ ...period, month: Number(e.target.value) })} options={Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: monthName(i + 1) }))} />
        </Field>
        <Field label="Year">
          <Input type="number" value={period.year} onChange={(e) => setPeriod({ ...period, year: Number(e.target.value) })} className="!w-28" />
        </Field>
        <div className="flex-1" />
        {can('SALARY_MANAGE') && (
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>
            Add adjustment
          </Button>
        )}
      </div>
      <Panel padded={false}>
        {q.isLoading ? (
          <Spinner />
        ) : !q.data?.length ? (
          <Empty title="No overtime, bonuses or deductions for this month." />
        ) : (
          <table className="table-base">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Item</th>
                <th>Kind</th>
                <th className="num">Amount</th>
                <th>Note</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {q.data.map((a) => (
                <tr key={a.id}>
                  <td>{fullName(a.employee)}</td>
                  <td>
                    {a.name} <span className="text-xs text-ink-500">{a.code}</span>
                  </td>
                  <td>
                    <Badge tone={a.kind === 'EARNING' ? 'green' : 'red'}>{titleCase(a.kind)}</Badge>
                  </td>
                  <td className="num">{money(a.amount)}</td>
                  <td className="text-ink-500">{a.note ?? '—'}</td>
                  <td className="text-right">{can('SALARY_MANAGE') && <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} aria-label="Delete" onClick={() => remove.mutate(a.id)} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="px-4 pb-3">
          <ErrorNote error={remove.error} />
        </div>
      </Panel>
      {open && (
        <Modal
          open
          onClose={() => setOpen(false)}
          title={`Adjustment for ${monthName(period.month)} ${period.year}`}
          footer={
            <>
              <Button onClick={() => setOpen(false)}>Cancel</Button>
              <Button variant="primary" loading={add.isPending} disabled={!form.employeeId || !Number(form.amount)} onClick={() => add.mutate()}>
                Add adjustment
              </Button>
            </>
          }
        >
          <Field label="Employee">
            <Select value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })} placeholder="Choose…" options={(lookups.data?.managers ?? []).map((m: R) => ({ value: m.id, label: `${m.firstName} ${m.lastName} (${m.employeeNo})` }))} />
          </Field>
          <Field label="Item">
            <Select
              value={form.code}
              onChange={(e) => {
                const p = presets[e.target.value];
                setForm({ ...form, code: e.target.value, kind: p.kind, name: p.name, epfApplicable: p.epf });
              }}
              options={Object.entries(presets).map(([k, v]) => ({ value: k, label: `${v.name} (${v.kind === 'EARNING' ? 'earning' : 'deduction'})` }))}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Description on payslip">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Amount">
              <Input type="number" min={0} step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </Field>
          </div>
          {form.kind === 'EARNING' && (
            <div className="flex gap-6">
              <Checkbox label="Liable for EPF/ETF" checked={form.epfApplicable} onChange={(e) => setForm({ ...form, epfApplicable: e.target.checked })} />
              <Checkbox label="Taxable" checked={form.taxable} onChange={(e) => setForm({ ...form, taxable: e.target.checked })} />
            </div>
          )}
          <Field label="Note">
            <Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </Field>
          <ErrorNote error={add.error} />
        </Modal>
      )}
    </div>
  );
}

const RULE_HELP: Record<string, string> = {
  CONTRACT_EMPLOYEE_TAX: 'Deducted from contract employees whose monthly gross salary is above the threshold.',
  APIT: 'Monthly progressive slabs. Width is the size of each band in LKR; the last band is unlimited.',
  EPF_EMPLOYEE: 'Deducted from the employee on EPF-liable earnings.',
  EPF_EMPLOYER: 'Paid by the company on EPF-liable earnings.',
  ETF: 'Paid by the company on EPF-liable earnings.',
  GRATUITY: 'Monthly provision for gratuity liability.',
  NO_PAY: 'How one no-pay day is valued.',
};

function Rules() {
  const { can } = useAuth();
  const [editing, setEditing] = useState<R | null>(null);
  const q = useQuery({ queryKey: ['payroll', 'rules'], queryFn: () => get<R[]>('/payroll/statutory-rules') });
  if (q.isLoading) return <Spinner />;
  const order = ['CONTRACT_EMPLOYEE_TAX', 'EPF_EMPLOYEE', 'EPF_EMPLOYER', 'ETF', 'APIT', 'GRATUITY', 'NO_PAY'];
  const rules = [...(q.data ?? [])].sort((a, b) => order.indexOf(a.code) - order.indexOf(b.code));
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-500">
        Rates are never edited in place. A change is added as a new version with an effective date, and payroll runs keep the versions they were calculated with. Confirm every rate with your accountant before go-live.
      </p>
      {rules.map((r) => {
        const v = r.versions[0];
        return (
          <Panel
            key={r.id}
            title={r.name}
            actions={
              can('STATUTORY_MANAGE') && (
                <Button size="sm" onClick={() => setEditing(r)}>
                  New version
                </Button>
              )
            }
          >
            <p className="mb-3 text-sm text-ink-500">{RULE_HELP[r.code]}</p>
            {v && <RuleSummary code={r.code} config={v.config} />}
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-ink-500">Version history ({r.versions.length})</summary>
              <table className="table-base mt-2">
                <thead>
                  <tr>
                    <th>Effective from</th>
                    <th>To</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {r.versions.map((x: R) => (
                    <tr key={x.id}>
                      <td>{date(x.effectiveFrom)}</td>
                      <td>{x.effectiveTo ? date(x.effectiveTo) : 'Open'}</td>
                      <td className="text-ink-500">{x.note ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </Panel>
        );
      })}
      {editing && <VersionModal rule={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

const pct = (r: number) => `${+(r * 100).toFixed(4)}%`;
const types = (t: string[]) => (t.length ? t.map(titleCase).join(', ') : 'nobody');

function RuleSummary({ code, config: c }: { code: string; config: R }) {
  if (code === 'CONTRACT_EMPLOYEE_TAX')
    return (
      <p className="text-sm">
        <strong>{pct(c.rate)}</strong> of {c.basis === 'FULL_AMOUNT' ? 'the full gross' : 'gross above the threshold'} when monthly gross is {c.comparison === 'GREATER_THAN' ? 'above' : 'at or above'} <strong>LKR {money(c.thresholdAmount)}</strong>. Applies to {types(c.employmentTypes)}.{' '}
        {c.replacesApit ? 'Replaces APIT.' : 'Deducted in addition to APIT.'} Liability account {c.liabilityAccount}.
      </p>
    );
  if (code === 'APIT')
    return (
      <div className="text-sm">
        <p className="mb-2">Applies to {types(c.employmentTypes)}.</p>
        <div className="flex flex-wrap gap-2">
          {c.slabs.map((s: R, i: number) => (
            <Badge key={i} tone={s.rate ? 'blue' : 'grey'}>
              {s.width === null ? 'Remainder' : `LKR ${money(s.width)}`} @ {pct(s.rate)}
            </Badge>
          ))}
        </div>
      </div>
    );
  if (code === 'GRATUITY') return <p className="text-sm">{c.monthsPerYearOfService} month(s) of basic per year of service, payable after {c.eligibilityYears} years. Accrued for {types(c.employmentTypes)}.</p>;
  if (code === 'NO_PAY') return <p className="text-sm">One day = basic ÷ {c.divisor === 'FIXED' ? c.fixedDivisor : 'working days in the month'}.</p>;
  return (
    <p className="text-sm">
      <strong>{pct(c.rate)}</strong> for {types(c.employmentTypes)}.
    </p>
  );
}

function VersionModal({ rule, onClose }: { rule: R; onClose: () => void }) {
  const qc = useQueryClient();
  const current = rule.versions[0]?.config ?? {};
  const [effectiveFrom, setFrom] = useState('');
  const [note, setNote] = useState('');
  const [cfg, setCfg] = useState<R>(current);
  const [json, setJson] = useState(JSON.stringify(current, null, 2));
  const structured = ['CONTRACT_EMPLOYEE_TAX', 'EPF_EMPLOYEE', 'EPF_EMPLOYER', 'ETF'].includes(rule.code);
  const save = useMutation({
    mutationFn: () => post(`/payroll/statutory-rules/${rule.code}/versions`, { effectiveFrom, note: note || undefined, config: structured ? cfg : JSON.parse(json) }),
    onSuccess: () => (qc.invalidateQueries({ queryKey: ['payroll', 'rules'] }), onClose()),
  });
  const toggleType = (t: string) => setCfg({ ...cfg, employmentTypes: cfg.employmentTypes.includes(t) ? cfg.employmentTypes.filter((x: string) => x !== t) : [...cfg.employmentTypes, t] });
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={`New version — ${rule.name}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!effectiveFrom} onClick={() => save.mutate()}>
            Add version
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Effective from" hint="The previous version ends the day before.">
          <Input type="date" value={effectiveFrom} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="Note (why it changed)">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Budget 2027" />
        </Field>
      </div>
      {structured ? (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Rate (%)">
              <Input type="number" step="0.01" value={+(cfg.rate * 100).toFixed(4)} onChange={(e) => setCfg({ ...cfg, rate: Number(e.target.value) / 100 })} />
            </Field>
            {rule.code === 'CONTRACT_EMPLOYEE_TAX' && (
              <Field label="Monthly threshold (LKR)">
                <Input type="number" value={cfg.thresholdAmount} onChange={(e) => setCfg({ ...cfg, thresholdAmount: Number(e.target.value) })} />
              </Field>
            )}
          </div>
          {rule.code === 'CONTRACT_EMPLOYEE_TAX' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Deduct when gross is">
                <Select value={cfg.comparison} onChange={(e) => setCfg({ ...cfg, comparison: e.target.value })} options={[{ value: 'GREATER_THAN', label: 'Above the threshold' }, { value: 'GREATER_THAN_OR_EQUAL', label: 'At or above the threshold' }]} />
              </Field>
              <Field label="Calculate on">
                <Select value={cfg.basis} onChange={(e) => setCfg({ ...cfg, basis: e.target.value })} options={[{ value: 'FULL_AMOUNT', label: 'The full gross salary' }, { value: 'EXCESS_OVER_THRESHOLD', label: 'Only the amount above the threshold' }]} />
              </Field>
              <Checkbox label="Replaces APIT for these employees" checked={cfg.replacesApit} onChange={(e) => setCfg({ ...cfg, replacesApit: e.target.checked })} />
            </div>
          )}
          <Field label="Applies to">
            <div className="flex flex-wrap gap-4 pt-1">
              {EMPLOYMENT_TYPES.map((t) => (
                <Checkbox key={t} label={titleCase(t)} checked={cfg.employmentTypes.includes(t)} onChange={() => toggleType(t)} />
              ))}
            </div>
          </Field>
        </div>
      ) : (
        <Field label="Configuration (JSON)" hint={RULE_HELP[rule.code]}>
          <Textarea rows={12} value={json} onChange={(e) => setJson(e.target.value)} className="font-mono text-xs" />
        </Field>
      )}
      <ErrorNote error={save.error} />
    </Modal>
  );
}
