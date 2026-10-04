import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Plus, Send, Trash2 } from 'lucide-react';
import { get, openDocument, patch, post, type R } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { date, money } from '@/lib/format';
import { Button, Details, ErrorNote, Field, Input, Modal, PageHeader, Panel, Select, Spinner, StatusBadge, Textarea } from '@/components/ui';
import { Activities } from './shared';

interface Line {
  description: string;
  quantity: number;
  unitPrice: number;
  taxCode: string | null;
}

export default function OpportunityPage() {
  const { id } = useParams() as { id: string };
  const { can } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['crm', 'opportunity', id], queryFn: () => get(`/crm/opportunities/${id}`) });
  const taxCodes = useQuery({ queryKey: ['tax-codes'], queryFn: () => get<R[]>('/tax-codes') });
  const [lines, setLines] = useState<Line[]>([]);
  const [dirty, setDirty] = useState(false);
  const [sending, setSending] = useState<null | 'QUOTATION' | 'PROFORMA_INVOICE'>(null);
  const [docError, setDocError] = useState<unknown>(null);
  useEffect(() => {
    if (q.data) {
      setLines((q.data.lineItems as Line[]) ?? []);
      setDirty(false);
    }
  }, [q.data]);
  const save = useMutation({
    mutationFn: () => patch(`/crm/opportunities/${id}`, { lineItems: lines, expectedValue: lines.reduce((a, l) => a + l.quantity * l.unitPrice, 0) || Number(q.data?.expectedValue ?? 0) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['crm'] }),
  });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorNote error={q.error} />;
  const o = q.data!;
  const manage = can('OPPORTUNITY_MANAGE');
  const codes = Array.from(new Set((taxCodes.data ?? []).filter((t) => t.isActive).map((t) => t.code)));
  const update = (i: number, p: Partial<Line>) => {
    setLines(lines.map((l, j) => (j === i ? { ...l, ...p } : l)));
    setDirty(true);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={o.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {o.number} ·{' '}
            <Link to={`/crm/customers/${o.customer.id}`} className="text-brand">
              {o.customer.name}
            </Link>{' '}
            · {o.stage.name} <StatusBadge status={o.status} />
          </span>
        }
        actions={
          can('INVOICE_PRINT') && (
            <>
              <Button icon={<FileText className="h-4 w-4" />} onClick={() => openDocument(`/crm/opportunities/${id}/document?type=QUOTATION`).catch(setDocError)}>
                Preview quotation
              </Button>
              <Button icon={<FileText className="h-4 w-4" />} onClick={() => openDocument(`/crm/opportunities/${id}/document?type=PROFORMA_INVOICE`).catch(setDocError)}>
                Preview proforma
              </Button>
              <Button variant="primary" icon={<Send className="h-4 w-4" />} onClick={() => setSending('QUOTATION')}>
                Send to customer
              </Button>
            </>
          )
        }
      />
      <ErrorNote error={docError} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Panel
          title="Line items"
          padded={false}
          actions={
            manage && (
              <div className="flex gap-2">
                <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => (setLines([...lines, { description: '', quantity: 1, unitPrice: 0, taxCode: codes.includes('VAT') ? 'VAT' : null }]), setDirty(true))}>
                  Add line
                </Button>
                {dirty && (
                  <Button size="sm" variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
                    Save lines
                  </Button>
                )}
              </div>
            )
          }
        >
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Description</th>
                  <th className="num w-20">Qty</th>
                  <th className="num w-32">Unit price</th>
                  <th className="w-24">Tax</th>
                  <th className="num">Amount</th>
                  {manage && <th />}
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td>{manage ? <Input value={l.description} onChange={(e) => update(i, { description: e.target.value })} aria-label="Description" /> : l.description}</td>
                    <td className="num">{manage ? <Input type="number" min={0} value={l.quantity} onChange={(e) => update(i, { quantity: Number(e.target.value) })} className="text-right" aria-label="Quantity" /> : l.quantity}</td>
                    <td className="num">{manage ? <Input type="number" min={0} value={l.unitPrice} onChange={(e) => update(i, { unitPrice: Number(e.target.value) })} className="text-right" aria-label="Unit price" /> : money(l.unitPrice)}</td>
                    <td>{manage ? <Select value={l.taxCode ?? ''} onChange={(e) => update(i, { taxCode: e.target.value || null })} placeholder="None" options={codes.map((c) => ({ value: c, label: c }))} aria-label="Tax" /> : l.taxCode ?? '—'}</td>
                    <td className="num">{money(l.quantity * l.unitPrice)}</td>
                    {manage && (
                      <td>
                        <Button size="sm" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} aria-label="Remove line" onClick={() => (setLines(lines.filter((_, j) => j !== i)), setDirty(true))} />
                      </td>
                    )}
                  </tr>
                ))}
                {!lines.length && (
                  <tr>
                    <td colSpan={6} className="text-ink-500">
                      No line items — documents show a single line for the expected value.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {!dirty && (
            <div className="ml-auto w-full max-w-xs space-y-1 px-4 py-3 text-sm">
              <div className="flex justify-between">
                <span>Subtotal</span>
                <span className="tabular-nums">{money(o.totals.subtotal)}</span>
              </div>
              {o.totals.taxes.map((t: R) => (
                <div key={t.name} className="flex justify-between">
                  <span>
                    {t.name} {+(t.rate * 100).toFixed(2)}%
                  </span>
                  <span className="tabular-nums">{money(t.amount)}</span>
                </div>
              ))}
              <div className="flex justify-between border-t border-ink-100 pt-1 font-semibold dark:border-ink-700">
                <span>Total</span>
                <span className="tabular-nums">{money(o.totals.total, o.currency)}</span>
              </div>
            </div>
          )}
          <div className="px-4 pb-3">
            <ErrorNote error={save.error} />
          </div>
        </Panel>
        <div className="space-y-6">
          <Panel title="Details">
            <Details
              items={[
                ['Expected value', money(o.expectedValue, o.currency)],
                ['Probability', `${o.probability}%`],
                ['Weighted', money((Number(o.expectedValue) * o.probability) / 100, o.currency)],
                ['Expected close', o.expectedCloseDate ? date(o.expectedCloseDate) : null],
                ['Service', o.service],
                ['Lost reason', o.lostReason],
              ]}
            />
          </Panel>
          <Panel title="Activity">
            <Activities link={{ opportunityId: id }} canEdit={manage} />
          </Panel>
        </div>
      </div>
      {sending && <SendModal o={o} type={sending} setType={setSending} onClose={() => setSending(null)} />}
    </div>
  );
}

