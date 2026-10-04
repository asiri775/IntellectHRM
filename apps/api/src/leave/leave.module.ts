import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { HolidayType, LeaveRequestStatus, Prisma, type ApprovalStep } from '@prisma/client';
import { calculateLeaveDays, EMPLOYMENT_TYPES, LEAVE_DAY_PORTIONS, prorateEntitlement } from '@ihrm/shared';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.module';
import { CurrentUser, ReqMeta, RequirePermissions } from '../common/decorators';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { ZodPipe } from '../common/zod.pipe';
import { dateOnly, ymd, ymdSchema } from '../common/pagination';
import { employeeScope, hasPermission, scopeOf } from '../common/scope';
import { ApprovalService } from '../approvals/approval.service';
import { MailService } from '../mail/mail.module';
import { NotificationService } from '../settings/settings.module';

const n = (d: Prisma.Decimal | number | null | undefined) => Number(d ?? 0);

const requestSchema = z
  .object({
    leaveTypeId: z.string().uuid(),
    startDate: ymdSchema,
    endDate: ymdSchema,
    portion: z.enum(LEAVE_DAY_PORTIONS).default('FULL'),
    reason: z.string().max(1000).optional(),
    employeeId: z.string().uuid().optional(), // HR applying on behalf of an employee
  })
  .refine((v) => v.endDate >= v.startDate, { path: ['endDate'], message: 'End date is before start date' })
  .refine((v) => v.startDate.slice(0, 4) === v.endDate.slice(0, 4), { path: ['endDate'], message: 'Split requests that cross a year end' });

const decisionSchema = z.object({ comment: z.string().max(1000).optional() });

const leaveTypeSchema = z.object({
  code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  name: z.string().min(1),
  isPaid: z.boolean().default(true),
  allowHalfDay: z.boolean().default(true),
  allowShortLeave: z.boolean().default(false),
  requiresDocumentAfterDays: z.number().int().positive().nullable().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#1F4FD8'),
  isActive: z.boolean().default(true),
  rules: z
    .array(z.object({ employmentType: z.enum(EMPLOYMENT_TYPES), daysPerYear: z.number().min(0).max(366), carryForwardMax: z.number().min(0).default(0), prorate: z.boolean().default(true) }))
    .default([]),
});

const holidaySchema = z.object({ date: ymdSchema, name: z.string().min(1), type: z.nativeEnum(HolidayType).default('PUBLIC') });
const holidayImportSchema = z.object({ csv: z.string().min(1).max(50_000) });

const balanceAdjustSchema = z.object({ adjustment: z.number().min(-366).max(366), reason: z.string().min(3) });

@Injectable()
export class LeaveService {
  private readonly logger = new Logger(LeaveService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly approvals: ApprovalService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly notify: NotificationService,
  ) {}

  /** Create missing balances for a year from entitlement rules (never overwrites). */
  async ensureBalances(companyId: string, employeeId: string, year: number, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    const emp = await db.employee.findUniqueOrThrow({ where: { id: employeeId } });
    const types = await db.leaveType.findMany({ where: { companyId, isActive: true }, include: { rules: true } });
    for (const t of types) {
      const rule = t.rules.find((r) => r.employmentType === emp.employmentType);
      if (!rule) continue;
      const entitled = rule.prorate ? prorateEntitlement(n(rule.daysPerYear), ymd(emp.joiningDate), year) : n(rule.daysPerYear);
      await db.leaveBalance.upsert({
        where: { employeeId_leaveTypeId_year: { employeeId, leaveTypeId: t.id, year } },
        create: { employeeId, leaveTypeId: t.id, year, entitled },
        update: {},
      });
    }
  }

