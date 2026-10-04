import { useState, type DragEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Plus } from 'lucide-react';
import { get, post, type Page, type R } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { compactMoney, date, money } from '@/lib/format';
import { Button, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Stat, StatStrip, Textarea } from '@/components/ui';
import { CURRENCIES } from './shared';

export default function PipelinePage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [lost, setLost] = useState<{ id: string; stageId: string } | null>(null);
  const [reason, setReason] = useState('');
  const [adding, setAdding] = useState(false);
  const stages = useQuery({ queryKey: ['crm', 'stages'], queryFn: () => get<R[]>('/crm/stages') });
  const opps = useQuery({ queryKey: ['crm', 'opportunities'], queryFn: () => get<R[]>('/crm/opportunities') });
  const summary = useQuery({ queryKey: ['crm', 'summary'], queryFn: () => get('/crm/pipeline/summary') });
  const move = useMutation({
    mutationFn: ({ id, stageId, lostReason }: { id: string; stageId: string; lostReason?: string }) => post(`/crm/opportunities/${id}/move`, { stageId, lostReason }),
    onSuccess: () => (qc.invalidateQueries({ queryKey: ['crm'] }), setLost(null), setReason('')),
  });
  const canMove = can('OPPORTUNITY_MANAGE');

  function drop(stage: R, e: DragEvent) {
    e.preventDefault();
    setOver(null);
    const id = e.dataTransfer.getData('text/plain');
    const opp = opps.data?.find((o) => o.id === id);
    if (!opp || opp.stageId === stage.id) return;
    if (stage.isLost) setLost({ id, stageId: stage.id });
    else move.mutate({ id, stageId: stage.id });
  }

  if (stages.isLoading || opps.isLoading) return <Spinner />;
  const s = summary.data;
  return (
    <div className="space-y-5">
      <PageHeader
        title="Pipeline"
        subtitle="Drag a deal to another stage to update it."
        actions={
          canMove && (
            <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>
              New opportunity
            </Button>
          )
        }
      />
      {s && (
        <StatStrip>
          <Stat label="Open pipeline (LKR)" value={compactMoney(s.pipelineValue)} />
          <Stat label="Weighted pipeline" value={compactMoney(s.weightedPipeline)} />
          <Stat label="Win rate" value={`${s.winRate}%`} tone="good" />
          <Stat label="Average won deal" value={compactMoney(s.averageDealSize)} />
        </StatStrip>
      )}
      {s?.missingExchangeRates?.length > 0 && <p className="text-xs text-saffron">Add exchange rates for {s.missingExchangeRates.join(', ')} in Settings to include those deals in the totals.</p>}
      <ErrorNote error={move.error} />
      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-4 sm:mx-0 sm:px-0">
        {(stages.data ?? [])
          .filter((st) => st.isActive)
          .map((st) => {
            const items = (opps.data ?? []).filter((o) => o.stageId === st.id);
            const total = items.reduce((a, o) => a + (o.currency === 'LKR' ? Number(o.expectedValue) : 0), 0);
            return (
              <section
                key={st.id}
                onDragOver={(e) => (canMove ? (e.preventDefault(), setOver(st.id)) : undefined)}
                onDragLeave={() => setOver((o) => (o === st.id ? null : o))}
                onDrop={(e) => drop(st, e)}
                className={clsx(
                  'flex w-72 shrink-0 flex-col rounded-panel border bg-white dark:bg-ink-900/60',
                  over === st.id ? 'border-brand ring-2 ring-brand/20' : 'border-ink-100 dark:border-ink-700',
                  (st.isWon || st.isLost) && 'w-60',
                )}
                aria-label={st.name}
              >
                <header className={clsx('border-b border-ink-50 px-3 py-2 dark:border-ink-700', st.isWon && 'border-t-4 border-t-leaf', st.isLost && 'border-t-4 border-t-rose')}>
                  <div className="flex items-baseline justify-between">
                    <h2 className="text-sm font-semibold">{st.name}</h2>
                    <span className="text-xs text-ink-500">{st.probability}%</span>
                  </div>
                  <div className="text-xs text-ink-500">
                    {items.length} · {compactMoney(total)}
                  </div>
                </header>
                <ul className="flex min-h-[6rem] flex-1 flex-col gap-2 p-2">
                  {items.map((o) => (
                    <li
                      key={o.id}
                      draggable={canMove}
                      onDragStart={(e) => (e.dataTransfer.setData('text/plain', o.id), setDragging(o.id))}
                      onDragEnd={() => setDragging(null)}
                      className={clsx('rounded-ctl border border-ink-100 bg-paper p-2.5 text-sm dark:border-ink-700 dark:bg-ink-900', canMove && 'cursor-grab', dragging === o.id && 'opacity-50')}
                    >
                      <Link to={`/crm/opportunities/${o.id}`} className="font-medium hover:text-brand">
                        {o.title}
                      </Link>
                      <div className="text-xs text-ink-500">{o.customer.name}</div>
                      <div className="mt-1 flex items-center justify-between text-xs">
                        <span className="font-medium tabular-nums">{money(o.expectedValue, o.currency)}</span>
                        {o.expectedCloseDate && <span className="text-ink-500">{date(o.expectedCloseDate)}</span>}
                      </div>
                      {/* Keyboard / touch alternative to drag and drop */}
                      {canMove && (
                        <select
                          aria-label={`Move ${o.title}`}
                          className="mt-2 w-full rounded border border-ink-100 bg-transparent px-1 py-0.5 text-xs text-ink-500 dark:border-ink-700"
                          value={o.stageId}
                          onChange={(e) => {
                            const target = stages.data!.find((x) => x.id === e.target.value)!;
                            if (target.isLost) setLost({ id: o.id, stageId: target.id });
                            else move.mutate({ id: o.id, stageId: target.id });
                          }}
                        >
                          {stages.data!.map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
      </div>
      {lost && (
        <Modal
          open
          onClose={() => setLost(null)}
          title="Mark as lost"
          footer={
            <>
              <Button onClick={() => setLost(null)}>Cancel</Button>
              <Button variant="danger" disabled={reason.length < 3} loading={move.isPending} onClick={() => move.mutate({ ...lost, lostReason: reason })}>
                Mark as lost
              </Button>
            </>
          }
        >
          <Field label="Why was it lost?" hint="Used in win/loss reporting.">
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Chose a cheaper vendor" />
          </Field>
        </Modal>
      )}
      {adding && <NewOpportunity onClose={() => setAdding(false)} />}
    </div>
  );
}

function NewOpportunity({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const customers = useQuery({ queryKey: ['crm', 'customers', 'all'], queryFn: () => get<Page<R>>('/crm/customers?pageSize=200') });
  const [f, setF] = useState({ title: '', customerId: '', service: '', expectedValue: '', currency: 'LKR', expectedCloseDate: '' });
  const m = useMutation({
    mutationFn: () => post<R>('/crm/opportunities', { ...f, expectedValue: Number(f.expectedValue || 0), expectedCloseDate: f.expectedCloseDate || null, service: f.service || null }),
    onSuccess: (o) => (qc.invalidateQueries({ queryKey: ['crm'] }), nav(`/crm/opportunities/${o.id}`)),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="New opportunity"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!f.title || !f.customerId} loading={m.isPending} onClick={() => m.mutate()}>
            Create
          </Button>
        </>
      }
    >
      <Field label="Customer" hint={customers.data?.items.length === 0 ? 'Add a customer first.' : undefined}>
        <Select value={f.customerId} onChange={(e) => setF({ ...f, customerId: e.target.value })} placeholder="Choose…" options={(customers.data?.items ?? []).map((c) => ({ value: c.id, label: c.name }))} />
      </Field>
      <Field label="Title">
        <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
      </Field>
      <Field label="Service">
        <Input value={f.service} onChange={(e) => setF({ ...f, service: e.target.value })} />
      </Field>
      <div className="grid grid-cols-[1fr_6rem_10rem] gap-2">
        <Field label="Expected value">
          <Input type="number" min={0} value={f.expectedValue} onChange={(e) => setF({ ...f, expectedValue: e.target.value })} />
        </Field>
        <Field label="Currency">
          <Select value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })} options={CURRENCIES} />
        </Field>
        <Field label="Expected close">
          <Input type="date" value={f.expectedCloseDate} onChange={(e) => setF({ ...f, expectedCloseDate: e.target.value })} />
        </Field>
      </div>
      <ErrorNote error={m.error} />
    </Modal>
  );
}
