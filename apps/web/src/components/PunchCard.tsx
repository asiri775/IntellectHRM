import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { Coffee, LogIn, LogOut } from 'lucide-react';
import { get, post, type R } from '@/lib/api';
import { hours, time } from '@/lib/format';
import { Button, Checkbox, ErrorNote } from './ui';

/**
 * The attendance punch — the one expressive element of the interface.
 * A large round control with a live worked-time ring for the day.
 */
export function PunchCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['attendance', 'today'], queryFn: () => get('/attendance/today'), refetchInterval: 60_000 });
  const [remote, setRemote] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((x) => x + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const act = useMutation({
    mutationFn: (path: string) => post(path, path === '/attendance/sign-in' ? { source: window.innerWidth < 768 ? 'MOBILE' : 'WEB', isRemote: remote } : {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['attendance'] });
    },
  });

  const d = q.data as R | undefined;
  const state: string = d?.state ?? 'NOT_SIGNED_IN';
  const rec = d?.record as R | undefined;
  const tz: string = d?.timezone ?? 'Asia/Colombo';
  const scheduled = d ? scheduleMinutes(d.schedule) : 480;

  // Live minutes since the last server snapshot (display only).
  let worked: number = d?.liveWorkedMinutes ?? 0;
  if (state === 'SIGNED_IN' && d?.serverTime) worked += Math.floor((Date.now() - new Date(d.serverTime).getTime()) / 60000);
  void tick;
  const pct = Math.min(1, worked / Math.max(1, scheduled));
  const R0 = 70;
  const C = 2 * Math.PI * R0;

  const primary =
    state === 'NOT_SIGNED_IN'
      ? { label: t('attendance.signIn'), path: '/attendance/sign-in', icon: <LogIn className="h-6 w-6" /> }
      : state === 'SIGNED_IN' || state === 'ON_BREAK'
        ? { label: t('attendance.signOut'), path: '/attendance/sign-out', icon: <LogOut className="h-6 w-6" /> }
        : null;

  return (
    <section className="panel flex flex-col items-center gap-5 p-6 sm:flex-row sm:items-center sm:gap-8">
      <div className="relative h-44 w-44 shrink-0">
        <svg viewBox="0 0 160 160" className="absolute inset-0 -rotate-90">
          <circle cx="80" cy="80" r={R0} fill="none" className="stroke-ink-50 dark:stroke-ink-700" strokeWidth="10" />
          <circle cx="80" cy="80" r={R0} fill="none" stroke="rgb(var(--accent))" strokeWidth="10" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - pct)} style={{ transition: 'stroke-dashoffset .6s ease' }} />
        </svg>
        <button
          disabled={!primary || act.isPending || state === 'ON_BREAK'}
          onClick={() => primary && act.mutate(primary.path)}
          className={clsx(
            'absolute inset-[18px] flex flex-col items-center justify-center gap-1 rounded-full text-white transition-colors disabled:cursor-default',
            state === 'NOT_SIGNED_IN' && 'bg-brand hover:bg-brand/90',
            state === 'SIGNED_IN' && 'punch-live bg-accent hover:bg-accent/90',
            state === 'ON_BREAK' && 'bg-saffron',
            state === 'SIGNED_OUT' && 'bg-ink-100 text-ink-500 dark:bg-ink-700 dark:text-ink-100',
          )}
          aria-label={primary?.label ?? t('attendance.doneForToday')}
        >
          {primary ? primary.icon : null}
          <span className="px-3 text-center text-sm font-semibold leading-tight">{primary?.label ?? t('attendance.doneForToday')}</span>
        </button>
      </div>

      <div className="w-full min-w-0 flex-1 space-y-3 text-center sm:text-left">
        <div>
          <div className="text-xs text-ink-500 dark:text-ink-300">{t('attendance.worked')}</div>
          <div className="text-4xl font-semibold tabular-nums tracking-tight">{hours(worked)}</div>
        </div>
        <p className="text-sm text-ink-500 dark:text-ink-300">
          {state === 'NOT_SIGNED_IN' && t('attendance.notSignedIn')}
          {(state === 'SIGNED_IN' || state === 'ON_BREAK') && rec && t('attendance.signedInAt', { time: time(rec.signInAt, tz) })}
          {state === 'ON_BREAK' && ` · ${t('attendance.onBreak')}`}
          {state === 'SIGNED_OUT' && rec && t('attendance.signedOutAt', { time: time(rec.signOutAt, tz) })}
          {(rec?.lateMinutes ?? 0) > 0 && rec && <span className="ml-2 text-saffron">{t('attendance.late', { minutes: rec.lateMinutes })}</span>}
        </p>
        {d?.schedule && (
          <p className="text-xs text-ink-300">
            {t('attendance.schedule')}: {d.schedule.startTime}–{d.schedule.endTime}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-center gap-3 sm:justify-start">
          {state === 'NOT_SIGNED_IN' && <Checkbox label={t('attendance.workingRemotely')} checked={remote} onChange={(e) => setRemote(e.target.checked)} />}
          {state === 'SIGNED_IN' && (
            <Button size="sm" icon={<Coffee className="h-4 w-4" />} loading={act.isPending} onClick={() => act.mutate('/attendance/break/start')}>
              {t('attendance.startBreak')}
            </Button>
          )}
          {state === 'ON_BREAK' && (
            <Button size="sm" variant="primary" icon={<Coffee className="h-4 w-4" />} loading={act.isPending} onClick={() => act.mutate('/attendance/break/end')}>
              {t('attendance.endBreak')}
            </Button>
          )}
        </div>
        <ErrorNote error={act.error ?? q.error} />
      </div>
    </section>
  );
}

function scheduleMinutes(s?: { startTime: string; endTime: string; breakMinutes: number }) {
  if (!s) return 480;
  const [h1, m1] = s.startTime.split(':').map(Number);
  const [h2, m2] = s.endTime.split(':').map(Number);
  return h2 * 60 + m2 - (h1 * 60 + m1) - s.breakMinutes;
}