  async balances(user: AuthUser, employeeId: string, year: number) {
    const emp = await this.prisma.employee.findFirst({ where: { AND: [this.viewScope(user), { id: employeeId }] } });
    if (!emp) throw new NotFoundException('Employee not found');
    await this.ensureBalances(user.companyId, employeeId, year);
    const rows = await this.prisma.leaveBalance.findMany({ where: { employeeId, year }, include: { leaveType: true }, orderBy: { leaveType: { name: 'asc' } } });
    return rows.map((b) => ({
      id: b.id,
      leaveType: { id: b.leaveType.id, code: b.leaveType.code, name: b.leaveType.name, color: b.leaveType.color, isPaid: b.leaveType.isPaid },
      year: b.year,
      entitled: n(b.entitled),
      carriedForward: n(b.carriedForward),
      adjustment: n(b.adjustment),
      used: n(b.used),
      pending: n(b.pending),
      available: n(b.entitled) + n(b.carriedForward) + n(b.adjustment) - n(b.used) - n(b.pending),
    }));
  }

  private viewScope(user: AuthUser): Prisma.EmployeeWhereInput {
    // Everyone can see their own leave; LEAVE_VIEW scope widens it.
    if (!scopeOf(user, 'LEAVE_VIEW')) return { companyId: user.companyId, id: user.employeeId ?? '00000000-0000-0000-0000-000000000000' };
    return { OR: [employeeScope(user, 'LEAVE_VIEW'), { companyId: user.companyId, id: user.employeeId ?? '00000000-0000-0000-0000-000000000000' }] };
  }

  async holidaysBetween(companyId: string, start: string, end: string) {
    const rows = await this.prisma.holiday.findMany({ where: { companyId, date: { gte: dateOnly(start), lte: dateOnly(end) } } });
    return rows.map((h) => ymd(h.date));
  }

