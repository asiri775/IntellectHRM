export function money(v: number | string | null | undefined, currency?: string) {
  const n = Number(v ?? 0);
  const s = new Intl.NumberFormat('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  return currency ? `${currency} ${s}` : s;
}

export function compactMoney(v: number, currency = 'LKR') {
  if (Math.abs(v) >= 1_000_000) return `${currency} ${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)}M`;
  if (Math.abs(v) >= 1_000) return `${currency} ${Math.round(v / 1_000)}k`;
  return `${currency} ${Math.round(v)}`;
}

/** YYYY-MM-DD or ISO → DD/MM/YYYY (company default format). */
export function date(v: string | Date | null | undefined) {
  if (!v) return '—';
  const s = typeof v === 'string' ? v : v.toISOString();
  const [y, m, d] = s.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

export function time(v: string | null | undefined, tz = 'Asia/Colombo') {
  if (!v) return '—';
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz }).format(new Date(v));
}

export function dateTime(v: string | null | undefined) {
  if (!v) return '—';
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(v));
}

export function hours(minutes: number | null | undefined) {
  const m = Math.max(0, Math.round(minutes ?? 0));
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

export function todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDays(ymd: string, days: number) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthName = (m: number) => MONTHS[m - 1];

export function fullName(e: { firstName?: string; lastName?: string; preferredName?: string | null } | null | undefined) {
  if (!e) return '—';
  return `${e.preferredName || e.firstName || ''} ${e.lastName || ''}`.trim();
}

export function titleCase(s: string | null | undefined) {
  if (!s) return '';
  return s.toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}