function SendModal({ o, type, setType, onClose }: { o: R; type: 'QUOTATION' | 'PROFORMA_INVOICE'; setType: (t: 'QUOTATION' | 'PROFORMA_INVOICE') => void; onClose: () => void }) {
  const qc = useQueryClient();
  const contact = o.customer.contacts.find((c: R) => c.id === o.contactId) ?? o.customer.contacts.find((c: R) => c.isPrimary) ?? o.customer.contacts[0];
  const [to, setTo] = useState(contact?.email ?? o.customer.email ?? '');
  const [message, setMessage] = useState('');
  const [validDays, setValid] = useState('30');
  const m = useMutation({ mutationFn: () => post<R>(`/crm/opportunities/${o.id}/send-document`, { type, to, message: message || undefined, validDays: Number(validDays) }), onSuccess: () => qc.invalidateQueries({ queryKey: ['crm', 'activities'] }) });
  return (
    <Modal
      open
      onClose={onClose}
      title="Send to customer"
      footer={
        m.data ? (
          <Button onClick={onClose}>Close</Button>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={!to} loading={m.isPending} onClick={() => m.mutate()}>
              Issue number and send
            </Button>
          </>
        )
      }
    >
      {m.data ? (
        <p className="text-sm">
          {type === 'QUOTATION' ? 'Quotation' : 'Proforma invoice'} <strong>{m.data.number}</strong> is queued for {to}. It is logged in the activity timeline.
        </p>
      ) : (
        <>
          <Field label="Document">
            <Select value={type} onChange={(e) => setType(e.target.value as 'QUOTATION')} options={[{ value: 'QUOTATION', label: 'Quotation' }, { value: 'PROFORMA_INVOICE', label: 'Proforma invoice' }]} />
          </Field>
          <Field label="To">
            <Input type="email" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <Field label={type === 'QUOTATION' ? 'Valid for (days)' : 'Payment due in (days)'}>
            <Input type="number" min={1} value={validDays} onChange={(e) => setValid(e.target.value)} />
          </Field>
          <Field label="Message">
            <Textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
          </Field>
          <p className="text-xs text-ink-500">A number is assigned from the {type === 'QUOTATION' ? 'quotation' : 'proforma'} sequence when you send. Layout and wording come from Settings → Document templates.</p>
        </>
      )}
      <ErrorNote error={m.error} />
    </Modal>
  );
}