  async request(user: AuthUser, b: z.infer<typeof requestSchema>, meta: RequestMeta) {
    const employeeId = b.employeeId ?? user.employeeId;
    if (!employeeId) throw new BadRequestException('Your account is not linked to an employee record');
    if (b.employeeId && b.employeeId !== user.employeeId && !hasPermission(user, 'LEAVE_CONFIG')) {
      throw new ForbiddenException('Only HR can apply for leave on behalf of another employee');
    }
    const emp = await this.prisma.employee.findFirst({ where: { id: employeeId, companyId: user.companyId, deletedAt: null }, include: { workSchedule: true } });
    if (!emp) throw new NotFoundException('Employee not found');
    const type = await this.prisma.leaveType.findFirst({ where: { id: b.leaveTypeId, companyId: user.companyId, isActive: true } });
    if (!type) throw new BadRequestException('Leave type not found');
    if (b.portion === 'SHORT' && !type.allowShortLeave) throw new BadRequestException(`${type.name} cannot be taken as short leave`);
    if ((b.portion === 'FIRST_HALF' || b.portion === 'SECOND_HALF') && !type.allowHalfDay) throw new BadRequestException(`${type.name} cannot be taken as a half day`);

    const holidays = await this.holidaysBetween(user.companyId, b.startDate, b.endDate);
    const workDays = emp.workSchedule?.workDays ?? [1, 2, 3, 4, 5];
    let days: number;
    try {
      days = calculateLeaveDays({ startDate: b.startDate, endDate: b.endDate, portion: b.portion, workDays, holidays, shortLeaveValue: type.allowShortLeave && b.portion === 'SHORT' ? 1 : 0.25 });
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    if (days <= 0) throw new BadRequestException('The selected dates are all weekends or holidays');

    const overlap = await this.prisma.leaveRequest.findFirst({
      where: { employeeId, status: { in: ['PENDING', 'APPROVED'] }, startDate: { lte: dateOnly(b.endDate) }, endDate: { gte: dateOnly(b.startDate) } },
    });
    if (overlap && !(b.portion !== 'FULL' && overlap.portion !== 'FULL' && overlap.portion !== b.portion)) {
      throw new ConflictException('You already have leave booked on these dates');
    }

    const year = Number(b.startDate.slice(0, 4));
    await this.ensureBalances(user.companyId, employeeId, year);
    const bal = await this.prisma.leaveBalance.findUnique({ where: { employeeId_leaveTypeId_year: { employeeId, leaveTypeId: type.id, year } } });
    if (type.isPaid) {
      if (!bal) throw new BadRequestException(`No ${type.name} entitlement for this employment type`);
      const available = n(bal.entitled) + n(bal.carriedForward) + n(bal.adjustment) - n(bal.used) - n(bal.pending);
      if (days > available) throw new BadRequestException(`Insufficient ${type.name} balance: ${available} available, ${days} requested`);
    }

    const steps = await this.approvals.steps(user.companyId, 'LEAVE');
    const subject = { employeeId, managerId: emp.managerId };
    const first = this.approvals.nextApplicable(steps, subject, 1);

    const req = await this.prisma.$transaction(async (tx) => {
      const r = await tx.leaveRequest.create({
        data: {
          companyId: user.companyId,
          employeeId,
          leaveTypeId: type.id,
          startDate: dateOnly(b.startDate),
          endDate: dateOnly(b.endDate),
          portion: b.portion,
          days,
          reason: b.reason,
          status: first ? 'PENDING' : 'APPROVED',
          currentStep: first?.order ?? 0,
          decidedAt: first ? null : new Date(),
        },
      });
      if (bal) {
        await tx.leaveBalance.update({ where: { id: bal.id }, data: first ? { pending: { increment: days } } : { used: { increment: days } } });
      }
      await this.audit.log(user, { action: 'REQUEST', module: 'LEAVE', entity: 'LeaveRequest', entityId: r.id, newValue: r }, meta, tx);
      return r;
    });

    if (first) await this.notifyApprovers(user.companyId, req.id, first, subject);
    return req;
  }

  private async notifyApprovers(companyId: string, requestId: string, step: ApprovalStep, subject: { employeeId: string; managerId: string | null }) {
    const r = await this.prisma.leaveRequest.findUniqueOrThrow({ where: { id: requestId }, include: { employee: true, leaveType: true } });
    const userIds = await this.approvals.approverUserIds(companyId, step, subject);
    const name = `${r.employee.firstName} ${r.employee.lastName}`;
    await this.notify.notify(companyId, userIds, { type: 'LEAVE_REQUESTED', title: `Leave request: ${name}`, body: `${n(r.days)} day(s) ${r.leaveType.name}`, link: '/leave/approvals' });
    const approvers = await this.prisma.user.findMany({ where: { id: { in: userIds } } });
    for (const a of approvers) {
      await this.mail
        .send({
          companyId,
          templateKey: 'LEAVE_REQUESTED',
          to: a.email,
          language: a.preferredLanguage,
          data: { approver: { name: a.displayName }, employee: { name }, leave: { type: r.leaveType.name, days: n(r.days), startDate: r.startDate, endDate: r.endDate, reason: r.reason } },
          related: { entity: 'LeaveRequest', id: r.id },
        })
        .catch((e) => this.logger.error(`Leave email failed: ${e.message}`));
    }
  }

  async decide(user: AuthUser, id: string, decision: 'APPROVED' | 'REJECTED', comment: string | undefined, meta: RequestMeta) {
    const r = await this.prisma.leaveRequest.findFirst({ where: { id, companyId: user.companyId }, include: { employee: true, leaveType: true } });
    if (!r) throw new NotFoundException();
    if (r.status !== 'PENDING') throw new BadRequestException(`Request is already ${r.status.toLowerCase()}`);
    const steps = await this.approvals.steps(user.companyId, 'LEAVE');
    const subject = { employeeId: r.employeeId, managerId: r.employee.managerId };
    const step = steps.find((s) => s.order === r.currentStep);
    if (!step || !this.approvals.canApprove(user, step, subject)) throw new ForbiddenException('You are not the approver for this step');

    const next = decision === 'APPROVED' ? this.approvals.nextApplicable(steps, subject, step.order + 1) : null;
    const year = r.startDate.getUTCFullYear();
    const days = n(r.days);

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.approvals.record(tx, { companyId: user.companyId, entityType: 'LEAVE', entityId: r.id, stepOrder: step.order, approverUserId: user.userId, decision, comment });
      const bal = await tx.leaveBalance.findUnique({ where: { employeeId_leaveTypeId_year: { employeeId: r.employeeId, leaveTypeId: r.leaveTypeId, year } } });
      let row;
      if (decision === 'REJECTED') {
        row = await tx.leaveRequest.update({ where: { id }, data: { status: 'REJECTED', decidedAt: new Date() } });
        if (bal) await tx.leaveBalance.update({ where: { id: bal.id }, data: { pending: { decrement: days } } });
      } else if (next) {
        row = await tx.leaveRequest.update({ where: { id }, data: { currentStep: next.order } });
      } else {
        // Final approval: balance moves from pending to used only now.
        row = await tx.leaveRequest.update({ where: { id }, data: { status: 'APPROVED', decidedAt: new Date() } });
        if (bal) await tx.leaveBalance.update({ where: { id: bal.id }, data: { pending: { decrement: days }, used: { increment: days } } });
      }
      await this.audit.log(user, { action: decision === 'APPROVED' ? (next ? 'APPROVE_STEP' : 'APPROVE') : 'REJECT', module: 'LEAVE', entity: 'LeaveRequest', entityId: id, oldValue: { status: r.status, step: r.currentStep }, newValue: { status: row.status, step: row.currentStep }, reason: comment }, meta, tx);
      return row;
    });

