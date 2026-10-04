import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft, Ban, Pencil } from 'lucide-react';
import { get, patch, post, type Page, type R } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { dateTime, money } from '@/lib/format';
import { Button, Checkbox, Details, ErrorNote, Field, Input, Modal, PageHeader, Panel, Select, Spinner, StatusBadge } from '@/components/ui';
import { LeadModal } from './Leads';
import { Activities } from './shared';

export default function LeadDetailPage() {
  const { id } = useParams() as { id: string };
  const { can } = useAuth();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [editing, setEditing] = useState(false);
  const [converting, setConverting] = useState(false);
  const q = useQuery({ queryKey: ['crm', 'lead', id], queryFn: () => get(`/crm/leads/${id}`) });
  const disqualify = useMutation({ mutationFn: () => patch(`/crm/leads/${id}`, { status: 'DISQUALIFIED' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['crm'] }) });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} />;
  const l = q.data!;
  const open = !['CONVERTED', 'DISQUALIFIED'].includes(l.status);
  const manage = can('LEAD_MANAGE');
  return (
    <div className="space-y-6">
      <PageHeader
        title={l.name}
        subtitle={
          <span className="flex items-center gap-2">
            {l.number}
            {l.companyName && ` · ${l.companyName}`} <StatusBadge status={l.status} />
          </span>
        }
        actions={
          manage &&
          open && (
            <>
              <Button icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>
                Edit
              </Button>
              <Button variant="ghost" icon={<Ban className="h-4 w-4" />} loading={disqualify.isPending} onClick={() => confirm('Mark this lead as disqualified?') && disqualify.mutate()}>
                Disqualify
              </Button>
              <Button variant="primary" icon={<ArrowRightLeft className="h-4 w-4" />} onClick={() => setConverting(true)}>
                Convert to customer
              </Button>
            </>
          )
        }
      />
      {l.status === 'CONVERTED' && (
        <p className="rounded-ctl border border-leaf/30 bg-leaf/5 px-3 py-2 text-sm">
          Converted {dateTime(l.convertedAt)}.{' '}
          {l.convertedCustomerId && (
            <Link className="text-brand" to={`/crm/customers/${l.convertedCustomerId}`}>
              Open customer
            </Link>
          )}
          {l.convertedOpportunityId && (
            <>
              {' · '}
              <Link className="text-brand" to={`/crm/opportunities/${l.convertedOpportunityId}`}>
                Open opportunity
              </Link>
            </>
          )}
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Panel title="Details">
          <Details
            items={[
              ['Email', l.email],
              ['Phone', l.phone],
              ['Country', l.country],
              ['Source', l.source?.name],
              ['Campaign', l.campaign],
              ['Interested in', l.serviceInterest],
              ['Estimated value', l.estimatedValue ? money(l.estimatedValue, l.currency) : null],
              ['Probability', `${l.probability}%`],
              ['Next follow-up', l.nextFollowUpAt ? dateTime(l.nextFollowUpAt) : null],
              ['Marketing consent', l.marketingConsent ? `Yes, recorded ${dateTime(l.consentRecordedAt)}` : 'No'],
              ['Notes', l.notes],
            ]}
          />
        </Panel>
        <Panel title="Activity">
          <Activities link={{ leadId: id }} canEdit={manage} />
        </Panel>
      </div>
      {editing && <LeadModal lead={l} onClose={() => setEditing(false)} />}
      {converting && <ConvertModal lead={l} onClose={() => setConverting(false)} onDone={(r) => nav(r.opportunityId ? `/crm/opportunities/${r.opportunityId}` : `/crm/customers/${r.customerId}`)} />}
    </div>
  );
}

function ConvertModal({ lead, onClose, onDone }: { lead: R; onClose: () => void; onDone: (r: R) => void }) {
  const qc = useQueryClient();
  const [existing, setExisting] = useState(false);
  const [customerId, setCustomerId] = useState('');
  const [createOpportunity, setCreate] = useState(true);
  const [title, setTitle] = useState(`${lead.serviceInterest || 'Opportunity'} – ${lead.companyName || lead.name}`);
  const [expectedCloseDate, setClose] = useState('');
  const customers = useQuery({ queryKey: ['crm', 'customers', 'all'], queryFn: () => get<Page<R>>('/crm/customers?pageSize=200'), enabled: existing });
  const m = useMutation({
    mutationFn: () => post<R>(`/crm/leads/${lead.id}/convert`, { customerId: existing ? customerId : undefined, createOpportunity, opportunityTitle: title, expectedCloseDate: expectedCloseDate || undefined }),
    onSuccess: (r) => (qc.invalidateQueries({ queryKey: ['crm'] }), onDone(r)),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Convert lead"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={m.isPending} disabled={existing && !customerId} onClick={() => m.mutate()}>
            Convert
          </Button>
        </>
      }
    >
      <p className="text-sm text-ink-500">Creates a contact for {lead.name} and, optionally, an opportunity in the first pipeline stage.</p>
      <Checkbox label="Add to an existing customer" checked={existing} onChange={(e) => setExisting(e.target.checked)} />
      {existing ? (
        <Field label="Customer">
          <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)} placeholder="Choose…" options={(customers.data?.items ?? []).map((c) => ({ value: c.id, label: `${c.name} (${c.code})` }))} />
        </Field>
      ) : (
        <p className="text-sm">
          New customer: <strong>{lead.companyName || lead.name}</strong>
        </p>
      )}
      <Checkbox label="Create an opportunity" checked={createOpportunity} onChange={(e) => setCreate(e.target.checked)} />
      {createOpportunity && (
        <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
          <Field label="Opportunity title">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Expected close">
            <Input type="date" value={expectedCloseDate} onChange={(e) => setClose(e.target.value)} />
          </Field>
        </div>
      )}
      <ErrorNote error={m.error} />
    </Modal>
  );
}
