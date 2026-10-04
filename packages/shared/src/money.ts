/**
 * Money helpers. All payroll arithmetic is done in integer cents to avoid
 * floating point drift. Rates are converted to basis points (1/10,000).
 */

/** Convert a decimal amount (e.g. 150000.5) to integer cents. */
export function toCents(amount: number | string): number {
  const n = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(n)) throw new Error(`Invalid money amount: ${amount}`);
  // Round half away from zero at the cent level.
  return Math.sign(n) * Math.round(Math.abs(n) * 100 + 1e-7);
}

/** Convert integer cents back to a decimal number with 2 dp. */
export function fromCents(cents: number): number {
  return Math.round(cents) / 100;
}

/** Convert a rate (0.05 = 5%) to integer basis points (500). */
export function rateToBp(rate: number): number {
  return Math.round(rate * 10000);
}

/**
 * Multiply cents by a rate and round HALF_UP to the nearest cent.
 * Uses integer arithmetic only.
 */
export function applyRate(cents: number, rate: number): number {
  const bp = rateToBp(rate);
  const product = Math.abs(cents) * bp;
  const rounded = Math.floor((product + 5000) / 10000);
  return Math.sign(cents) * rounded;
}

/** Prorate cents by numerator/denominator, HALF_UP. */
export function prorate(cents: number, numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  if (numerator >= denominator) return cents;
  // Work at 1e4 precision on the factor to stay integer-safe.
  const scaled = Math.abs(cents) * numerator;
  const value = Math.floor((scaled * 2 + denominator) / (2 * denominator));
  return Math.sign(cents) * value;
}

/** Format an amount for display, e.g. formatMoney(10000, 'LKR') => "LKR 10,000.00". */
export function formatMoney(amount: number, currency = 'LKR', locale = 'en-LK'): string {
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return `${currency} ${formatted}`;
}