    if (next) {
      await this.notifyApprovers(user.companyId, id, next, subject);
    } else {
      const empUser = r.employee.userId ? await this.prisma.user.findUnique({ where: { id: r.employee.userId } }) : null;
      await this.notify.notify(user.companyId, [r.employee.userId], {
        type: `LEAVE_${updated.status}`,
        title: `Leave ${updated.status === 'APPROVED' ? 'approved' : 'not approved'}`,
        body: `${r.leaveType.name} ${ymd(r.startDate)} – ${ymd(r.endDate)}`,
        link: '/leave',
      });
      await this.mail
        .send({
          companyId: user.companyId,
          templateKey: updated.status === 'APPROVED' ? 'LEAVE_APPROVED' : 'LEAVE_REJECTED',
          to: r.employee.email,
          language: empUser?.preferredLanguage ?? r.employee.preferredLanguage,
          data: { employee: { name: `${r.employee.firstName} ${r.employee.lastName}` }, leave: { type: r.leaveType.name, days, startDate: r.startDate, endDate: r.endDate }, comment },
          related: { entity: 'LeaveRequest', id },
        })
        .catch((e) => this.logger.error(`Leave email failed: ${e.message}`));
    }
    return updated;
  }

  async cancel(user: AuthUser, id: string, meta: RequestMeta) {
    const r = await this.prisma.leaveRequest.findFirst({ where: { id, companyId: user.companyId } });
    if (!r) throw new NotFoundException();
    const isOwner = r.employeeId === user.employeeId;
    if (!isOwner && !hasPermission(user, 'LEAVE_CONFIG')) throw new ForbiddenException();
    if (!['PENDING', 'APPROVED'].includes(r.status)) throw new BadRequestException('Only pending or approved leave can be cancelled');
    if (r.status === 'APPROVED' && isOwner && !hasPermission(user, 'LEAVE_CONFIG') && ymd(r.startDate) <= ymd(new Date())) {
      throw new BadRequestException('Leave that has started can only be cancelled by HR');
    }
    const days = n(r.days);
    return this.prisma.$transaction(async (tx) => {
      const bal = await tx.leaveBalance.findUnique({ where: { employeeId_leaveTypeId_year: { employeeId: r.employeeId, leaveTypeId: r.leaveTypeId, year: r.startDate.getUTCFullYear() } } });
      if (bal) await tx.leaveBalance.update({ where: { id: bal.id }, data: r.status === 'PENDING' ? { pending: { decrement: days } } : { used: { decrement: days } } });
      const row = await tx.leaveRequest.update({ where: { id }, data: { status: 'CANCELLED', decidedAt: new Date() } });
      await this.audit.log(user, { action: 'CANCEL', module: 'LEAVE', entity: 'LeaveRequest', entityId: id, oldValue: { status: r.status }, newValue: { status: 'CANCELLED' } }, meta, tx);
      return row;
    });
  }

  async list(user: AuthUser, q: { employeeId?: string; status?: string; from?: string; to?: string; mine?: boolean }) {
    const empWhere = q.mine ? { companyId: user.companyId, id: user.employeeId ?? '00000000-0000-0000-0000-000000000000' } : this.viewScope(user);
    return this.prisma.leaveRequest.findMany({
      where: {
        companyId: user.companyId,
        employee: empWhere,
        employeeId: q.employeeId,
        status: q.status as LeaveRequestStatus | undefined,
        ...(q.from || q.to ? { endDate: q.from ? { gte: dateOnly(q.from) } : undefined, startDate: q.to ? { lte: dateOnly(q.to) } : undefined } : {}),
      },
      include: { employee: { select: { id: true, employeeNo: true, firstName: true, lastName: true } }, leaveType: { select: { id: true, name: true, color: true } } },
      orderBy: { startDate: 'desc' },
      take: 500,
    });
  }

  /** Requests waiting for this user's decision. */
  async inbox(user: AuthUser) {
    const steps = await this.approvals.steps(user.companyId, 'LEAVE');
    if (!steps.length) return [];
    const pending = await this.prisma.leaveRequest.findMany({
      where: { companyId: user.companyId, status: 'PENDING' },
      include: { employee: { select: { id: true, employeeNo: true, firstName: true, lastName: true, managerId: true } }, leaveType: { select: { name: true, color: true } } },
      orderBy: { createdAt: 'asc' },
      take: 1000,
    });
    return pending
      .filter((r) => {
        const step = steps.find((s) => s.order === r.currentStep);
        return step && this.approvals.canApprove(user, step, { employeeId: r.employeeId, managerId: r.employee.managerId });
      })
      .map((r) => ({ ...r, stepName: steps.find((s) => s.order === r.currentStep)?.name }));
  }

  /** Year-end carry-forward into the next year's balances. */
  async rollover(user: AuthUser, fromYear: number, meta: RequestMeta) {
    const balances = await this.prisma.leaveBalance.findMany({ where: { year: fromYear, employee: { companyId: user.companyId, deletedAt: null } }, include: { employee: true, leaveType: { include: { rules: true } } } });
    let count = 0;
    await this.prisma.$transaction(async (tx) => {
      for (const b of balances) {
        const rule = b.leaveType.rules.find((r) => r.employmentType === b.employee.employmentType);
        const remaining = n(b.entitled) + n(b.carriedForward) + n(b.adjustment) - n(b.used) - n(b.pending);
        const cf = Math.max(0, Math.min(remaining, n(rule?.carryForwardMax)));
        await this.ensureBalances(user.companyId, b.employeeId, fromYear + 1, tx);
        await tx.leaveBalance.updateMany({ where: { employeeId: b.employeeId, leaveTypeId: b.leaveTypeId, year: fromYear + 1 }, data: { carriedForward: cf } });
        count++;
      }
      await this.audit.log(user, { action: 'ROLLOVER', module: 'LEAVE', entity: 'LeaveBalance', newValue: { fromYear, count } }, meta, tx);
    }, { timeout: 120_000 });
    return { fromYear, toYear: fromYear + 1, balances: count };
  }
}

