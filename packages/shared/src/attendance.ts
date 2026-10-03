import { minutesBetween, zonedToUtc } from './time';

export interface WorkScheduleInput {
  /** Local start time, e.g. "09:00". */
  startTime: string;
  /** Local end time, e.g. "17:30". */
  endTime: string;
  /** Unpaid break minutes included in the schedule. */
  breakMinutes: number;
  /** Minutes after start before an arrival counts as late. */
  graceMinutes: number;
  /** ISO weekdays that are working days (1 = Monday). */
  workDays: number[];
  timezone: string;
}

export interface AttendanceCalcInput {
  workDate: string; // YYYY-MM-DD in the employee's time zone
  signInAt: Date;
  signOutAt: Date | null;
  breaks: { startAt: Date; endAt: Date | null }[];
  schedule: WorkScheduleInput;
  isWorkingDay: boolean;
}

export interface AttendanceCalcResult {
  workedMinutes: number;
  breakMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  overtimeMinutes: number;
  scheduledMinutes: number;
  status: 'PRESENT' | 'INCOMPLETE';
}

/**
 * Calculate worked, break, late, early-leave and overtime minutes for one
 * attendance record. Uses server-recorded UTC timestamps only.
 */
export function calculateAttendance(input: AttendanceCalcInput): AttendanceCalcResult {
  const { schedule } = input;
  const schedStart = zonedToUtc(input.workDate, schedule.startTime, schedule.timezone);
  const schedEnd = zonedToUtc(input.workDate, schedule.endTime, schedule.timezone);
  const scheduledMinutes = input.isWorkingDay
    ? Math.max(0, minutesBetween(schedStart, schedEnd) - schedule.breakMinutes)
    : 0;

  const end = input.signOutAt;
  const breakMinutes = input.breaks.reduce(
    (s, b) => s + (b.endAt ? minutesBetween(b.startAt, b.endAt) : end ? minutesBetween(b.startAt, end) : 0),
    0,
  );

  if (!end) {
    return {
      workedMinutes: 0,
      breakMinutes,
      lateMinutes: lateOf(input.signInAt, schedStart, schedule.graceMinutes, input.isWorkingDay),
      earlyLeaveMinutes: 0,
      overtimeMinutes: 0,
      scheduledMinutes,
      status: 'INCOMPLETE',
    };
  }

  const gross = minutesBetween(input.signInAt, end);
  const workedMinutes = Math.max(0, gross - breakMinutes);
  const lateMinutes = lateOf(input.signInAt, schedStart, schedule.graceMinutes, input.isWorkingDay);
  const earlyLeaveMinutes = input.isWorkingDay && end < schedEnd ? minutesBetween(end, schedEnd) : 0;
  const overtimeMinutes = input.isWorkingDay
    ? Math.max(0, workedMinutes - scheduledMinutes)
    : workedMinutes; // all time on a non-working day is overtime

  return { workedMinutes, breakMinutes, lateMinutes, earlyLeaveMinutes, overtimeMinutes, scheduledMinutes, status: 'PRESENT' };
}

function lateOf(signIn: Date, schedStart: Date, grace: number, isWorkingDay: boolean): number {
  if (!isWorkingDay) return 0;
  const late = minutesBetween(schedStart, signIn);
  return late > grace ? late : 0;
}
