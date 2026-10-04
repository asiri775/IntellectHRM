import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Mail, MessageSquare, Phone, Users, StickyNote } from 'lucide-react';
import { get, post, type R } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { Button, ErrorNote, Field, Input, Select, Textarea } from '@/components/ui';

const ICONS: Record<string, ReactNode> = {
  CALL: <Phone className="h-3.5 w-3.5" />,
  EMAIL: <Mail className="h-3.5 w-3.5" />,
  MEETING: <Users className="h-3.5 w-3.5" />,
  NOTE: <StickyNote className="h-3.5 w-3.5" />,
  TASK: <MessageSquare className="h-3.5 w-3.5" />,
};

/** Activity timeline + quick add, for a lead, customer or opportunity. */
export function Activities({ link, canEdit }: { link: { leadId?: string; customerId?: string; opportunityId?: string }; canEdit: boolean }) {
  const qc = useQueryClient();
  const key = ['crm', 'activities', link];
  const q = useQuery({ queryKey: key, queryFn: () => get<R[]>(`/crm/activities?${new URLSearchParams(link as Record<string, string>)}`) });
  const [form, setForm] = useState({ type: 'NOTE', subject: '', body: '', dueAt: '' });
  const add = useMutation({
    mutationFn: () => post('/crm/activities', { ...link, ...form, body: form.body || null, dueAt: form.dueAt ? new Date(form.dueAt).toISOString() : null }),
    onSuccess: () => (qc.invalidateQueries({ queryKey: ['crm', 'activities'] }), setForm({ type: 'NOTE', subject: '', body: '', dueAt: '' })),
  });
  const done = useMutation({ mutationFn: (id: string) => post(`/crm/activities/${id}/complete`), onSuccess: () => qc.invalidateQueries({ queryKey: ['crm', 'activities'] }) });
  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="space-y-2 rounded-ctl border border-ink-50 p-3 dark:border-ink-700">
          <div className="grid gap-2 sm:grid-cols-[8rem_1fr]">
            <Select aria-label="Activity type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} options={['NOTE', 'CALL', 'EMAIL', 'MEETING', 'TASK'].map((x) => ({ value: x, label: x.charAt(0) + x.slice(1).toLowerCase() }))} />
            <Input aria-label="Subject" placeholder="What happened, or what needs doing?" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
          </div>
          <Textarea aria-label="Details" rows={2} placeholder="Details (optional)" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
          <div className="flex flex-wrap items-end justify-between gap-2">
            {form.type !== 'NOTE' ? (
              <Field label="Due">
                <Input type="datetime-local" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} />
              </Field>
            ) : (
              <span />
            )}
            <Button size="sm" variant="primary" disabled={!form.subject} loading={add.isPending} onClick={() => add.mutate()}>
              Add activity
            </Button>
          </div>
          <ErrorNote error={add.error} />
        </div>
      )}
      <ol className="space-y-3">
        {(q.data ?? []).map((a) => (
          <li key={a.id} className="flex gap-3 text-sm">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink-50 text-ink-500 dark:bg-ink-700">{ICONS[a.type]}</span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className={a.completedAt || a.type === 'NOTE' ? 'font-medium' : 'font-medium text-brand'}>{a.subject}</span>
                <span className="text-xs text-ink-300">{dateTime(a.createdAt)}</span>
              </div>
              {a.body && <p className="whitespace-pre-line text-ink-500">{a.body}</p>}
              {a.dueAt && !a.completedAt && (
                <p className="text-xs text-saffron">
                  Due {dateTime(a.dueAt)}{' '}
                  {canEdit && (
                    <button className="ml-2 inline-flex items-center gap-1 text-brand" onClick={() => done.mutate(a.id)}>
                      <CheckCircle2 className="h-3 w-3" /> Mark done
                    </button>
                  )}
                </p>
              )}
            </div>
          </li>
        ))}
        {q.data?.length === 0 && <li className="text-sm text-ink-500">No activity yet.</li>}
      </ol>
    </div>
  );
}

export const CURRENCIES = ['LKR', 'USD', 'NZD', 'AUD', 'GBP', 'EUR', 'CAD'].map((c) => ({ value: c, label: c }));