@ApiTags('leave')
@ApiBearerAuth()
@Controller('leave')
export class LeaveController {
  constructor(private readonly svc: LeaveService, private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  @Get('types')
  types(@CurrentUser() u: AuthUser) {
    return this.prisma.leaveType.findMany({ where: { companyId: u.companyId }, include: { rules: true }, orderBy: { name: 'asc' } });
  }

  @Post('types')
  @RequirePermissions('LEAVE_CONFIG')
  async createType(@CurrentUser() u: AuthUser, @Body(new ZodPipe(leaveTypeSchema)) b: z.infer<typeof leaveTypeSchema>, @ReqMeta() m: RequestMeta) {
    const { rules, ...data } = b;
    const t = await this.prisma.leaveType.create({ data: { ...data, companyId: u.companyId, rules: { create: rules } } });
    await this.audit.log(u, { action: 'CREATE', module: 'LEAVE', entity: 'LeaveType', entityId: t.id, newValue: b }, m);
    return t;
  }

  @Put('types/:id')
  @RequirePermissions('LEAVE_CONFIG')
  async updateType(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(leaveTypeSchema)) b: z.infer<typeof leaveTypeSchema>, @ReqMeta() m: RequestMeta) {
    const old = await this.prisma.leaveType.findFirst({ where: { id, companyId: u.companyId }, include: { rules: true } });
    if (!old) throw new NotFoundException();
    const { rules, ...data } = b;
    const t = await this.prisma.$transaction(async (tx) => {
      await tx.leaveEntitlementRule.deleteMany({ where: { leaveTypeId: id } });
      return tx.leaveType.update({ where: { id }, data: { ...data, rules: { create: rules } }, include: { rules: true } });
    });
    await this.audit.log(u, { action: 'UPDATE', module: 'LEAVE', entity: 'LeaveType', entityId: id, oldValue: old, newValue: t }, m);
    return t;
  }

