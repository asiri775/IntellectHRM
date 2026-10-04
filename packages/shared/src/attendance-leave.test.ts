import { describe, expect, it } from 'vitest';
import { calculateAttendance } from './attendance';
import { calculateLeaveDays, prorateEntitlement } from './leave';
import { localDate, zonedToUtc } from './time';
import { formatSequence, isValidNic, normalizeSriLankaMobile } from './validation';
import { applyRate, toCents } from './money';

const schedule = {
  startTime: '08:30',
  endTime: '17:30',
  breakMinutes: 60,
  graceMinutes: 15,
  workDays: [1, 2, 3, 4, 5],
  timezone: 'Asia/Colombo',
};

describe('time zones', () => {
  it('converts Colombo wall time to UTC (+05:30)', () => {
    expect(zonedToUtc('2026-10-05', '08:30', 'Asia/Colombo').toISOString()).toBe('2026-10-05T03:00:00.000Z');
  });
  it('local date of an instant', () => {
    expect(localDate(new Date('2026-10-04T20:00:00Z'), 'Asia/Colombo')).toBe('2026-10-05');
  });
});

describe('attendance calculation', () => {
  const at = (hhmm: string) => zonedToUtc('2026-10-05', hhmm, 'Asia/Colombo');

  it('on-time full day with a 1h break', () => {
    const r = calculateAttendance({
      workDate: '2026-10-05',
      signInAt: at('08:25'),
      signOutAt: at('17:35'),
      breaks: [{ startAt: at('12:30'), endAt: at('13:30') }],
      schedule,
      isWorkingDay: true,
    });
    expect(r.lateMinutes).toBe(0);
    expect(r.breakMinutes).toBe(60);
    expect(r.workedMinutes).toBe(490);
    expect(r.overtimeMinutes).toBe(10);
    expect(r.earlyLeaveMinutes).toBe(0);
  });

  it('late beyond grace and early departure', () => {
    const r = calculateAttendance({
      workDate: '2026-10-05',
      signInAt: at('09:00'),
      signOutAt: at('16:30'),
      breaks: [],
      schedule,
      isWorkingDay: true,
    });
    expect(r.lateMinutes).toBe(30);
    expect(r.earlyLeaveMinutes).toBe(60);
    expect(r.overtimeMinutes).toBe(0);
  });

  it('within grace is not late', () => {
    const r = calculateAttendance({ workDate: '2026-10-05', signInAt: at('08:44'), signOutAt: at('17:30'), breaks: [], schedule, isWorkingDay: true });
    expect(r.lateMinutes).toBe(0);
  });

  it('missing checkout is INCOMPLETE', () => {
    const r = calculateAttendance({ workDate: '2026-10-05', signInAt: at('08:30'), signOutAt: null, breaks: [], schedule, isWorkingDay: true });
    expect(r.status).toBe('INCOMPLETE');
  });

  it('all work on a non-working day is overtime', () => {
    const r = calculateAttendance({ workDate: '2026-10-04', signInAt: zonedToUtc('2026-10-04', '10:00', 'Asia/Colombo'), signOutAt: zonedToUtc('2026-10-04', '13:00', 'Asia/Colombo'), breaks: [], schedule, isWorkingDay: false });
    expect(r.overtimeMinutes).toBe(180);
  });
});

describe('leave days', () => {
  it('excludes weekends and holidays', () => {
    // Mon 5 Oct – Fri 16 Oct 2026, one holiday
    expect(
      calculateLeaveDays({ startDate: '2026-10-05', endDate: '2026-10-16', portion: 'FULL', workDays: [1, 2, 3, 4, 5], holidays: ['2026-10-07'] }),
    ).toBe(9);
  });
  it('half day = 0.5', () => {
    expect(calculateLeaveDays({ startDate: '2026-10-05', endDate: '2026-10-05', portion: 'FIRST_HALF', workDays: [1, 2, 3, 4, 5], holidays: [] })).toBe(0.5);
  });
  it('half day across several days is rejected', () => {
    expect(() =>
      calculateLeaveDays({ startDate: '2026-10-05', endDate: '2026-10-06', portion: 'FIRST_HALF', workDays: [1, 2, 3, 4, 5], holidays: [] }),
    ).toThrow();
  });
  it('prorates entitlement for mid-year joiners', () => {
    expect(prorateEntitlement(14, '2026-07-10', 2026)).toBe(7);
    expect(prorateEntitlement(14, '2025-03-01', 2026)).toBe(14);
  });
});

describe('validation and money', () => {
  it('NIC formats', () => {
    expect(isValidNic('912345678V')).toBe(true);
    expect(isValidNic('199123456789')).toBe(true);
    expect(isValidNic('12345')).toBe(false);
  });
  it('mobile numbers', () => {
    expect(normalizeSriLankaMobile('077 123 4567')).toBe('+94771234567');
    expect(normalizeSriLankaMobile('12345')).toBeNull();
  });
  it('sequence formatting', () => {
    expect(formatSequence('{PREFIX}-{YYYY}-{SEQ}', 'INV', 1, 6, new Date('2026-05-01'))).toBe('INV-2026-000001');
  });
  it('rate rounding is half-up and integer-safe', () => {
    expect(applyRate(toCents(150001), 0.05)).toBe(750005);
    expect(applyRate(toCents(0.1), 0.05)).toBe(1); // 0.5 cent rounds up
  });
});
