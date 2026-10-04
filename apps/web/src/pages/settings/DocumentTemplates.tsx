import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileDown } from 'lucide-react';
import { get, openDocument, patch, post, type R } from '@/lib/api';
import { Button, Checkbox, ErrorNote, Field, Input, Panel, Select, Spinner, Tabs, Textarea } from '@/components/ui';

const TYPE_LABEL: Record<string, string> = { INVOICE: 'Tax invoice', PROFORMA_INVOICE: 'Proforma invoice', QUOTATION: 'Quotation', PAYSLIP: 'Payslip' };

export function DocumentTemplates() {
  const q = useQuery({ queryKey: ['templates', 'documents'], queryFn: () => get<R[]>('/templates/documents') });
  const [selected, setSelected] = useState<string | null>(null);
  if (q.isLoading) return <Spinner />;
  const tpl = q.data?.find((t) => t.id === selected) ?? q.data?.[0];
  return (
    <div className="space-y-4">
      <Tabs tabs={(q.data ?? []).map((t) => ({ value: t.id, label: TYPE_LABEL[t.type] ?? t.name }))} value={tpl?.id ?? ''} onChange={setSelected} />
      {tpl && <Editor key={tpl.id} tpl={tpl} />}
    </div>
  );
}

function Editor({ tpl }: { tpl: R }) {
  const qc = useQueryClient();
  const [options, setOptions] = useState<R>(tpl.options ?? {});
  const [html, setHtml] = useState(tpl.html);
  const [css, setCss] = useState(tpl.css);
  const [mode, setMode] = useState<'layout' | 'code'>('layout');
  const [preview, setPreview] = useState('');
  const [previewError, setPreviewError] = useState<unknown>(null);
  const [lang, setLang] = useState('en');
  const isPayslip = tpl.type === 'PAYSLIP';
  const dirty = JSON.stringify(options) !== JSON.stringify(tpl.options) || html !== tpl.html || css !== tpl.css;

  useEffect(() => {
    const t = setTimeout(() => {
      post<string>(`/templates/documents/${tpl.id}/preview`, { html, css, options, language: lang })
        .then((h) => (setPreview(h), setPreviewError(null)))
        .catch(setPreviewError);
    }, 400);
    return () => clearTimeout(t);
  }, [html, css, options, lang, tpl.id]);

  const save = useMutation({ mutationFn: () => patch(`/templates/documents/${tpl.id}`, { html, css, options }), onSuccess: () => qc.invalidateQueries({ queryKey: ['templates', 'documents'] }) });
  const reset = useMutation({
    mutationFn: () => post<R>(`/templates/documents/${tpl.id}/reset`),
    onSuccess: (r) => (setHtml(r.html), setCss(r.css), setOptions(r.options), qc.invalidateQueries({ queryKey: ['templates', 'documents'] })),
  });
  const opt = (k: string) => (e: { target: { value: string } }) => setOptions({ ...options, [k]: e.target.value });
  const flag = (k: string) => (e: { target: { checked: boolean } }) => setOptions({ ...options, [k]: e.target.checked });

  return (
    <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <Panel
        title={`${tpl.name} · version ${tpl.version}`}
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" icon={<FileDown className="h-3.5 w-3.5" />} onClick={() => openDocument(`/templates/documents/${tpl.id}/sample`)}>
              Sample PDF
            </Button>
            <Button size="sm" variant="ghost" loading={reset.isPending} onClick={() => confirm('Restore the built-in layout?') && reset.mutate()}>
              Restore default
            </Button>
            <Button size="sm" variant="primary" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>
              Save format
            </Button>
          </div>
        }
      >
        <Tabs
          tabs={[
            { value: 'layout', label: 'Layout options' },
            { value: 'code', label: 'HTML & CSS' },
          ]}
          value={mode}
          onChange={setMode}
        />
        {mode === 'layout' ? (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              {!isPayslip && (
                <Field label="Document title">
                  <Input value={options.title ?? ''} onChange={opt('title')} />
                </Field>
              )}
              <Field label="Paper size">
                <Select value={options.paperSize ?? 'A4'} onChange={opt('paperSize')} options={['A4', 'Letter', 'A5'].map((x) => ({ value: x, label: x }))} />
              </Field>
              <Field label="Heading colour" hint="Leave empty to use the company primary colour">
                <div className="flex items-center gap-2">
                  <input type="color" value={options.primaryColor || '#1F4FD8'} onChange={opt('primaryColor')} className="h-9 w-12 rounded border border-ink-100" aria-label="Heading colour" />
                  <Input value={options.primaryColor ?? ''} onChange={opt('primaryColor')} placeholder="Company colour" className="font-mono" />
                </div>
              </Field>
            </div>
            <div className="flex flex-wrap gap-5">
              <Checkbox label="Show logo" checked={options.showLogo !== false} onChange={flag('showLogo')} />
              {!isPayslip && <Checkbox label="Tax column on lines" checked={!!options.showTaxColumn} onChange={flag('showTaxColumn')} />}
              {isPayslip && <Checkbox label="Show employer EPF/ETF contributions" checked={!!options.showEmployerContributions} onChange={flag('showEmployerContributions')} />}
            </div>
            {!isPayslip && (
              <>
                <Field label="Payment terms">
                  <Input value={options.paymentTerms ?? ''} onChange={opt('paymentTerms')} />
                </Field>
                <Field label="Bank details" hint="Printed so customers know where to pay">
                  <Textarea rows={3} value={options.bankDetails ?? ''} onChange={opt('bankDetails')} placeholder={'Bank: Commercial Bank of Ceylon\nAccount name: Intellect Choice\nAccount no: …  Branch: …  SWIFT: …'} />
                </Field>
                <Field label="Terms and conditions">
                  <Textarea rows={3} value={options.terms ?? ''} onChange={opt('terms')} />
                </Field>
              </>
            )}
            <Field label="Footer text">
              <Input value={options.footerText ?? ''} onChange={opt('footerText')} />
            </Field>
            <p className="text-xs text-ink-500">Logo, colours and company details come from Settings → Company & branding. Numbering comes from Settings → Document numbering.</p>
          </div>
        ) : (
          <div className="space-y-3">
            <Field label="HTML (Handlebars)" hint="Fields like {{customer.name}}, {{#each lines}}…{{/each}}, helpers money, date, percent.">
              <Textarea rows={18} value={html} onChange={(e) => setHtml(e.target.value)} className="font-mono text-xs" spellCheck={false} />
            </Field>
            <Field label="CSS">
              <Textarea rows={10} value={css} onChange={(e) => setCss(e.target.value)} className="font-mono text-xs" spellCheck={false} />
            </Field>
          </div>
        )}
        <div className="mt-3">
          <ErrorNote error={save.error} />
        </div>
      </Panel>
      <Panel
        title="Preview with sample data"
        padded={false}
        actions={
          isPayslip && (
            <Select aria-label="Preview language" value={lang} onChange={(e) => setLang(e.target.value)} options={[{ value: 'en', label: 'English' }, { value: 'si', label: 'සිංහල' }, { value: 'ta', label: 'தமிழ்' }]} className="!w-32 !py-1" />
          )
        }
      >
        <div className="p-2">
          <ErrorNote error={previewError} />
          {preview && <iframe title="Document preview" sandbox="" srcDoc={preview} className="h-[860px] w-full rounded-ctl border border-ink-50 bg-white dark:border-ink-700" />}
        </div>
      </Panel>
    </div>
  );
}