  @Get('balances/me')
  myBalances(@CurrentUser() u: AuthUser, @Query('year') year?: string) {
    if (!u.employeeId) throw new BadRequestException('Your account is not linked to an employee record');
    return this.svc.balances(u, u.employeeId, Number(year) || new Date().getFullYear());
  }

  @Get('balances/:employeeId')
  balances(@CurrentUser() u: AuthUser, @Param('employeeId', ParseUUIDPipe) employeeId: string, @Query('year') year?: string) {
    return this.svc.balances(u, employeeId, Number(year) || new Date().getFullYear());
  }

  @Patch('balances/:balanceId')
  @RequirePermissions('LEAVE_CONFIG')
  async adjust(@CurrentUser() u: AuthUser, @Param('balanceId', ParseUUIDPipe) id: string, @Body(new ZodPipe(balanceAdjustSchema)) b: z.infer<typeof balanceAdjustSchema>, @ReqMeta() m: RequestMeta) {
    const old = await this.prisma.leaveBalance.findFirst({ where: { id, employee: { companyId: u.companyId } } });
    if (!old) throw new NotFoundException();
    const row = await this.prisma.leaveBalance.update({ where: { id }, data: { adjustment: b.adjustment } });
    await this.audit.log(u, { action: 'ADJUST_BALANCE', module: 'LEAVE', entity: 'LeaveBalance', entityId: id, oldValue: old, newValue: row, reason: b.reason }, m);
    return row;
  }

  @Post('balances/rollover')
  @RequirePermissions('LEAVE_CONFIG')
  rollover(@CurrentUser() u: AuthUser, @Body(new ZodPipe(z.object({ fromYear: z.number().int().min(2000).max(2100) }))) b: { fromYear: number }, @ReqMeta() m: RequestMeta) {
    return this.svc.rollover(u, b.fromYear, m);
  }

  @Get('requests')
  list(
    @CurrentUser() u: AuthUser,
    @Query(new ZodPipe(z.object({ employeeId: z.string().uuid().optional(), status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(), from: ymdSchema.optional(), to: ymdSchema.optional(), mine: z.coerce.boolean().optional() })))
    q: { employeeId?: string; status?: string; from?: string; to?: string; mine?: boolean },
  ) {
    return this.svc.list(u, q);
  }

  @Get('approvals')
  inbox(@CurrentUser() u: AuthUser) {
    return this.svc.inbox(u);
  }

