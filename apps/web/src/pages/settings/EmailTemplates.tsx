import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { get, patch, post, type R } from '@/lib/api';
import { Button, Checkbox, ErrorNote, Field, Input, Panel, Select, Spinner, Textarea } from '@/components/ui';

const VARIABLES: Record<string, string[]> = {
  LAYOUT: ['{{company.name}}', '{{company.logoUrl}}', '{{company.primaryColor}}', '{{company.emailFooter}}', '{{company.address}}', '{{{content}}}'],
  WELCOME_USER: ['{{user.displayName}}', '{{user.email}}', '{{appUrl}}'],
  LEAVE_REQUESTED: ['{{approver.name}}', '{{employee.name}}', '{{leave.type}}', '{{leave.days}}', '{{date leave.startDate}}', '{{date leave.endDate}}', '{{leave.reason}}'],
  LEAVE_APPROVED: ['{{employee.name}}', '{{leave.type}}', '{{leave.days}}', '{{date leave.startDate}}', '{{date leave.endDate}}', '{{comment}}'],
  LEAVE_REJECTED: ['{{employee.name}}', '{{leave.type}}', '{{date leave.startDate}}', '{{date leave.endDate}}', '{{comment}}'],
  PAYSLIP_PUBLISHED: ['{{employee.name}}', '{{period}}', '{{money netPay currency}}'],
  CONTRACT_ENDING: ['{{employee.name}}', '{{employee.employeeNo}}', '{{date contract.endDate}}', '{{daysLeft}}'],
  MISSING_CHECKOUT: ['{{employee.name}}', '{{date workDate}}'],
  LEAD_ASSIGNED: ['{{owner.name}}', '{{lead.number}}', '{{lead.name}}', '{{lead.companyName}}', '{{lead.serviceInterest}}'],
  FOLLOW_UP_REMINDER: ['{{owner.name}}', '{{lead.number}}', '{{lead.name}}'],
  PROFORMA_INVOICE: ['{{customer.contactName}}', '{{doc.title}}', '{{doc.number}}', '{{money totals.total doc.currency}}', '{{message}}', '{{sender.name}}'],
};
const LANG: Record<string, string> = { en: 'English', si: 'සිංහල', ta: 'தமிழ்' };
const KEYS = Object.keys(VARIABLES);

