import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Header,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Prisma, type AttendanceBreak, type AttendanceRecord, type Employee, type WorkSchedule } from '@prisma/client';
import { calculateAttendance, isoWeekday, localDate, localTime, zonedToUtc } from '@ihrm/shared';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.module';
import { CurrentUser, ReqMeta, RequirePermissions } from '../common/decorators';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { ZodPipe } from '../common/zod.pipe';
import { dateOnly, ymd, ymdSchema } from '../common/pagination';
import { employeeScope, scopeOf } from '../common/scope';

const FALLBACK_SCHEDULE = { startTime: '08:30', endTime: '17:30', breakMinutes: 60, graceMinutes: 15, workDays: [1, 2, 3, 4, 5] };
const OPEN_WINDOW_HOURS = 20; // a sign-in older than this without sign-out counts as missed

const signInSchema = z.object({
  source: z.enum(['WEB', 'MOBILE']).default('WEB'),
  isRemote: z.boolean().default(false),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  device: z.string().max(200).optional(),
  notes: z.string().max(500).optional(),
});

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const adminSchema = z.object({
  employeeId: z.string().uuid(),
  workDate: ymdSchema,
  signIn: hhmm,
  signOut: hhmm.nullable().optional(),
  breakMinutes: z.number().int().min(0).max(600).default(0),
  isRemote: z.boolean().default(false),
  reason: z.string().min(3, 'A reason is required for manual attendance changes'),
});
const correctionSchema = adminSchema.omit({ employeeId: true, workDate: true }).partial().extend({ reason: z.string().min(3, 'A reason is required') });

type Rec = AttendanceRecord & { breaks: AttendanceBreak[] };
type Emp = Employee & { workSchedule: WorkSchedule | null };

