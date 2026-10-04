import { useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import clsx from 'clsx';
import { ChevronLeft, ChevronRight, Loader2, X } from 'lucide-react';
import { ApiError } from '@/lib/api';

// ─── Buttons ───
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
export function Button({
  variant = 'secondary',
  size = 'md',
  loading,
  icon,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean; icon?: ReactNode }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-ctl font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-2 text-sm',
        variant === 'primary' && 'bg-brand text-white hover:bg-brand/90',
        variant === 'secondary' && 'border border-ink-100 bg-white text-ink hover:bg-ink-50 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-50 dark:hover:bg-ink-700',
        variant === 'ghost' && 'text-ink-500 hover:bg-ink-50 hover:text-ink dark:text-ink-300 dark:hover:bg-ink-700',
        variant === 'danger' && 'bg-rose text-white hover:bg-rose/90',
        className,
      )}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

// ─── Form fields ───
export function Field({ label, hint, error, children, className }: { label: string; hint?: string; error?: string; children: ReactNode; className?: string }) {
  return (
    <label className={clsx('block', className)}>
      <span className="mb-1 block text-xs font-medium text-ink-500 dark:text-ink-300">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-ink-300">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-rose">{error}</span>}
    </label>
  );
}

export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={clsx('input', p.className)} />;
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={clsx('input', p.className)} />;
export function Select({ options, placeholder, ...p }: SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string }[]; placeholder?: string }) {
  return (
    <select {...p} className={clsx('input', p.className)}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
export function Checkbox({ label, ...p }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  const id = useId();
  return (
    <label htmlFor={id} className="inline-flex cursor-pointer items-center gap-2 text-sm">
      <input id={id} type="checkbox" {...p} className="h-4 w-4 rounded border-ink-300 text-brand focus:ring-brand/30" />
      {label}
    </label>
  );
}

// ─── Layout ───
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-ink-500 dark:text-ink-300">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({ title, actions, children, className, padded = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={clsx('panel', className)}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-2 border-b border-ink-50 px-4 py-3 dark:border-ink-700">
          <h2 className="text-sm font-semibold">{title}</h2>
          {actions}
        </div>
      )}
      <div className={padded ? 'p-4' : ''}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: 'default' | 'good' | 'warn' | 'bad' }) {
  return (
    <div className="px-4 py-3">
      <div className="text-xs text-ink-500 dark:text-ink-300">{label}</div>
      <div
        className={clsx(
          'mt-1 text-lg font-semibold tabular-nums',
          tone === 'good' && 'text-leaf',
          tone === 'warn' && 'text-saffron',
          tone === 'bad' && 'text-rose',
        )}
      >
        {value}
      </div>
    </div>
  );
}

/** A row of stats separated by hairlines — one panel, not a grid of cards. */
export function StatStrip({ children }: { children: ReactNode }) {
  return <div className="panel grid grid-cols-2 divide-ink-50 sm:grid-cols-4 sm:divide-x dark:divide-ink-700 [&>*]:border-ink-50">{children}</div>;
}

const BADGE: Record<string, string> = {
  green: 'bg-leaf/10 text-leaf',
  amber: 'bg-saffron/15 text-[#9a6510] dark:text-saffron',
  red: 'bg-rose/10 text-rose',
  blue: 'bg-brand/10 text-brand',
  grey: 'bg-ink-50 text-ink-500 dark:bg-ink-700 dark:text-ink-100',
  teal: 'bg-accent/10 text-accent',
};
export function Badge({ tone = 'grey', children }: { tone?: keyof typeof BADGE; children: ReactNode }) {
  return <span className={clsx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', BADGE[tone])}>{children}</span>;
}

const STATUS_TONE: Record<string, keyof typeof BADGE> = {
  ACTIVE: 'green', APPROVED: 'green', PRESENT: 'green', POSTED: 'green', WON: 'green', SENT: 'green', CONVERTED: 'green',
  PENDING: 'amber', CALCULATED: 'amber', LATE: 'amber', QUALIFIED: 'blue', CONTACTED: 'blue', NEW: 'teal', OPEN: 'blue', DRAFT: 'grey', QUEUED: 'grey', REMOTE: 'teal', ON_LEAVE: 'blue', PROSPECT: 'teal',
  REJECTED: 'red', CANCELLED: 'grey', ABSENT: 'red', REVERSED: 'red', LOST: 'red', FAILED: 'red', DISQUALIFIED: 'grey', TERMINATED: 'red', RESIGNED: 'grey', CONTRACT_ENDED: 'grey', ON_NOTICE: 'amber', INCOMPLETE: 'amber', HOLIDAY: 'grey', OFF: 'grey', INACTIVE: 'grey',
};
export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <Badge tone={STATUS_TONE[status] ?? 'grey'}>{label ?? status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, ' ')}</Badge>;
}

// ─── Feedback ───
export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 p-6 text-sm text-ink-500">
      <Loader2 className="h-4 w-4 animate-spin" /> {label ?? 'Loading…'}
    </div>
  );
}

export function Empty({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-10 text-center text-sm text-ink-500">
      <p>{title}</p>
      {action}
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error as ApiError;
  return (
    <div role="alert" className="rounded-ctl border border-rose/30 bg-rose/5 px-3 py-2 text-sm text-rose">
      <p>{e.message || 'Something went wrong.'}</p>
      {e.details && (
        <ul className="mt-1 list-disc pl-5 text-xs">
          {e.details.map((d, i) => (
            <li key={i}>
              {d.path && <strong>{d.path}: </strong>}
              {d.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Overlays ───
export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('input,select,textarea,button')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/40 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={clsx('panel max-h-[92vh] w-full overflow-auto rounded-b-none sm:rounded-panel', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-ink-50 bg-white px-4 py-3 dark:border-ink-700 dark:bg-ink-900">
          <h2 className="font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 text-ink-500 hover:bg-ink-50 dark:hover:bg-ink-700">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-4 p-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-ink-50 px-4 py-3 dark:border-ink-700">{footer}</div>}
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { value: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="tablist" className="mb-4 flex gap-1 overflow-x-auto border-b border-ink-100 dark:border-ink-700">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={clsx(
            '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm',
            value === t.value ? 'border-brand font-medium text-ink dark:text-white' : 'border-transparent text-ink-500 hover:text-ink dark:text-ink-300',
          )}
        >
          {t.label}
          {t.count !== undefined && t.count > 0 && <span className="ml-1.5 rounded-full bg-saffron/20 px-1.5 text-xs">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return <div className="px-3 py-2 text-xs text-ink-500">{total} record{total === 1 ? '' : 's'}</div>;
  return (
    <div className="flex items-center justify-between px-3 py-2 text-xs text-ink-500">
      <span>
        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
      </span>
      <div className="flex gap-1">
        <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page" icon={<ChevronLeft className="h-4 w-4" />} />
        <Button size="sm" variant="ghost" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page" icon={<ChevronRight className="h-4 w-4" />} />
      </div>
    </div>
  );
}

/** A definition list for detail pages. */
export function Details({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs text-ink-500 dark:text-ink-300">{k}</dt>
          <dd className="mt-0.5 text-sm">{v === null || v === undefined || v === '' ? '—' : v}</dd>
        </div>
      ))}
    </dl>
  );
}
