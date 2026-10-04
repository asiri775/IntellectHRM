import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { get, patch, post, qs, type Page, type R } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { date, money } from '@/lib/format';
import { Button, Checkbox, Empty, ErrorNote, Field, Input, Modal, PageHeader, Pagination, Panel, Select, Spinner, StatusBadge, Textarea } from '@/components/ui';
import { CURRENCIES } from './shared';

export const LEAD_STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'DISQUALIFIED', 'CONVERTED'];

export default function LeadsPage() {
  const { can } = useAuth();
  const nav = useNavigate();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [followUpDue, setDue] = useState(false);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ['crm', 'leads', search, status, followUpDue, page],
    queryFn: () => get<Page<R>>(`/crm/leads${qs({ search, status, followUpDue: followUpDue || undefined, page, pageSize: 25 })}`),
    placeholderData: keepPreviousData,
  });
  return (
    <div>
      <PageHeader
        title="Leads"
        actions={
          can('LEAD_MANAGE') && (
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>
              Add lead
            </Button>
          )
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[16rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-ink-300" />
          <Input placeholder="Search name, company, email or number" value={search} onChange={(e) => (setSearch(e.target.value), setPage(1))} className="pl-9" aria-label="Search leads" />
        </div>
        <Select aria-label="Status" className="!w-44" value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))} placeholder="Open and closed" options={LEAD_STATUSES.map((s) => ({ value: s, label: s.charAt(0) + s.slice(1).toLowerCase() }))} />
        <Checkbox label="Follow-up due" checked={followUpDue} onChange={(e) => (setDue(e.target.checked), setPage(1))} />
      </div>
      <Panel padded={false}>
        {q.isLoading ? (
          <Spinner />
        ) : !q.data?.items.length ? (
          <Empty title="No leads match. Add the first enquiry to start the pipeline." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Lead</th>
                    <th>Interested in</th>
                    <th>Source</th>
                    <th className="num">Estimated value</th>
                    <th>Next follow-up</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.items.map((l) => {
                    const overdue = l.nextFollowUpAt && new Date(l.nextFollowUpAt) < new Date() && !['CONVERTED', 'DISQUALIFIED'].includes(l.status);
                    return (
                      <tr key={l.id} className="cursor-pointer" onClick={() => nav(`/crm/leads/${l.id}`)}>
                        <td>
                          <Link to={`/crm/leads/${l.id}`} onClick={(e) => e.stopPropagation()} className="font-medium hover:text-brand">
                            {l.name}
                          </Link>
                          <div className="text-xs text-ink-500">
                            {l.number}
                            {l.companyName && ` · ${l.companyName}`}
                          </div>
                        </td>
                        <td>{l.serviceInterest ?? '—'}</td>
                        <td>{l.source?.name ?? '—'}</td>
                        <td className="num">{l.estimatedValue ? money(l.estimatedValue, l.currency) : '—'}</td>
                        <td className={overdue ? 'text-saffron' : ''}>{l.nextFollowUpAt ? date(l.nextFollowUpAt) : '—'}</td>
                        <td>
                          <StatusBadge status={l.status} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={25} total={q.data.total} onPage={setPage} />
          </>
        )}
      </Panel>
      {open && <LeadModal onClose={() => setOpen(false)} />}
    </div>
  );
}

export function LeadModal({ lead, onClose }: { lead?: R; onClose: () => void }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const sources = useQuery({ queryKey: ['crm', 'sources'], queryFn: () => get<R[]>('/crm/lead-sources') });
  const users = useQuery({ queryKey: ['users', 'all'], queryFn: () => get<Page<R>>('/users?pageSize=200'), retry: false });
  const [f, setF] = useState({
    name: lead?.name ?? '',
    companyName: lead?.companyName ?? '',
    email: lead?.email ?? '',
    phone: lead?.phone ?? '',
    country: lead?.country ?? 'LK',
    sourceId: lead?.sourceId ?? '',
    campaign: lead?.campaign ?? '',
    serviceInterest: lead?.serviceInterest ?? '',
    estimatedValue: lead?.estimatedValue ? String(Number(lead.estimatedValue)) : '',
    currency: lead?.currency ?? 'LKR',
    probability: String(lead?.probability ?? 10),
    ownerUserId: lead?.ownerUserId ?? '',
    status: lead?.status ?? 'NEW',
    nextFollowUpAt: lead?.nextFollowUpAt ? lead.nextFollowUpAt.slice(0, 16) : '',
    marketingConsent: lead?.marketingConsent ?? false,
    notes: lead?.notes ?? '',
  });
  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...f,
        sourceId: f.sourceId || null,
        ownerUserId: f.ownerUserId || undefined,
        estimatedValue: f.estimatedValue ? Number(f.estimatedValue) : null,
        probability: Number(f.probability),
        nextFollowUpAt: f.nextFollowUpAt ? new Date(f.nextFollowUpAt).toISOString() : null,
        email: f.email || null,
      };
      return lead ? patch<R>(`/crm/leads/${lead.id}`, body) : post<R>('/crm/leads', body);
    },
    onSuccess: (r: R) => {
      qc.invalidateQueries({ queryKey: ['crm'] });
      onClose();
      if (!lead && r?.id) nav(`/crm/leads/${r.id}`);
    },
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={lead ? `Edit ${lead.number}` : 'Add lead'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!f.name} loading={save.isPending} onClick={() => save.mutate()}>
            {lead ? 'Save lead' : 'Add lead'}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Contact name">
          <Input value={f.name} onChange={set('name')} />
        </Field>
        <Field label="Company">
          <Input value={f.companyName} onChange={set('companyName')} />
        </Field>
        <Field label="Email">
          <Input type="email" value={f.email} onChange={set('email')} />
        </Field>
        <Field label="Phone">
          <Input value={f.phone} onChange={set('phone')} />
        </Field>
        <Field label="Interested in">
          <Input value={f.serviceInterest} onChange={set('serviceInterest')} placeholder="e.g. Mobile app, SEO, cloud migration" />
        </Field>
        <Field label="Source">
          <Select value={f.sourceId} onChange={set('sourceId')} placeholder="—" options={(sources.data ?? []).map((s) => ({ value: s.id, label: s.name }))} />
        </Field>
        <div className="grid grid-cols-[1fr_6rem] gap-2">
          <Field label="Estimated value">
            <Input type="number" min={0} value={f.estimatedValue} onChange={set('estimatedValue')} />
          </Field>
          <Field label="Currency">
            <Select value={f.currency} onChange={set('currency')} options={CURRENCIES} />
          </Field>
        </div>
        <Field label="Probability (%)">
          <Input type="number" min={0} max={100} value={f.probability} onChange={set('probability')} />
        </Field>
        <Field label="Next follow-up" hint="The owner gets a reminder when it is due.">
          <Input type="datetime-local" value={f.nextFollowUpAt} onChange={set('nextFollowUpAt')} />
        </Field>
        {users.data && (
          <Field label="Owner">
            <Select value={f.ownerUserId} onChange={set('ownerUserId')} placeholder="Me" options={users.data.items.filter((u) => u.isActive).map((u) => ({ value: u.id, label: u.displayName }))} />
          </Field>
        )}
        {lead && (
          <Field label="Status">
            <Select value={f.status} onChange={set('status')} options={LEAD_STATUSES.filter((s) => s !== 'CONVERTED').map((s) => ({ value: s, label: s.charAt(0) + s.slice(1).toLowerCase() }))} />
          </Field>
        )}
        <Field label="Campaign">
          <Input value={f.campaign} onChange={set('campaign')} />
        </Field>
      </div>
      <Field label="Notes">
        <Textarea rows={2} value={f.notes} onChange={set('notes')} />
      </Field>
      <Checkbox label="Agreed to receive marketing emails (consent is recorded with a timestamp)" checked={f.marketingConsent} onChange={(e) => setF({ ...f, marketingConsent: e.target.checked })} />
      <ErrorNote error={save.error} />
    </Modal>
  );
}