@Injectable()
export class AttendanceService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  private async me(user: AuthUser): Promise<Emp> {
    if (!user.employeeId) throw new BadRequestException('Your account is not linked to an employee record');
    const e = await this.prisma.employee.findUnique({ where: { id: user.employeeId }, include: { workSchedule: true } });
    if (!e || e.deletedAt) throw new NotFoundException('Employee not found');
    if (!['ACTIVE', 'ON_NOTICE'].includes(e.employmentStatus)) throw new BadRequestException('Only active employees can sign in');
    return e;
  }

  private schedule(e: Emp) {
    const s = e.workSchedule ?? FALLBACK_SCHEDULE;
    return { startTime: s.startTime, endTime: s.endTime, breakMinutes: s.breakMinutes, graceMinutes: s.graceMinutes, workDays: s.workDays, timezone: e.timezone };
  }

  private async isWorkingDay(companyId: string, e: Emp, date: string) {
    if (!this.schedule(e).workDays.includes(isoWeekday(date))) return false;
    return !(await this.prisma.holiday.findFirst({ where: { companyId, date: dateOnly(date) } }));
  }

  /** Recalculate stored metrics from timestamps (server time only). */
  private async recalc(tx: Prisma.TransactionClient, rec: Rec, e: Emp) {
    const date = ymd(rec.workDate);
    const r = calculateAttendance({
      workDate: date,
      signInAt: rec.signInAt,
      signOutAt: rec.signOutAt,
      breaks: rec.breaks,
      schedule: this.schedule(e),
      isWorkingDay: await this.isWorkingDay(rec.companyId, e, date),
    });
    return tx.attendanceRecord.update({
      where: { id: rec.id },
      data: {
        workedMinutes: r.workedMinutes,
        breakMinutes: r.breakMinutes,
        lateMinutes: r.lateMinutes,
        earlyLeaveMinutes: r.earlyLeaveMinutes,
        overtimeMinutes: r.overtimeMinutes,
        status: r.status,
      },
      include: { breaks: true },
    });
  }

  private async openRecord(employeeId: string) {
    return this.prisma.attendanceRecord.findFirst({
      where: { employeeId, signOutAt: null, signInAt: { gte: new Date(Date.now() - OPEN_WINDOW_HOURS * 3600_000) } },
      include: { breaks: true },
      orderBy: { signInAt: 'desc' },
    });
  }

  async signIn(user: AuthUser, b: z.infer<typeof signInSchema>, meta: RequestMeta) {
    const e = await this.me(user);
    const now = new Date();
    const workDate = localDate(now, e.timezone);
    const existing = await this.prisma.attendanceRecord.findUnique({ where: { employeeId_workDate: { employeeId: e.id, workDate: dateOnly(workDate) } } });
    if (existing) {
      throw new ConflictException(existing.signOutAt ? 'You have already signed out today. Ask your manager to correct the record if needed.' : 'You are already signed in');
    }
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: user.companyId } });
    const policy = ((company.settings as { attendance?: { captureLocation?: boolean; allowRemote?: boolean } }).attendance ?? {}) as { captureLocation?: boolean; allowRemote?: boolean };
    if (b.isRemote && policy.allowRemote === false) throw new BadRequestException('Remote work sign-in is not enabled');
    // Location is stored only when company policy enables it (PDPA: employees are informed via the privacy notice).
    const keepLocation = policy.captureLocation === true;
    return this.prisma.$transaction(async (tx) => {
      const rec = await tx.attendanceRecord.create({
        data: {
          companyId: user.companyId,
          employeeId: e.id,
          workDate: dateOnly(workDate),
          signInAt: now,
          source: b.source,
          signInIp: meta.ip,
          device: (b.device ?? meta.userAgent)?.slice(0, 200),
          isRemote: b.isRemote,
          latitude: keepLocation ? b.latitude : null,
          longitude: keepLocation ? b.longitude : null,
          notes: b.notes,
        },
        include: { breaks: true },
      });
      return this.recalc(tx, rec, e);
    });
  }

  async signOut(user: AuthUser, meta: RequestMeta) {
    const e = await this.me(user);
    const rec = await this.openRecord(e.id);
    if (!rec) throw new BadRequestException('You are not signed in');
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      await tx.attendanceBreak.updateMany({ where: { attendanceId: rec.id, endAt: null }, data: { endAt: now } });
      const updated = await tx.attendanceRecord.update({ where: { id: rec.id }, data: { signOutAt: now, signOutIp: meta.ip }, include: { breaks: true } });
      return this.recalc(tx, updated, e);
    });
  }

  async startBreak(user: AuthUser) {
    const e = await this.me(user);
    const rec = await this.openRecord(e.id);
    if (!rec) throw new BadRequestException('Sign in before starting a break');
    if (rec.breaks.some((x) => !x.endAt)) throw new ConflictException('A break is already in progress');
    await this.prisma.attendanceBreak.create({ data: { attendanceId: rec.id, startAt: new Date() } });
    return this.today(user);
  }

  async endBreak(user: AuthUser) {
    const e = await this.me(user);
    const rec = await this.openRecord(e.id);
    const open = rec?.breaks.find((x) => !x.endAt);
    if (!rec || !open) throw new BadRequestException('No break in progress');
    await this.prisma.$transaction(async (tx) => {
      await tx.attendanceBreak.update({ where: { id: open.id }, data: { endAt: new Date() } });
      const fresh = await tx.attendanceRecord.findUniqueOrThrow({ where: { id: rec.id }, include: { breaks: true } });
      await this.recalc(tx, fresh, e);
    });
    return this.today(user);
  }

  async today(user: AuthUser) {
    const e = await this.me(user);
    const workDate = localDate(new Date(), e.timezone);
    const rec =
      (await this.openRecord(e.id)) ??
      (await this.prisma.attendanceRecord.findUnique({ where: { employeeId_workDate: { employeeId: e.id, workDate: dateOnly(workDate) } }, include: { breaks: true } }));
    const schedule = this.schedule(e);
    const onBreak = !!rec?.breaks.some((b) => !b.endAt);
    // Live worked minutes for an open record (display only; stored values are recalculated at sign-out).
    let liveWorkedMinutes = rec?.workedMinutes ?? 0;
    if (rec && !rec.signOutAt) {
      const live = calculateAttendance({ workDate, signInAt: rec.signInAt, signOutAt: new Date(), breaks: rec.breaks, schedule, isWorkingDay: true });
      liveWorkedMinutes = live.workedMinutes;
    }
    return {
      workDate,
      timezone: e.timezone,
      schedule,
      state: !rec ? 'NOT_SIGNED_IN' : rec.signOutAt ? 'SIGNED_OUT' : onBreak ? 'ON_BREAK' : 'SIGNED_IN',
      record: rec,
      liveWorkedMinutes,
      serverTime: new Date().toISOString(),
    };
  }

  async records(user: AuthUser, q: { from: string; to: string; employeeId?: string }) {
    const empWhere: Prisma.EmployeeWhereInput = scopeOf(user, 'ATTENDANCE_VIEW')
      ? { OR: [employeeScope(user, 'ATTENDANCE_VIEW'), { id: user.employeeId ?? '00000000-0000-0000-0000-000000000000' }] }
      : { id: user.employeeId ?? '00000000-0000-0000-0000-000000000000' };
    return this.prisma.attendanceRecord.findMany({
      where: { companyId: user.companyId, employeeId: q.employeeId, workDate: { gte: dateOnly(q.from), lte: dateOnly(q.to) }, employee: empWhere },
      include: { breaks: true, employee: { select: { id: true, employeeNo: true, firstName: true, lastName: true, timezone: true } } },
      orderBy: [{ workDate: 'desc' }, { signInAt: 'desc' }],
      take: 5000,
    });
  }

  /** Daily board for managers/HR: present, late, absent, on leave, remote. */
  async daily(user: AuthUser, date: string) {
    const employees = await this.prisma.employee.findMany({
      where: { AND: [employeeScope(user, 'ATTENDANCE_VIEW'), { employmentStatus: { in: ['ACTIVE', 'ON_NOTICE'] }, joiningDate: { lte: dateOnly(date) } }] },
      include: { workSchedule: true, department: { select: { id: true, name: true } } },
      orderBy: { firstName: 'asc' },
    });
    const ids = employees.map((e) => e.id);
    const [recs, leaves, holiday] = await Promise.all([
      this.prisma.attendanceRecord.findMany({ where: { employeeId: { in: ids }, workDate: dateOnly(date) } }),
      this.prisma.leaveRequest.findMany({
        where: { employeeId: { in: ids }, status: 'APPROVED', startDate: { lte: dateOnly(date) }, endDate: { gte: dateOnly(date) } },
        include: { leaveType: { select: { name: true } } },
      }),
      this.prisma.holiday.findFirst({ where: { companyId: user.companyId, date: dateOnly(date) } }),
    ]);
    const recBy = new Map(recs.map((r) => [r.employeeId, r]));
    const leaveBy = new Map(leaves.map((l) => [l.employeeId, l]));
    const rows = employees.map((e) => {
      const r = recBy.get(e.id);
      const l = leaveBy.get(e.id);
      const workDays = (e.workSchedule ?? FALLBACK_SCHEDULE).workDays;
      const scheduled = workDays.includes(isoWeekday(date)) && !holiday;
      let status: string;
      if (r) status = r.isRemote ? 'REMOTE' : r.lateMinutes > 0 ? 'LATE' : 'PRESENT';
      else if (l && l.portion === 'FULL') status = 'ON_LEAVE';
      else if (holiday) status = 'HOLIDAY';
      else if (!scheduled) status = 'OFF';
      else status = 'ABSENT';
      return {
        employee: { id: e.id, employeeNo: e.employeeNo, name: `${e.firstName} ${e.lastName}`, department: e.department?.name ?? null },
        status,
        signIn: r ? localTime(r.signInAt, e.timezone) : null,
        signOut: r?.signOutAt ? localTime(r.signOutAt, e.timezone) : null,
        workedMinutes: r?.workedMinutes ?? 0,
        lateMinutes: r?.lateMinutes ?? 0,
        leaveType: l?.leaveType.name ?? null,
        missingSignOut: !!r && !r.signOutAt && date < localDate(new Date(), e.timezone),
      };
    });
    const count = (s: string) => rows.filter((r) => r.status === s).length;
    return {
      date,
      holiday: holiday?.name ?? null,
      summary: {
        total: rows.length,
        present: count('PRESENT') + count('LATE') + count('REMOTE'),
        late: count('LATE'),
        remote: count('REMOTE'),
        onLeave: count('ON_LEAVE'),
        absent: count('ABSENT'),
      },
      rows,
    };
  }

  /** Attendance trend and department comparison for management. */
  async summary(user: AuthUser, from: string, to: string) {
    const scope = employeeScope(user, 'ATTENDANCE_VIEW');
    const rows = await this.prisma.attendanceRecord.findMany({
      where: { companyId: user.companyId, workDate: { gte: dateOnly(from), lte: dateOnly(to) }, employee: scope },
      select: { workDate: true, lateMinutes: true, workedMinutes: true, overtimeMinutes: true, employee: { select: { department: { select: { name: true } } } } },
    });
    const byDay = new Map<string, { present: number; late: number }>();
    const byDept = new Map<string, { records: number; late: number; workedMinutes: number; overtimeMinutes: number }>();
    for (const r of rows) {
      const d = ymd(r.workDate);
      const day = byDay.get(d) ?? { present: 0, late: 0 };
      day.present++;
      if (r.lateMinutes > 0) day.late++;
      byDay.set(d, day);
      const name = r.employee.department?.name ?? 'Unassigned';
      const dept = byDept.get(name) ?? { records: 0, late: 0, workedMinutes: 0, overtimeMinutes: 0 };
      dept.records++;
      if (r.lateMinutes > 0) dept.late++;
      dept.workedMinutes += r.workedMinutes;
      dept.overtimeMinutes += r.overtimeMinutes;
      byDept.set(name, dept);
    }
    return {
      from,
      to,
      trend: [...byDay.entries()].sort().map(([date, v]) => ({ date, ...v })),
      departments: [...byDept.entries()].map(([department, v]) => ({
        department,
        ...v,
        lateRate: v.records ? Math.round((v.late / v.records) * 1000) / 10 : 0,
        avgHours: v.records ? Math.round((v.workedMinutes / v.records / 60) * 10) / 10 : 0,
      })),
    };
  }

  /** Manual entry by HR/manager (source ADMIN). Reason required and audited. */
  async adminCreate(user: AuthUser, b: z.infer<typeof adminSchema>, meta: RequestMeta) {
    const e = await this.prisma.employee.findFirst({ where: { AND: [employeeScope(user, 'ATTENDANCE_EDIT'), { id: b.employeeId }] }, include: { workSchedule: true } });
    if (!e) throw new NotFoundException('Employee not found');
    if (await this.prisma.attendanceRecord.findUnique({ where: { employeeId_workDate: { employeeId: e.id, workDate: dateOnly(b.workDate) } } })) {
      throw new ConflictException('A record already exists for that date; correct it instead');
    }
    const signInAt = zonedToUtc(b.workDate, b.signIn, e.timezone);
    const signOutAt = b.signOut ? zonedToUtc(b.workDate, b.signOut, e.timezone) : null;
    if (signOutAt && signOutAt <= signInAt) throw new BadRequestException('Sign-out must be after sign-in');
    return this.prisma.$transaction(async (tx) => {
      const rec = await tx.attendanceRecord.create({
        data: { companyId: user.companyId, employeeId: e.id, workDate: dateOnly(b.workDate), signInAt, signOutAt, source: 'ADMIN', isRemote: b.isRemote, notes: b.reason },
        include: { breaks: true },
      });
      if (b.breakMinutes && signOutAt) {
        const bs = new Date(signInAt.getTime() + 4 * 3600_000);
        await tx.attendanceBreak.create({ data: { attendanceId: rec.id, startAt: bs, endAt: new Date(bs.getTime() + b.breakMinutes * 60_000) } });
      }
      const fresh = await tx.attendanceRecord.findUniqueOrThrow({ where: { id: rec.id }, include: { breaks: true } });
      const out = await this.recalc(tx, fresh, e);
      await this.audit.log(user, { action: 'ADMIN_CREATE', module: 'ATTENDANCE', entity: 'AttendanceRecord', entityId: rec.id, newValue: out, reason: b.reason }, meta, tx);
      return out;
    });
  }

  async correct(user: AuthUser, id: string, b: z.infer<typeof correctionSchema>, meta: RequestMeta) {
    const old = await this.prisma.attendanceRecord.findFirst({ where: { id, companyId: user.companyId }, include: { breaks: true } });
    if (!old) throw new NotFoundException();
    const e = await this.prisma.employee.findFirst({ where: { AND: [employeeScope(user, 'ATTENDANCE_EDIT'), { id: old.employeeId }] }, include: { workSchedule: true } });
    if (!e) throw new NotFoundException();
    if (e.id === user.employeeId) throw new BadRequestException('You cannot correct your own attendance');
    const date = ymd(old.workDate);
    const signInAt = b.signIn ? zonedToUtc(date, b.signIn, e.timezone) : old.signInAt;
    const signOutAt = b.signOut === undefined ? old.signOutAt : b.signOut ? zonedToUtc(date, b.signOut, e.timezone) : null;
    if (signOutAt && signOutAt <= signInAt) throw new BadRequestException('Sign-out must be after sign-in');
    return this.prisma.$transaction(async (tx) => {
      if (b.breakMinutes !== undefined) {
        await tx.attendanceBreak.deleteMany({ where: { attendanceId: id } });
        if (b.breakMinutes > 0) {
          const bs = new Date(signInAt.getTime() + 4 * 3600_000);
          await tx.attendanceBreak.create({ data: { attendanceId: id, startAt: bs, endAt: new Date(bs.getTime() + b.breakMinutes * 60_000) } });
        }
      }
      const rec = await tx.attendanceRecord.update({ where: { id }, data: { signInAt, signOutAt, isRemote: b.isRemote ?? old.isRemote }, include: { breaks: true } });
      const out = await this.recalc(tx, rec, e);
      await this.audit.log(user, { action: 'CORRECT', module: 'ATTENDANCE', entity: 'AttendanceRecord', entityId: id, oldValue: old, newValue: out, reason: b.reason }, meta, tx);
      return out;
    });
  }

  async exportCsv(user: AuthUser, from: string, to: string, meta: RequestMeta) {
    const rows = await this.prisma.attendanceRecord.findMany({
      where: { companyId: user.companyId, workDate: { gte: dateOnly(from), lte: dateOnly(to) }, employee: employeeScope(user, 'ATTENDANCE_EXPORT') },
      include: { employee: { select: { employeeNo: true, firstName: true, lastName: true, timezone: true } } },
      orderBy: [{ workDate: 'asc' }, { employee: { employeeNo: 'asc' } }],
    });
    await this.audit.log(user, { action: 'EXPORT', module: 'ATTENDANCE', entity: 'AttendanceRecord', newValue: { from, to, count: rows.length } }, meta);
    const h = (m: number) => (m / 60).toFixed(2);
    const lines = rows.map((r) =>
      [r.employee.employeeNo, `${r.employee.firstName} ${r.employee.lastName}`, ymd(r.workDate), localTime(r.signInAt, r.employee.timezone), r.signOutAt ? localTime(r.signOutAt, r.employee.timezone) : '', h(r.workedMinutes), h(r.breakMinutes), r.lateMinutes, r.earlyLeaveMinutes, h(r.overtimeMinutes), r.source, r.isRemote ? 'Y' : 'N', r.status]
        .map((v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v)))
        .join(','),
    );
    return ['Employee No,Name,Date,Sign in,Sign out,Worked hours,Break hours,Late minutes,Early leave minutes,Overtime hours,Source,Remote,Status', ...lines].join('\n');
  }
}