export function EmailTemplates() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['templates', 'email'], queryFn: () => get<R[]>('/templates/email') });
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState<{ key: string; language: string } | null>(null);
  const tpl = q.data?.find((t) => t.id === selected) ?? q.data?.[0];
  const create = useMutation({
    mutationFn: () => {
      const base = q.data!.find((t) => t.key === creating!.key && t.language === 'en')!;
      return post<R>('/templates/email', { key: creating!.key, language: creating!.language, name: `${base.name} (${LANG[creating!.language]})`, subject: base.subject, bodyHtml: base.bodyHtml });
    },
    onSuccess: (r) => (qc.invalidateQueries({ queryKey: ['templates', 'email'] }), setSelected(r.id), setCreating(null)),
  });
  if (q.isLoading) return <Spinner />;
  const grouped = KEYS.map((k) => ({ key: k, items: (q.data ?? []).filter((t) => t.key === k) })).filter((g) => g.items.length);
  return (
    <div className="grid gap-6 xl:grid-cols-[15rem_minmax(0,1fr)]">
      <div className="space-y-3">
        <ul className="panel divide-y divide-ink-50 text-sm dark:divide-ink-700">
          {grouped.map((g) => (
            <li key={g.key} className="px-3 py-2">
              <div className="font-medium">{g.items.find((x) => x.language === 'en')?.name ?? g.key}</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {g.items.map((t) => (
                  <button key={t.id} onClick={() => setSelected(t.id)} className={clsx('rounded px-1.5 py-0.5 text-xs', tpl?.id === t.id ? 'bg-brand text-white' : 'bg-ink-50 text-ink-500 dark:bg-ink-700 dark:text-ink-100')}>
                    {LANG[t.language]}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
        <Panel title="Add a translation">
          <div className="space-y-2">
            <Select aria-label="Template" value={creating?.key ?? ''} onChange={(e) => setCreating({ key: e.target.value, language: creating?.language ?? 'si' })} placeholder="Template…" options={grouped.map((g) => ({ value: g.key, label: g.items[0].name }))} />
            <Select aria-label="Language" value={creating?.language ?? 'si'} onChange={(e) => setCreating({ key: creating?.key ?? '', language: e.target.value })} options={[{ value: 'si', label: 'සිංහල' }, { value: 'ta', label: 'தமிழ்' }]} />
            <Button size="sm" disabled={!creating?.key || q.data?.some((t) => t.key === creating.key && t.language === creating.language)} loading={create.isPending} onClick={() => create.mutate()}>
              Create from English
            </Button>
            <ErrorNote error={create.error} />
          </div>
        </Panel>
      </div>
      {tpl && <Editor key={tpl.id} tpl={tpl} />}
    </div>
  );
}

function Editor({ tpl }: { tpl: R }) {
  const qc = useQueryClient();
  const [subject, setSubject] = useState(tpl.subject);
  const [body, setBody] = useState(tpl.bodyHtml);
  const [active, setActive] = useState(tpl.isActive);
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const [previewError, setPreviewError] = useState<unknown>(null);
  const dirty = subject !== tpl.subject || body !== tpl.bodyHtml || active !== tpl.isActive;

  // Live preview, debounced.
  useEffect(() => {
    const t = setTimeout(() => {
      post<{ subject: string; html: string }>(`/templates/email/${tpl.id}/preview`, { subject, bodyHtml: body })
        .then((p) => (setPreview(p), setPreviewError(null)))
        .catch(setPreviewError);
    }, 400);
    return () => clearTimeout(t);
  }, [subject, body, tpl.id]);

  const save = useMutation({ mutationFn: () => patch(`/templates/email/${tpl.id}`, { subject, bodyHtml: body, isActive: active }), onSuccess: () => qc.invalidateQueries({ queryKey: ['templates', 'email'] }) });
  const reset = useMutation({
    mutationFn: () => post<R>(`/templates/email/${tpl.id}/reset`),
    onSuccess: (r) => (setSubject(r.subject), setBody(r.bodyHtml), qc.invalidateQueries({ queryKey: ['templates', 'email'] })),
  });
  const vars = useMemo(() => VARIABLES[tpl.key] ?? [], [tpl.key]);

  return (
    <div className="grid gap-6 2xl:grid-cols-2">
      <Panel
        title={`${tpl.name} · ${LANG[tpl.language]}`}
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" loading={reset.isPending} onClick={() => confirm('Restore the built-in version of this template?') && reset.mutate()}>
              Restore default
            </Button>
            <Button size="sm" variant="primary" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>
              Save template
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          {tpl.key !== 'LAYOUT' && (
            <Field label="Subject">
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
            </Field>
          )}
          <Field label={tpl.key === 'LAYOUT' ? 'Layout HTML (header, logo, footer for every email)' : 'Message (HTML)'}>
            <Textarea rows={tpl.key === 'LAYOUT' ? 22 : 12} value={body} onChange={(e) => setBody(e.target.value)} className="font-mono text-xs" spellCheck={false} />
          </Field>
          <div>
            <div className="mb-1 text-xs font-medium text-ink-500">Insert a field</div>
            <div className="flex flex-wrap gap-1">
              {vars.map((v) => (
                <button key={v} type="button" className="rounded bg-ink-50 px-1.5 py-0.5 font-mono text-xs hover:bg-brand/10 dark:bg-ink-700" onClick={() => setBody(body + v)}>
                  {v}
                </button>
              ))}
            </div>
          </div>
          <Checkbox label="Send this email" checked={active} onChange={(e) => setActive(e.target.checked)} />
          <ErrorNote error={save.error} />
        </div>
      </Panel>
      <Panel title="Preview with sample data" padded={false}>
        {preview && tpl.key !== 'LAYOUT' && (
          <div className="border-b border-ink-50 px-4 py-2 text-sm dark:border-ink-700">
            <span className="text-ink-500">Subject: </span>
            {preview.subject}
          </div>
        )}
        <div className="p-2">
          <ErrorNote error={previewError} />
          {preview && <iframe title="Email preview" sandbox="" srcDoc={preview.html} className="h-[640px] w-full rounded-ctl border border-ink-50 bg-white dark:border-ink-700" />}
        </div>
      </Panel>
    </div>
  );
}
