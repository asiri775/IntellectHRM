import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { get, patch, post, qs, type Page, type R } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button, Empty, ErrorNote, Field, Input, Modal, PageHeader, Pagination, Panel, Select, Spinner, StatusBadge, Textarea } from '@/components/ui';
import { CURRENCIES } from './shared';

export default function CustomersPage() {
  const { can } = useAuth();
  const nav = useNavigate();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ['crm', 'customers', search, status, page], queryFn: () => get<Page<R>>(`/crm/customers${qs({ search, status, page, pageSize: 25 })}`), placeholderData: keepPreviousData });
  return (
    <div>
      <PageHeader
        title="Customers"
        actions={
          can('CUSTOMER_MANAGE') && (
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>
              Add customer
            </Button>
          )
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-[16rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-ink-300" />
          <Input placeholder="Search customers" value={search} onChange={(e) => (setSearch(e.target.value), setPage(1))} className="pl-9" aria-label="Search customers" />
        </div>
        <Select aria-label="Status" className="!w-40" value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))} placeholder="All" options={['PROSPECT', 'ACTIVE', 'INACTIVE'].map((s) => ({ value: s, label: s.charAt(0) + s.slice(1).toLowerCase() }))} />
      </div>
      <Panel padded={false}>
        {q.isLoading ? (
          <Spinner />
        ) : !q.data?.items.length ? (
          <Empty title="No customers yet. Convert a lead or add one here." />
        ) : (
          <>
            <table className="table-base">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Industry</th>
                  <th>Country</th>
                  <th className="num">Contacts</th>
                  <th className="num">Opportunities</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {q.data.items.map((c) => (
                  <tr key={c.id} className="cursor-pointer" onClick={() => nav(`/crm/customers/${c.id}`)}>
                    <td>
                      <Link to={`/crm/customers/${c.id}`} onClick={(e) => e.stopPropagation()} className="font-medium hover:text-brand">
                        {c.name}
                      </Link>
                      <div className="text-xs text-ink-500">{c.code}</div>
                    </td>
                    <td>{c.industry ?? '—'}</td>
                    <td>{c.country ?? '—'}</td>
                    <td className="num">{c._count.contacts}</td>
                    <td className="num">{c._count.opportunities}</td>
                    <td>
                      <StatusBadge status={c.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={page} pageSize={25} total={q.data.total} onPage={setPage} />
          </>
        )}
      </Panel>
      {open && <CustomerModal onClose={() => setOpen(false)} />}
    </div>
  );
}

export function CustomerModal({ customer, onClose }: { customer?: R; onClose: () => void }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [f, setF] = useState({
    name: customer?.name ?? '',
    industry: customer?.industry ?? '',
    country: customer?.country ?? 'LK',
    website: customer?.website ?? '',
    phone: customer?.phone ?? '',
    email: customer?.email ?? '',
    address: customer?.address ?? '',
    tin: customer?.tin ?? '',
    vatNumber: customer?.vatNumber ?? '',
    currency: customer?.currency ?? 'LKR',
    status: customer?.status ?? 'PROSPECT',
    notes: customer?.notes ?? '',
  });
  const m = useMutation({
    mutationFn: () => (customer ? patch<R>(`/crm/customers/${customer.id}`, f) : post<R>('/crm/customers', f)),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ['crm'] });
      onClose();
      if (!customer) nav(`/crm/customers/${c.id}`);
    },
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={customer ? `Edit ${customer.name}` : 'Add customer'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!f.name} loading={m.isPending} onClick={() => m.mutate()}>
            Save customer
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Company name">
          <Input value={f.name} onChange={set('name')} />
        </Field>
        <Field label="Industry">
          <Input value={f.industry} onChange={set('industry')} />
        </Field>
        <Field label="Email">
          <Input type="email" value={f.email} onChange={set('email')} />
        </Field>
        <Field label="Phone">
          <Input value={f.phone} onChange={set('phone')} />
        </Field>
        <Field label="Website">
          <Input value={f.website} onChange={set('website')} />
        </Field>
        <Field label="Country">
          <Input value={f.country} onChange={set('country')} />
        </Field>
        <Field label="TIN">
          <Input value={f.tin} onChange={set('tin')} />
        </Field>
        <Field label="VAT number">
          <Input value={f.vatNumber} onChange={set('vatNumber')} />
        </Field>
        <Field label="Billing currency">
          <Select value={f.currency} onChange={set('currency')} options={CURRENCIES} />
        </Field>
        <Field label="Status">
          <Select value={f.status} onChange={set('status')} options={['PROSPECT', 'ACTIVE', 'INACTIVE'].map((s) => ({ value: s, label: s.charAt(0) + s.slice(1).toLowerCase() }))} />
        </Field>
      </div>
      <Field label="Billing address">
        <Textarea rows={2} value={f.address} onChange={set('address')} />
      </Field>
      <Field label="Notes">
        <Textarea rows={2} value={f.notes} onChange={set('notes')} />
      </Field>
      <ErrorNote error={m.error} />
    </Modal>
  );
}
