import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Download, FileUp, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { api, del, download, get, patch, post, type R } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { date, fullName, money, titleCase } from '@/lib/format';
import { Badge, Button, Details, Empty, ErrorNote, Field, Input, Modal, PageHeader, Panel, Select, Spinner, StatusBadge, Tabs, Textarea } from '@/components/ui';
import { EMPLOYMENT_TYPES } from './Employees';

type Tab = 'profile' | 'contracts' | 'documents' | 'salary' | 'leave';

export default function EmployeeDetailPage() {
  const { id } = useParams() as { id: string };
  const { can } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('profile');
  const q = useQuery({ queryKey: ['employee', id], queryFn: () => get(`/employees/${id}`) });
  const archive = useMutation({ mutationFn: () => del(`/employees/${id}`), onSuccess: () => (qc.invalidateQueries({ queryKey: ['employees'] }), nav('/employees')) });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} />;
  const e = q.data!;
  const tabs: { value: Tab; label: string }[] = [
    { value: 'profile', label: 'Profile' },
    { value: 'contracts', label: 'Contracts' },
  ];
  if (can('DOCUMENT_VIEW')) tabs.push({ value: 'documents', label: 'Documents' });
  if (can('PAYROLL_VIEW', 'SALARY_MANAGE')) tabs.push({ value: 'salary', label: 'Salary' });
  if (can('LEAVE_VIEW', 'LEAVE_CONFIG')) tabs.push({ value: 'leave', label: 'Leave' });

  return (
    <div>
      <PageHeader
        title={fullName(e)}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {e.employeeNo} · {e.designation?.name ?? 'No designation'} · {e.department?.name ?? 'No department'} <StatusBadge status={e.employmentStatus} /> <Badge tone="teal">{titleCase(e.employmentType)}</Badge>
          </span>
        }
        actions={
          <>
            {can('EMPLOYEE_EDIT') && (
              <Button icon={<Pencil className="h-4 w-4" />} onClick={() => nav(`/employees/${id}/edit`)}>
                Edit
              </Button>
            )}
            {can('EMPLOYEE_DELETE') && (
              <Button variant="ghost" icon={<Archive className="h-4 w-4" />} loading={archive.isPending} onClick={() => confirm(`Archive ${fullName(e)}? Their sign-in will be disabled.`) && archive.mutate()}>
                Archive
              </Button>
            )}
          </>
        }
      />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'profile' && <Profile e={e} />}
      {tab === 'contracts' && <Contracts e={e} />}
      {tab === 'documents' && <Documents id={id} />}
      {tab === 'salary' && <Salary e={e} />}
      {tab === 'leave' && <LeaveBalances id={id} />}
    </div>
  );
}

function Profile({ e }: { e: R }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Panel title="Personal">
        <Details
          items={[
            ['Name with initials', e.nameWithInitials],
            ['Email', e.email],
            ['Mobile', e.phone],
            ['Date of birth', e.dateOfBirth ? date(e.dateOfBirth) : null],
            ['Gender', e.gender],
            ['Preferred language', { en: 'English', si: 'සිංහල', ta: 'தமிழ்' }[e.preferredLanguage as 'en']],
            ['Address', e.address],
          ]}
        />
      </Panel>
      <Panel title="Employment">
        <Details
          items={[
            ['Joined', date(e.joiningDate)],
            ['Manager', e.manager ? <Link to={`/employees/${e.manager.id}`} className="text-brand">{fullName(e.manager)}</Link> : null],
            ['Team', e.team?.name],
            ['Location', e.location?.name],
            ['Schedule', e.workSchedule?.name],
            ['Time zone', e.timezone],
            ['Sign-in account', e.user ? `${e.user.email}${e.user.isActive ? '' : ' (disabled)'}` : 'None'],
            ['Leaving date', e.leavingDate ? date(e.leavingDate) : null],
          ]}
        />
      </Panel>
      <Panel title="Identity, tax and bank" actions={!e.sensitiveVisible && <span className="text-xs text-ink-500">Masked</span>}>
        <Details
          items={[
            ['NIC', e.nic],
            ['Passport', e.passportNumber],
            ['EPF number', e.epfNumber],
            ['TIN', e.tin],
            ['Bank', [e.bankName, e.bankBranch].filter(Boolean).join(', ')],
            ['Account', e.bankAccountNumber],
          ]}
        />
      </Panel>
    </div>
  );
}