const rangeSchema = z.object({ from: ymdSchema, to: ymdSchema, employeeId: z.string().uuid().optional() });

@ApiTags('attendance')
@ApiBearerAuth()
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly svc: AttendanceService) {}

  @Get('today')
  today(@CurrentUser() u: AuthUser) {
    return this.svc.today(u);
  }

  @Post('sign-in')
  @RequirePermissions('ATTENDANCE_SELF')
  signIn(@CurrentUser() u: AuthUser, @Body(new ZodPipe(signInSchema)) b: z.infer<typeof signInSchema>, @ReqMeta() m: RequestMeta) {
    return this.svc.signIn(u, b, m);
  }

  @Post('sign-out')
  @RequirePermissions('ATTENDANCE_SELF')
  signOut(@CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.svc.signOut(u, m);
  }

  @Post('break/start')
  @RequirePermissions('ATTENDANCE_SELF')
  startBreak(@CurrentUser() u: AuthUser) {
    return this.svc.startBreak(u);
  }

  @Post('break/end')
  @RequirePermissions('ATTENDANCE_SELF')
  endBreak(@CurrentUser() u: AuthUser) {
    return this.svc.endBreak(u);
  }

  @Get('records')
  records(@CurrentUser() u: AuthUser, @Query(new ZodPipe(rangeSchema)) q: z.infer<typeof rangeSchema>) {
    return this.svc.records(u, q);
  }

  @Get('daily')
  @RequirePermissions('ATTENDANCE_VIEW')
  daily(@CurrentUser() u: AuthUser, @Query(new ZodPipe(z.object({ date: ymdSchema }))) q: { date: string }) {
    return this.svc.daily(u, q.date);
  }

  @Get('summary')
  @RequirePermissions('ATTENDANCE_VIEW')
  summary(@CurrentUser() u: AuthUser, @Query(new ZodPipe(rangeSchema)) q: z.infer<typeof rangeSchema>) {
    return this.svc.summary(u, q.from, q.to);
  }

  @Get('export.csv')
  @RequirePermissions('ATTENDANCE_EXPORT')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="attendance.csv"')
  export(@CurrentUser() u: AuthUser, @Query(new ZodPipe(rangeSchema)) q: z.infer<typeof rangeSchema>, @ReqMeta() m: RequestMeta) {
    return this.svc.exportCsv(u, q.from, q.to, m);
  }

  @Post()
  @RequirePermissions('ATTENDANCE_EDIT')
  adminCreate(@CurrentUser() u: AuthUser, @Body(new ZodPipe(adminSchema)) b: z.infer<typeof adminSchema>, @ReqMeta() m: RequestMeta) {
    return this.svc.adminCreate(u, b, m);
  }

  @Patch(':id')
  @RequirePermissions('ATTENDANCE_EDIT')
  correct(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(correctionSchema)) b: z.infer<typeof correctionSchema>, @ReqMeta() m: RequestMeta) {
    return this.svc.correct(u, id, b, m);
  }
}

@Module({ providers: [AttendanceService], controllers: [AttendanceController], exports: [AttendanceService] })
export class AttendanceModule {}
