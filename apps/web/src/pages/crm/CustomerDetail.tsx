import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus } from 'lucide-react';
import { get, post, put, type R } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { date, money } from '@/lib/format';
import { Badge, Button, Checkbox, Details, Empty, ErrorNote, Field, Input, Modal, PageHeader, Panel, Spinner, Stat, StatStrip, StatusBadge } from '@/components/ui';
import { CustomerModal } from './Customers';
import { Activities } from './shared';

export default function CustomerDetailPage() {
  const { id } = useParams() as { id: string };
  const { can } = useAuth();
  const [editing, setEditing] = useState(false);
  const [contact, setContact] = useState<R | null>(null);
  const q = useQuery({ queryKey: ['crm', 'customer', id], queryFn: () => get(`/crm/customers/${id}`) });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} />;
  const c = q.data!;
  const manage = can('CUSTOMER_MANAGE');
  return (
    <div className="space-y-6">
      <PageHeader
        title={c.name}
        subtitle={
          <span className="flex items-center gap-2">
            {c.code} · {c.industry ?? 'No industry'} <StatusBadge status={c.status} />
          </span>
        }
        actions={
          manage && (
            <Button icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>
              Edit
            </Button>
          )
        }
      />
      <StatStrip>
        <Stat label="Open opportunities" value={c.stats.openOpportunities} />
        <Stat label="Open value" value={money(c.stats.openValue, c.currency)} />
        <Stat label="Won deals" value={c.stats.wonCount} tone="good" />
        <Stat label="Won value" value={money(c.stats.wonValue, c.currency)} tone="good" />
      </StatStrip>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="space-y-6">
          <Panel title="Company">
            <Details
              items={[
                ['Email', c.email],
                ['Phone', c.phone],
                ['Website', c.website],
                ['Country', c.country],
                ['Address', c.address],
                ['TIN', c.tin],
                ['VAT number', c.vatNumber],
                ['Billing currency', c.currency],
              ]}
            />
          </Panel>
          <Panel
            title="Contacts"
            padded={false}
            actions={
              manage && (
                <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setContact({})}>
                  Add contact
                </Button>
              )
            }
          >
            {!c.contacts.length ? (
              <Empty title="No contacts." />
            ) : (
              <ul className="divide-y divide-ink-50 dark:divide-ink-700">
                {c.contacts.map((p: R) => (
                  <li key={p.id} className="flex items-start justify-between gap-2 px-4 py-2.5 text-sm">
                    <div>
                      <div className="font-medium">
                        {p.firstName} {p.lastName} {p.isPrimary && <Badge tone="blue">Primary</Badge>}
                      </div>
                      <div className="text-ink-500">{[p.title, p.email, p.phone].filter(Boolean).join(' · ')}</div>
                    </div>
                    {manage && (
                      <Button size="sm" variant="ghost" onClick={() => setContact(p)}>
                        Edit
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
        <div className="space-y-6">
          <Panel title="Opportunities" padded={false}>
            {!c.opportunities.length ? (
              <Empty title="No opportunities." />
            ) : (
              <table className="table-base">
                <thead>
                  <tr>
                    <th>Opportunity</th>
                    <th>Stage</th>
                    <th className="num">Value</th>
                    <th>Close</th>
                  </tr>
                </thead>
                <tbody>
                  {c.opportunities.map((o: R) => (
                    <tr key={o.id}>
                      <td>
                        <Link to={`/crm/opportunities/${o.id}`} className="font-medium hover:text-brand">
                          {o.title}
                        </Link>
                        <div className="text-xs text-ink-500">{o.number}</div>
                      </td>
                      <td>
                        {o.stage.name} {o.status !== 'OPEN' && <StatusBadge status={o.status} />}
                      </td>
                      <td className="num">{money(o.expectedValue, o.currency)}</td>
                      <td>{o.expectedCloseDate ? date(o.expectedCloseDate) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
          <Panel title="Activity">
            <Activities link={{ customerId: id }} canEdit={manage} />
          </Panel>
        </div>
      </div>
      {editing && <CustomerModal customer={c} onClose={() => setEditing(false)} />}
      {contact && <ContactModal customerId={id} contact={contact} onClose={() => setContact(null)} />}
    </div>
  );
}

function ContactModal({ customerId, contact, onClose }: { customerId: string; contact: R; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    firstName: contact.firstName ?? '',
    lastName: contact.lastName ?? '',
    title: contact.title ?? '',
    email: contact.email ?? '',
    phone: contact.phone ?? '',
    isPrimary: contact.isPrimary ?? false,
    marketingConsent: contact.marketingConsent ?? false,
  });
  const m = useMutation({
    mutationFn: () => (contact.id ? put(`/crm/customers/${customerId}/contacts/${contact.id}`, f) : post(`/crm/customers/${customerId}/contacts`, f)),
    onSuccess: () => (qc.invalidateQueries({ queryKey: ['crm', 'customer', customerId] }), onClose()),
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal
      open
      onClose={onClose}
      title={contact.id ? 'Edit contact' : 'Add contact'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!f.firstName} loading={m.isPending} onClick={() => m.mutate()}>
            Save contact
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="First name">
          <Input value={f.firstName} onChange={set('firstName')} />
        </Field>
        <Field label="Last name">
          <Input value={f.lastName} onChange={set('lastName')} />
        </Field>
        <Field label="Job title">
          <Input value={f.title} onChange={set('title')} />
        </Field>
        <Field label="Phone">
          <Input value={f.phone} onChange={set('phone')} />
        </Field>
        <Field label="Email" className="sm:col-span-2">
          <Input type="email" value={f.email} onChange={set('email')} />
        </Field>
      </div>
      <Checkbox label="Primary contact (receives quotations and invoices)" checked={f.isPrimary} onChange={(e) => setF({ ...f, isPrimary: e.target.checked })} />
      <Checkbox label="Agreed to receive marketing emails" checked={f.marketingConsent} onChange={(e) => setF({ ...f, marketingConsent: e.target.checked })} />
      <ErrorNote error={m.error} />
    </Modal>
  );
}