function Contracts({ e }: { e: R }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [renewing, setRenewing] = useState(false);
  const [ending, setEnding] = useState<R | null>(null);
  const [form, setForm] = useState({ employmentType: e.employmentType, startDate: '', endDate: '', notes: '' });
  const [endDate, setEndDate] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['employee', e.id] });
  const renew = useMutation({ mutationFn: () => post(`/employees/${e.id}/contracts`, { ...form, endDate: form.endDate || null }), onSuccess: () => (refresh(), setRenewing(false)) });
  const end = useMutation({ mutationFn: () => post(`/employees/${e.id}/contracts/${ending!.id}/end`, { endDate }), onSuccess: () => (refresh(), setEnding(null)) });
  return (
    <Panel
      title="Contract history"
      padded={false}
      actions={
        can('CONTRACT_MANAGE') && (
          <Button size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => setRenewing(true)}>
            Renew or change
          </Button>
        )
      }
    >
      {!e.contracts?.length ? (
        <Empty title="No contracts recorded." />
      ) : (
        <table className="table-base">
          <thead>
            <tr>
              <th>Type</th>
              <th>Start</th>
              <th>End</th>
              <th>Status</th>
              <th>Notes</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {e.contracts.map((c: R) => (
              <tr key={c.id}>
                <td>{titleCase(c.employmentType)}</td>
                <td>{date(c.startDate)}</td>
                <td>{c.endDate ? date(c.endDate) : 'Open-ended'}</td>
                <td>
                  <StatusBadge status={c.status} />
                </td>
                <td className="text-ink-500">{c.notes ?? '—'}</td>
                <td className="text-right">
                  {c.status === 'ACTIVE' && can('CONTRACT_MANAGE') && (
                    <Button size="sm" variant="ghost" onClick={() => (setEnding(c), setEndDate(c.endDate?.slice(0, 10) ?? ''))}>
                      End contract
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {renewing && (
        <Modal
          open
          onClose={() => setRenewing(false)}
          title="New contract"
          footer={
            <>
              <Button onClick={() => setRenewing(false)}>Cancel</Button>
              <Button variant="primary" loading={renew.isPending} onClick={() => renew.mutate()}>
                Save contract
              </Button>
            </>
          }
        >
          <p className="text-sm text-ink-500">The current contract is kept in the history and marked as renewed.</p>
          <Field label="Employment type">
            <Select value={form.employmentType} onChange={(x) => setForm({ ...form, employmentType: x.target.value })} options={EMPLOYMENT_TYPES.map((x) => ({ value: x, label: titleCase(x) }))} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start">
              <Input type="date" value={form.startDate} onChange={(x) => setForm({ ...form, startDate: x.target.value })} />
            </Field>
            <Field label="End" hint={form.employmentType === 'CONTRACT' ? 'Required for contracts' : 'Leave empty if open-ended'}>
              <Input type="date" value={form.endDate} onChange={(x) => setForm({ ...form, endDate: x.target.value })} />
            </Field>
          </div>
          <Field label="Notes">
            <Textarea rows={2} value={form.notes} onChange={(x) => setForm({ ...form, notes: x.target.value })} />
          </Field>
          <ErrorNote error={renew.error} />
        </Modal>
      )}
      {ending && (
        <Modal
          open
          onClose={() => setEnding(null)}
          title="End contract"
          footer={
            <>
              <Button onClick={() => setEnding(null)}>Cancel</Button>
              <Button variant="danger" loading={end.isPending} disabled={!endDate} onClick={() => end.mutate()}>
                End contract
              </Button>
            </>
          }
        >
          <p className="text-sm">The employee's status becomes "contract ended" and their sign-in is disabled.</p>
          <Field label="Last working day">
            <Input type="date" value={endDate} onChange={(x) => setEndDate(x.target.value)} />
          </Field>
          <ErrorNote error={end.error} />
        </Modal>
      )}
    </Panel>
  );
}

const DOC_CATEGORIES = ['Employment contract', 'NIC / passport', 'Certificate', 'Qualification', 'Work authorization', 'Performance', 'Warning letter', 'Other'];

function Documents({ id }: { id: string }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [form, setForm] = useState({ category: DOC_CATEGORIES[0], name: '', expiryDate: '' });
  const q = useQuery({ queryKey: ['employee', id, 'documents'], queryFn: () => get<R[]>(`/employees/${id}/documents`) });
  const upload = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append('file', file!);
      fd.append('category', form.category);
      fd.append('name', form.name || file!.name);
      if (form.expiryDate) fd.append('expiryDate', form.expiryDate);
      return api('POST', `/employees/${id}/documents`, fd);
    },
    onSuccess: () => (qc.invalidateQueries({ queryKey: ['employee', id, 'documents'] }), setOpen(false), setFile(null)),
  });
  const remove = useMutation({ mutationFn: (docId: string) => del(`/employees/${id}/documents/${docId}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['employee', id, 'documents'] }) });
  return (
    <Panel
      title="Documents"
      padded={false}
      actions={
        can('DOCUMENT_MANAGE') && (
          <Button size="sm" icon={<FileUp className="h-3.5 w-3.5" />} onClick={() => setOpen(true)}>
            Upload
          </Button>
        )
      }
    >
      {q.isLoading ? (
        <Spinner />
      ) : !q.data?.length ? (
        <Empty title="No documents uploaded." />
      ) : (
        <table className="table-base">
          <thead>
            <tr>
              <th>Document</th>
              <th>Category</th>
              <th className="num">Version</th>
              <th>Expires</th>
              <th>Uploaded</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {q.data.map((d) => {
              const expiring = d.expiryDate && new Date(d.expiryDate).getTime() - Date.now() < 30 * 86400000;
              return (
                <tr key={d.id}>
                  <td className="font-medium">{d.name}</td>
                  <td>{d.category}</td>
                  <td className="num">v{d.version}</td>
                  <td className={expiring ? 'text-saffron' : ''}>{d.expiryDate ? date(d.expiryDate) : '—'}</td>
                  <td>{date(d.createdAt)}</td>
                  <td className="whitespace-nowrap text-right">
                    <Button size="sm" variant="ghost" icon={<Download className="h-3.5 w-3.5" />} aria-label="Download" onClick={() => download(`/employees/${id}/documents/${d.id}/download`, d.name)} />
                    {can('DOCUMENT_MANAGE') && <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} aria-label="Delete" onClick={() => confirm(`Delete ${d.name}?`) && remove.mutate(d.id)} />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {open && (
        <Modal
          open
          onClose={() => setOpen(false)}
          title="Upload document"
          footer={
            <>
              <Button onClick={() => setOpen(false)}>Cancel</Button>
              <Button variant="primary" disabled={!file} loading={upload.isPending} onClick={() => upload.mutate()}>
                Upload
              </Button>
            </>
          }
        >
          <Field label="File" hint="PDF, Word or image, up to 10 MB. Uploading the same name and category again adds a new version.">
            <Input type="file" accept=".pdf,.doc,.docx,image/*" onChange={(x) => setFile(x.target.files?.[0] ?? null)} />
          </Field>
          <Field label="Category">
            <Select value={form.category} onChange={(x) => setForm({ ...form, category: x.target.value })} options={DOC_CATEGORIES.map((c) => ({ value: c, label: c }))} />
          </Field>
          <Field label="Name">
            <Input value={form.name} placeholder={file?.name} onChange={(x) => setForm({ ...form, name: x.target.value })} />
          </Field>
          <Field label="Expiry date (optional)" hint="HR is reminded before it expires.">
            <Input type="date" value={form.expiryDate} onChange={(x) => setForm({ ...form, expiryDate: x.target.value })} />
          </Field>
          <ErrorNote error={upload.error} />
        </Modal>
      )}
    </Panel>
  );
}

function Salary({ e }: { e: R }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const history = useQuery({ queryKey: ['salary', e.id], queryFn: () => get<R[]>(`/payroll/salaries/${e.id}`) });
  const components = useQuery({ queryKey: ['payroll', 'components'], queryFn: () => get<R[]>('/payroll/components') });
  const current = history.data?.[0];
  const [form, setForm] = useState<{ effectiveFrom: string; currency: string; amounts: Record<string, string>; note: string }>({ effectiveFrom: '', currency: 'LKR', amounts: {}, note: '' });
  const fixed = (components.data ?? []).filter((c) => c.isFixed && c.isActive);
  const save = useMutation({
    mutationFn: () =>
      post(`/payroll/salaries/${e.id}`, {
        effectiveFrom: form.effectiveFrom,
        currency: form.currency,
        note: form.note || undefined,
        components: Object.entries(form.amounts)
          .filter(([, v]) => Number(v) > 0)
          .map(([code, v]) => ({ code, amount: Number(v) })),
      }),
    onSuccess: () => (qc.invalidateQueries({ queryKey: ['salary', e.id] }), setOpen(false)),
  });
  const total = (s: R) => (s.components as R[]).reduce((a, c) => a + Number(c.amount), 0);
  const openForm = () => {
    setForm({ effectiveFrom: '', currency: current?.currency ?? 'LKR', amounts: Object.fromEntries(((current?.components as R[]) ?? []).map((c) => [c.code, String(c.amount)])), note: '' });
    setOpen(true);
  };
  return (
    <div className="space-y-4">
      {e.employmentType === 'CONTRACT' && current && total(current) > 150000 && (
        <p className="rounded-ctl border border-saffron/40 bg-saffron/10 px-3 py-2 text-sm">
          Monthly gross {money(total(current), current.currency)} is above LKR 150,000, so 5% contract employee tax ({money(total(current) * 0.05, current.currency)}) will be deducted.
        </p>
      )}
      <Panel
        title="Salary history"
        padded={false}
        actions={
          can('SALARY_MANAGE') && (
            <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={openForm}>
              New salary
            </Button>
          )
        }
      >
        {history.isLoading ? (
          <Spinner />
        ) : !history.data?.length ? (
          <Empty title="No salary set. The employee is left out of payroll until one is added." />
        ) : (
          <table className="table-base">
            <thead>
              <tr>
                <th>Effective from</th>
                <th>Components</th>
                <th className="num">Monthly gross</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {history.data.map((s) => (
                <tr key={s.id}>
                  <td>{date(s.effectiveFrom)}</td>
                  <td className="text-ink-500">{(s.components as R[]).map((c) => `${c.code} ${money(c.amount)}`).join(' · ')}</td>
                  <td className="num font-medium">{money(total(s), s.currency)}</td>
                  <td className="text-ink-500">{s.note ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
      {open && (
        <Modal
          open
          onClose={() => setOpen(false)}
          title="New salary"
          footer={
            <>
              <Button onClick={() => setOpen(false)}>Cancel</Button>
              <Button variant="primary" loading={save.isPending} disabled={!form.effectiveFrom || !Number(form.amounts.BASIC)} onClick={() => save.mutate()}>
                Save salary
              </Button>
            </>
          }
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Effective from">
              <Input type="date" value={form.effectiveFrom} onChange={(x) => setForm({ ...form, effectiveFrom: x.target.value })} />
            </Field>
            <Field label="Currency" hint="Non-LKR needs an exchange rate in Settings">
              <Select value={form.currency} onChange={(x) => setForm({ ...form, currency: x.target.value })} options={['LKR', 'USD', 'NZD', 'AUD', 'GBP', 'EUR', 'CAD'].map((c) => ({ value: c, label: c }))} />
            </Field>
          </div>
          {fixed.map((c) => (
            <Field key={c.code} label={`${c.name}${c.epfApplicable ? ' · EPF' : ''}`}>
              <Input type="number" min={0} step="0.01" value={form.amounts[c.code] ?? ''} onChange={(x) => setForm({ ...form, amounts: { ...form.amounts, [c.code]: x.target.value } })} />
            </Field>
          ))}
          <Field label="Note (kept in the audit log)">
            <Input value={form.note} onChange={(x) => setForm({ ...form, note: x.target.value })} placeholder="e.g. Annual increment 2026" />
          </Field>
          <ErrorNote error={save.error} />
        </Modal>
      )}
    </div>
  );
}

function LeaveBalances({ id }: { id: string }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [year, setYear] = useState(new Date().getFullYear());
  const [adjusting, setAdjusting] = useState<R | null>(null);
  const [value, setValue] = useState('0');
  const [reason, setReason] = useState('');
  const q = useQuery({ queryKey: ['leave', 'balances', id, year], queryFn: () => get<R[]>(`/leave/balances/${id}?year=${year}`) });
  const adj = useMutation({ mutationFn: () => patch(`/leave/balances/${adjusting!.id}`, { adjustment: Number(value), reason }), onSuccess: () => (qc.invalidateQueries({ queryKey: ['leave', 'balances', id] }), setAdjusting(null)) });
  return (
    <Panel title={`Leave balances ${year}`} padded={false} actions={<Input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} className="!w-24 !py-1" aria-label="Year" />}>
      {q.isLoading ? (
        <Spinner />
      ) : (
        <table className="table-base">
          <thead>
            <tr>
              <th>Type</th>
              <th className="num">Entitled</th>
              <th className="num">Carried</th>
              <th className="num">Adjustment</th>
              <th className="num">Used</th>
              <th className="num">Pending</th>
              <th className="num">Available</th>
              {can('LEAVE_CONFIG') && <th />}
            </tr>
          </thead>
          <tbody>
            {(q.data ?? []).map((b) => (
              <tr key={b.id}>
                <td>{b.leaveType.name}</td>
                <td className="num">{b.entitled}</td>
                <td className="num">{b.carriedForward}</td>
                <td className="num">{b.adjustment}</td>
                <td className="num">{b.used}</td>
                <td className="num">{b.pending}</td>
                <td className="num font-semibold">{b.available}</td>
                {can('LEAVE_CONFIG') && (
                  <td className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => (setAdjusting(b), setValue(String(b.adjustment)), setReason(''))}>
                      Adjust
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {adjusting && (
        <Modal
          open
          onClose={() => setAdjusting(null)}
          title={`Adjust ${adjusting.leaveType.name}`}
          footer={
            <>
              <Button onClick={() => setAdjusting(null)}>Cancel</Button>
              <Button variant="primary" loading={adj.isPending} disabled={reason.length < 3} onClick={() => adj.mutate()}>
                Save adjustment
              </Button>
            </>
          }
        >
          <Field label="Adjustment (days, can be negative)" hint="Used for lieu leave earned, opening balances or corrections.">
            <Input type="number" step="0.5" value={value} onChange={(e) => setValue(e.target.value)} />
          </Field>
          <Field label="Reason">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <ErrorNote error={adj.error} />
        </Modal>
      )}
    </Panel>
  );
}