  @Post('requests')
  @RequirePermissions('LEAVE_REQUEST')
  request(@CurrentUser() u: AuthUser, @Body(new ZodPipe(requestSchema)) b: z.infer<typeof requestSchema>, @ReqMeta() m: RequestMeta) {
    return this.svc.request(u, b, m);
  }

  @Post('requests/:id/approve')
  approve(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(decisionSchema)) b: z.infer<typeof decisionSchema>, @ReqMeta() m: RequestMeta) {
    return this.svc.decide(u, id, 'APPROVED', b.comment, m);
  }

  @Post('requests/:id/reject')
  reject(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(decisionSchema)) b: z.infer<typeof decisionSchema>, @ReqMeta() m: RequestMeta) {
    return this.svc.decide(u, id, 'REJECTED', b.comment, m);
  }

  @Post('requests/:id/cancel')
  cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() m: RequestMeta) {
    return this.svc.cancel(u, id, m);
  }

  // ── Holidays ──
  @Get('holidays')
  holidays(@CurrentUser() u: AuthUser, @Query('year') year?: string) {
    const y = Number(year) || new Date().getFullYear();
    return this.prisma.holiday.findMany({ where: { companyId: u.companyId, date: { gte: dateOnly(`${y}-01-01`), lte: dateOnly(`${y}-12-31`) } }, orderBy: { date: 'asc' } });
  }

  @Post('holidays')
  @RequirePermissions('HOLIDAY_MANAGE')
  async addHoliday(@CurrentUser() u: AuthUser, @Body(new ZodPipe(holidaySchema)) b: z.infer<typeof holidaySchema>, @ReqMeta() m: RequestMeta) {
    const h = await this.prisma.holiday.create({ data: { ...b, date: dateOnly(b.date), companyId: u.companyId } });
    await this.audit.log(u, { action: 'CREATE', module: 'LEAVE', entity: 'Holiday', entityId: h.id, newValue: h }, m);
    return h;
  }

  /** Import a holiday calendar: one per line "YYYY-MM-DD,Name,TYPE" (TYPE optional: PUBLIC, BANK, MERCANTILE, POYA, COMPANY). */
  @Post('holidays/import')
  @RequirePermissions('HOLIDAY_MANAGE')
  async importHolidays(@CurrentUser() u: AuthUser, @Body(new ZodPipe(holidayImportSchema)) b: { csv: string }, @ReqMeta() m: RequestMeta) {
    const errors: string[] = [];
    const rows: { date: string; name: string; type: HolidayType }[] = [];
    b.csv
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.toLowerCase().startsWith('date'))
      .forEach((line, i) => {
        const [date, name, type] = line.split(',').map((s) => s.trim());
        const parsed = holidaySchema.safeParse({ date, name, type: (type || 'PUBLIC').toUpperCase() });
        if (parsed.success) rows.push(parsed.data);
        else errors.push(`Line ${i + 1}: ${parsed.error.issues[0].message}`);
      });
    const res = await this.prisma.holiday.createMany({ data: rows.map((r) => ({ ...r, date: dateOnly(r.date), companyId: u.companyId })), skipDuplicates: true });
    await this.audit.log(u, { action: 'IMPORT', module: 'LEAVE', entity: 'Holiday', newValue: { imported: res.count, errors: errors.length } }, m);
    return { imported: res.count, skipped: rows.length - res.count, errors };
  }

  @Delete('holidays/:id')
  @HttpCode(204)
  @RequirePermissions('HOLIDAY_MANAGE')
  async deleteHoliday(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() m: RequestMeta) {
    const h = await this.prisma.holiday.findFirst({ where: { id, companyId: u.companyId } });
    if (!h) throw new NotFoundException();
    await this.prisma.holiday.delete({ where: { id } });
    await this.audit.log(u, { action: 'DELETE', module: 'LEAVE', entity: 'Holiday', entityId: id, oldValue: h }, m);
  }
}

@Module({ providers: [LeaveService], controllers: [LeaveController], exports: [LeaveService] })
export class LeaveModule {}
