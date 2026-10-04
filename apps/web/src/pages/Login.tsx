import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/lib/auth';
import { post } from '@/lib/api';
import { LANGUAGES } from '@/lib/i18n';
import { Button, ErrorNote, Field, Input, Panel } from '@/components/ui';
import { Logo, useBranding } from '@/components/Layout';

export function LoginPage() {
  const { t, i18n } = useTranslation();
  const { login } = useAuth();
  const branding = useBranding();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      nav('/');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_minmax(420px,40%)]">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-ink p-10 text-white lg:flex">
        <div className="rounded bg-white px-3 py-2 self-start">
          <Logo branding={branding} className="text-ink" />
        </div>
        <div className="max-w-md">
          <p className="text-3xl font-semibold leading-tight">Your people, time, pay and customers in one place.</p>
          <p className="mt-3 text-ink-100">Attendance, leave, Sri Lankan payroll and sales pipeline for {branding?.name ?? 'your company'}.</p>
        </div>
        {/* Clock-face motif: the attendance punch is the product's signature element. */}
        <svg aria-hidden viewBox="0 0 400 400" className="pointer-events-none absolute -right-24 -top-24 h-[30rem] w-[30rem] opacity-[0.08]">
          <circle cx="200" cy="200" r="180" fill="none" stroke="white" strokeWidth="14" />
          {Array.from({ length: 12 }).map((_, i) => (
            <line key={i} x1="200" y1="36" x2="200" y2="62" stroke="white" strokeWidth="8" transform={`rotate(${i * 30} 200 200)`} />
          ))}
          <path d="M200 200 V100 M200 200 L270 240" stroke="white" strokeWidth="14" strokeLinecap="round" />
        </svg>
        <p className="text-xs text-ink-300">© {new Date().getFullYear()} {branding?.name}</p>
      </div>

      <div className="flex flex-col items-center justify-center px-4 py-10">
        <div className="mb-8 lg:hidden">
          <Logo branding={branding} />
        </div>
        <form onSubmit={submit} className="w-full max-w-sm space-y-4">
          <h1 className="text-2xl font-semibold">{t('login.title')}</h1>
          <Field label={t('login.email')}>
            <Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label={t('login.password')}>
            <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <ErrorNote error={error} />
          <Button type="submit" variant="primary" className="w-full" loading={busy}>
            {busy ? t('login.signingIn') : t('login.submit')}
          </Button>
          <div className="flex justify-center gap-3 pt-2 text-sm">
            {LANGUAGES.map((l) => (
              <button type="button" key={l.code} onClick={() => i18n.changeLanguage(l.code)} className={i18n.language === l.code ? 'font-semibold text-brand' : 'text-ink-500'}>
                {l.label}
              </button>
            ))}
          </div>
        </form>
      </div>
    </div>
  );
}

export function ChangePasswordPage({ forced }: { forced?: boolean }) {
  const { t } = useTranslation();
  const { reload, logout } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next !== confirm) return setError(new Error('The new passwords do not match.'));
    setBusy(true);
    setError(null);
    try {
      await post('/auth/change-password', { currentPassword: current, newPassword: next });
      setDone(true);
      // Changing the password signs out other sessions; sign in again.
      await logout();
      await reload().catch(() => undefined);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={forced ? 'flex min-h-screen items-center justify-center px-4' : ''}>
      <Panel title={t('common.changePassword')} className="w-full max-w-md">
        {forced && <p className="mb-4 text-sm text-ink-500">Choose a new password before you continue. Use at least 10 characters with letters and numbers.</p>}
        {done ? (
          <p className="text-sm">Password changed. Sign in again with your new password.</p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <Field label="Current password">
              <Input type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
            </Field>
            <Field label="New password" hint="At least 10 characters, with a letter and a number.">
              <Input type="password" autoComplete="new-password" required minLength={10} value={next} onChange={(e) => setNext(e.target.value)} />
            </Field>
            <Field label="Confirm new password">
              <Input type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </Field>
            <ErrorNote error={error} />
            <Button type="submit" variant="primary" loading={busy}>
              {t('common.changePassword')}
            </Button>
          </form>
        )}
      </Panel>
    </div>
  );
}
