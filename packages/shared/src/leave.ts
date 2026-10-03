import type { LeaveDayPortion } from './enums';
import { eachDate, isoWeekday } from './time';

export interface LeaveDaysInput {
  startDate: string;
  endDate: string;
  portion: LeaveDayPortion;
  workDays: number[];
  holidays: string[];
  /** Days a short leave counts as (e.g. 0 when short leave is tracked separately). */
  shortLeaveValue?: number;
}

/**
 * Number of leave days a request consumes: working days in the range,
 * excluding weekends per schedule and company holidays. Half-day and short
 * leave are only allowed for single-day requests.
 */
export function calculateLeaveDays(input: LeaveDaysInput): number {
  if (input.endDate < input.startDate) throw new Error('End date is before start date');
  const holidays = new Set(input.holidays);
  const days = eachDate(input.startDate, input.endDate).filter(
    (d) => input.workDays.includes(isoWeekday(d)) && !holidays.has(d),
  ).length;
  if (input.portion === 'FULL') return days;
  if (input.startDate !== input.endDate) throw new Error('Half-day and short leave must be for a single day');
  if (days === 0) return 0;
  if (input.portion === 'SHORT') return input.shortLeaveValue ?? 0.25;
  return 0.5;
}

/**
 * Prorated entitlement for an employee who joins (or whose contract starts)
 * part-way through the leave year. Rounded down to the nearest half day.
 */
export function prorateEntitlement(daysPerYear: number, joinDate: string, year: number): number {
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;
  if (joinDate <= start) return daysPerYear;
  if (joinDate > end) return 0;
  const [, m] = joinDate.split('-').map(Number);
  const monthsRemaining = 12 - (m - 1);
  return Math.floor(((daysPerYear * monthsRemaining) / 12) * 2) / 2;
}
