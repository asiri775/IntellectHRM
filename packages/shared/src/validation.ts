/** Sri Lankan NIC: old format 9 digits + V/X, new format 12 digits. */
export function isValidNic(value: string): boolean {
  const v = value.trim().toUpperCase();
  return /^[0-9]{9}[VX]$/.test(v) || /^[0-9]{12}$/.test(v);
}

export function normalizeNic(value: string): string {
  return value.trim().toUpperCase();
}

/** Sri Lankan mobile: 07XXXXXXXX or +947XXXXXXXX. Returns E.164 or null. */
export function normalizeSriLankaMobile(value: string): string | null {
  const v = value.replace(/[\s-]/g, '');
  if (/^07\d{8}$/.test(v)) return `+94${v.slice(1)}`;
  if (/^\+947\d{8}$/.test(v)) return v;
  if (/^947\d{8}$/.test(v)) return `+${v}`;
  return null;
}

/** Render a document number from a sequence format, e.g. "{PREFIX}-{YYYY}-{SEQ}". */
export function formatSequence(format: string, prefix: string, value: number, padding: number, date = new Date()): string {
  return format
    .replace('{PREFIX}', prefix)
    .replace('{YYYY}', String(date.getFullYear()))
    .replace('{YY}', String(date.getFullYear()).slice(-2))
    .replace('{MM}', String(date.getMonth() + 1).padStart(2, '0'))
    .replace('{SEQ}', String(value).padStart(padding, '0'));
}
