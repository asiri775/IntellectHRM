import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ImageUp, Trash2 } from 'lucide-react';
import { api, del, get, patch, post, type R } from '@/lib/api';
import { Button, Checkbox, ErrorNote, Field, Input, Panel, Select, Spinner, Textarea } from '@/components/ui';

export function BrandingSettings() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['company'], queryFn: () => get('/company') });
  const [f, setF] = useState<R | null>(null);
  const [testTo, setTestTo] = useState('');
  useEffect(() => {
    if (q.data) setF({ ...q.data, settings: q.data.settings ?? {} });
  }, [q.data]);
  const save = useMutation({
    mutationFn: () =>
      patch('/company', {
        name: f!.name,
        legalName: f!.legalName || null,
        address: f!.address || null,
        phone: f!.phone || null,
        email: f!.email || null,
        website: f!.website || null,
        tin: f!.tin || null,
        vatNumber: f!.vatNumber || null,
        timezone: f!.timezone,
        dateFormat: f!.dateFormat,
        fiscalYearStartMonth: Number(f!.fiscalYearStartMonth),
        defaultLanguage: f!.defaultLanguage,
        primaryColor: f!.primaryColor,
        accentColor: f!.accentColor,
        emailFooter: f!.emailFooter || null,
        settings: f!.settings,
      }),
    onSuccess: () => (qc.invalidateQueries({ queryKey: ['company'] }), qc.invalidateQueries({ queryKey: ['branding'] })),
  });
  const upload = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return api('POST', '/company/logo', fd);
    },
    onSuccess: () => (qc.invalidateQueries({ queryKey: ['company'] }), qc.invalidateQueries({ queryKey: ['branding'] })),
  });
  const removeLogo = useMutation({ mutationFn: () => del('/company/logo'), onSuccess: () => (qc.invalidateQueries({ queryKey: ['company'] }), qc.invalidateQueries({ queryKey: ['branding'] })) });
  const test = useMutation({ mutationFn: () => post<R>('/email-test', { to: testTo }) });
  if (!f) return <Spinner />;
  const set = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const att = f.settings.attendance ?? {};

  return (
    <div className="space-y-6">
      <Panel title="Logo">
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex h-24 w-56 items-center justify-center rounded-ctl border border-dashed border-ink-100 bg-paper p-3 dark:border-ink-700 dark:bg-ink-900">
            {q.data?.logoUrl ? <img src={q.data.logoUrl} alt="Company logo" className="max-h-full max-w-full object-contain" /> : <span className="text-sm text-ink-300">No logo yet</span>}
          </div>
          <div className="space-y-2 text-sm">
            <p className="text-ink-500">Shown on the sign-in page, in the menu, in every email, and on payslips, quotations and invoices. PNG, JPG, WebP or SVG, up to 2 MB. A wide logo on a transparent background works best.</p>
            <div className="flex gap-2">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-ctl bg-brand px-3.5 py-2 text-sm font-medium text-white hover:bg-brand/90">
                <ImageUp className="h-4 w-4" /> {upload.isPending ? 'Uploading…' : 'Upload logo'}
                <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="sr-only" onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])} />
              </label>
              {q.data?.logoUrl && (
                <Button variant="ghost" icon={<Trash2 className="h-4 w-4" />} loading={removeLogo.isPending} onClick={() => removeLogo.mutate()}>
                  Remove
                </Button>
              )}
            </div>
            <ErrorNote error={upload.error} />
          </div>
        </div>
      </Panel>

      <Panel title="Colours">
        <div className="flex flex-wrap items-end gap-6">
          {(['primaryColor', 'accentColor'] as const).map((k) => (
            <Field key={k} label={k === 'primaryColor' ? 'Primary (buttons, email header, invoice headings)' : 'Accent (attendance, positive states)'}>
              <div className="flex items-center gap-2">
                <input type="color" value={f[k]} onChange={set(k)} className="h-9 w-12 cursor-pointer rounded border border-ink-100" aria-label={k} />
                <Input value={f[k]} onChange={set(k)} className="!w-28 font-mono" />
              </div>
            </Field>
          ))}
          <div className="flex items-center gap-2 text-sm">
            <span className="rounded-ctl px-3 py-2 text-white" style={{ background: f.primaryColor }}>
              Primary
            </span>
            <span className="rounded-ctl px-3 py-2 text-white" style={{ background: f.accentColor }}>
              Accent
            </span>
          </div>
        </div>
      </Panel>

      <Panel title="Company details (printed on documents)">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Display name">
            <Input value={f.name ?? ''} onChange={set('name')} />
          </Field>
          <Field label="Registered (legal) name">
            <Input value={f.legalName ?? ''} onChange={set('legalName')} placeholder="e.g. Intellect Choice (Pvt) Ltd" />
          </Field>
          <Field label="Address" className="sm:col-span-2">
            <Textarea rows={2} value={f.address ?? ''} onChange={set('address')} />
          </Field>
          <Field label="Phone">
            <Input value={f.phone ?? ''} onChange={set('phone')} />
          </Field>
          <Field label="Email">
            <Input type="email" value={f.email ?? ''} onChange={set('email')} />
          </Field>
          <Field label="Website">
            <Input value={f.website ?? ''} onChange={set('website')} />
          </Field>
          <Field label="TIN">
            <Input value={f.tin ?? ''} onChange={set('tin')} />
          </Field>
          <Field label="VAT registration number">
            <Input value={f.vatNumber ?? ''} onChange={set('vatNumber')} />
          </Field>
          <Field label="Email footer" hint="Shown at the bottom of every email">
            <Input value={f.emailFooter ?? ''} onChange={set('emailFooter')} />
          </Field>
        </div>
      </Panel>

      <Panel title="Regional and policies">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Time zone">
            <Input value={f.timezone} onChange={set('timezone')} />
          </Field>
          <Field label="Date format">
            <Select value={f.dateFormat} onChange={set('dateFormat')} options={['DD/MM/YYYY', 'YYYY-MM-DD', 'MM/DD/YYYY'].map((x) => ({ value: x, label: x }))} />
          </Field>
          <Field label="Fiscal year starts">
            <Select value={String(f.fiscalYearStartMonth)} onChange={set('fiscalYearStartMonth')} options={['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map((m, i) => ({ value: String(i + 1), label: m }))} />
          </Field>
          <Field label="Default language">
            <Select value={f.defaultLanguage} onChange={set('defaultLanguage')} options={[{ value: 'en', label: 'English' }, { value: 'si', label: 'සිංහල' }, { value: 'ta', label: 'தமிழ்' }]} />
          </Field>
        </div>
        <div className="mt-4 space-y-2">
          <Checkbox label="Allow employees to sign in as working remotely" checked={att.allowRemote !== false} onChange={(e) => setF({ ...f, settings: { ...f.settings, attendance: { ...att, allowRemote: e.target.checked } } })} />
          <Checkbox
            label="Record location at sign-in (only enable after informing employees in your privacy notice)"
            checked={att.captureLocation === true}
            onChange={(e) => setF({ ...f, settings: { ...f.settings, attendance: { ...att, captureLocation: e.target.checked } } })}
          />
          <Field label="Contract ending reminders to HR (days before)" className="max-w-xs">
            <Input
              value={(f.settings.contractReminderDays ?? [60, 30, 7]).join(', ')}
              onChange={(e) => setF({ ...f, settings: { ...f.settings, contractReminderDays: e.target.value.split(',').map((x) => Number(x.trim())).filter((x) => x > 0) } })}
            />
          </Field>
        </div>
      </Panel>

      <div className="flex items-center gap-3">
        <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
          Save settings
        </Button>
        {save.isSuccess && <span className="text-sm text-leaf">Saved.</span>}
      </div>
      <ErrorNote error={save.error} />

      <Panel title="Send a test email">
        <div className="flex flex-wrap items-end gap-2">
          <Field label="To" className="min-w-[16rem] flex-1">
            <Input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
          </Field>
          <Button loading={test.isPending} disabled={!testTo} onClick={() => test.mutate()}>
            Send test
          </Button>
        </div>
        {test.data && <p className="mt-2 text-sm text-ink-500">Queued. Mail provider: {test.data.provider === 'log' ? 'log only (set MAIL_PROVIDER=smtp to send real email)' : test.data.provider}. Check the email outbox for the result.</p>}
        <ErrorNote error={test.error} />
      </Panel>
    </div>
  );
}
