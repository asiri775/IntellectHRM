import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, type EarningComponent } from '@prisma/client';
import {
  buildPayrollJournal,
  calculatePayslip,
  eachDate,
  isoWeekday,
  type EarningInput,
  type PayslipResult,
} from '@ihrm/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.module';
import { CryptoService } from '../common/crypto.service';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { dateOnly, ymd } from '../common/pagination';
import { employeeScope, hasPermission } from '../common/scope';
import { SequenceService } from '../settings/sequence.service';
import { ExchangeRateService, NotificationService } from '../settings/settings.module';
import { DocumentService } from '../templates/templates.module';
import { localiseLine, PAYSLIP_LABELS, PAYSLIP_LINE_NAMES, periodName } from '../templates/defaults';
import { MailService } from '../mail/mail.module';
import { StatutoryService } from './statutory.service';

const n = (d: Prisma.Decimal | number | null | undefined) => Number(d ?? 0);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const periodLabel = (year: number, month: number) => `${MONTHS[month - 1]} ${year}`;

export interface SalaryComponentInput {
  code: string;
  amount: number;
}

@Injectable()
export class PayrollService {
  private readonly logger = new Logger(PayrollService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
    private readonly seq: SequenceService,
    private readonly fx: ExchangeRateService,
    private readonly statutory: StatutoryService,
    private readonly docs: DocumentService,
    private readonly mail: MailService,
    private readonly notify: NotificationService,
  ) {}

  // ───────────── Salaries ─────────────

  async salaryHistory(user: AuthUser, employeeId: string, meta: RequestMeta) {
    const isSelf = employeeId === user.employeeId;
    if (!isSelf) {
      const emp = await this.prisma.employee.findFirst({ where: { AND: [employeeScope(user, 'PAYROLL_VIEW'), { id: employeeId }] } });
      if (!emp) throw new NotFoundException('Employee not found');
      await this.audit.log(user, { action: 'VIEW_SALARY', module: 'PAYROLL', entity: 'Employee', entityId: employeeId }, meta);
    }
    return this.prisma.employeeSalary.findMany({ where: { employeeId, companyId: user.companyId }, orderBy: { effectiveFrom: 'desc' } });
  }

  async setSalary(user: AuthUser, employeeId: string, b: { effectiveFrom: string; currency: string; components: SalaryComponentInput[]; note?: string }, meta: RequestMeta) {
    const emp = await this.prisma.employee.findFirst({ where: { AND: [employeeScope(user, 'SALARY_MANAGE'), { id: employeeId }] } });
    if (!emp) throw new NotFoundException('Employee not found');
    if (!b.components.some((c) => c.code === 'BASIC' && c.amount > 0)) throw new BadRequestException('Salary must include a BASIC component greater than zero');
    const known = await this.prisma.earningComponent.findMany({ where: { companyId: user.companyId, code: { in: b.components.map((c) => c.code) }, isActive: true } });
    const unknown = b.components.filter((c) => !known.some((k) => k.code === c.code));
    if (unknown.length) throw new BadRequestException(`Unknown earning components: ${unknown.map((u) => u.code).join(', ')}`);
    const locked = await this.prisma.payrollRun.findFirst({
      where: { companyId: user.companyId, status: { in: ['APPROVED', 'POSTED'] }, periodEnd: { gte: dateOnly(b.effectiveFrom) }, lines: { some: { employeeId } } },
    });
    if (locked) throw new BadRequestException(`Payroll ${locked.number} is already approved/posted for this period; use a later effective date or an adjustment`);
    if (b.currency !== 'LKR') await this.fx.toLkr(user.companyId, b.currency, dateOnly(b.effectiveFrom)); // must have a rate
    const prev = await this.prisma.employeeSalary.findFirst({ where: { employeeId }, orderBy: { effectiveFrom: 'desc' } });
    const row = await this.prisma.employeeSalary.create({
      data: { companyId: user.companyId, employeeId, effectiveFrom: dateOnly(b.effectiveFrom), currency: b.currency, components: b.components as unknown as Prisma.InputJsonValue, note: b.note, createdBy: user.userId },
    });
    await this.audit.log(user, { action: 'SET_SALARY', module: 'PAYROLL', entity: 'EmployeeSalary', entityId: row.id, oldValue: prev, newValue: row, reason: b.note }, meta);
    return row;
  }

  async addAdjustment(
    user: AuthUser,
    b: { employeeId: string; year: number; month: number; kind: 'EARNING' | 'DEDUCTION'; code: string; name: string; amount: number; epfApplicable: boolean; taxable: boolean; note?: string },
    meta: RequestMeta,
  ) {
    const emp = await this.prisma.employee.findFirst({ where: { AND: [employeeScope(user, 'SALARY_MANAGE'), { id: b.employeeId }] } });
    if (!emp) throw new NotFoundException('Employee not found');
    await this.assertPeriodOpen(user.companyId, b.year, b.month);
    const row = await this.prisma.payrollAdjustment.create({ data: { ...b, companyId: user.companyId, createdBy: user.userId } });
    await this.audit.log(user, { action: 'ADD_ADJUSTMENT', module: 'PAYROLL', entity: 'PayrollAdjustment', entityId: row.id, newValue: row }, meta);
    return row;
  }

  async deleteAdjustment(user: AuthUser, id: string, meta: RequestMeta) {
    const row = await this.prisma.payrollAdjustment.findFirst({ where: { id, companyId: user.companyId } });
    if (!row) throw new NotFoundException();
    await this.assertPeriodOpen(user.companyId, row.year, row.month);
    await this.prisma.payrollAdjustment.delete({ where: { id } });
    await this.audit.log(user, { action: 'DELETE_ADJUSTMENT', module: 'PAYROLL', entity: 'PayrollAdjustment', entityId: id, oldValue: row }, meta);
  }

  listAdjustments(user: AuthUser, year: number, month: number) {
    return this.prisma.payrollAdjustment.findMany({
      where: { companyId: user.companyId, year, month },
      include: { employee: { select: { id: true, employeeNo: true, firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async assertPeriodOpen(companyId: string, year: number, month: number) {
    const run = await this.prisma.payrollRun.findFirst({ where: { companyId, year, month, status: { in: ['APPROVED', 'POSTED'] } } });
    if (run) throw new BadRequestException(`Payroll ${run.number} for ${periodLabel(year, month)} is ${run.status.toLowerCase()}; adjustments are locked`);
  }

  // ───────────── Runs ─────────────

  async listRuns(user: AuthUser) {
    return this.prisma.payrollRun.findMany({
      where: { companyId: user.companyId },
      orderBy: [{ year: 'desc' }, { month: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true, number: true, year: true, month: true, status: true, employeeCount: true, totalGross: true, totalNet: true,
        totalEpfEmployee: true, totalEpfEmployer: true, totalEtf: true, totalApit: true, totalContractTax: true, totalEmployerCost: true,
        calculatedAt: true, approvedAt: true, postedAt: true, reversedAt: true, createdAt: true,
      },
      take: 120,
    });
  }

  async createRun(user: AuthUser, year: number, month: number, meta: RequestMeta) {
    const active = await this.prisma.payrollRun.findFirst({ where: { companyId: user.companyId, year, month, status: { not: 'REVERSED' } } });
    if (active) throw new ConflictException(`Payroll ${active.number} already exists for ${periodLabel(year, month)}`);
    const periodStart = dateOnly(`${year}-${String(month).padStart(2, '0')}-01`);
    const periodEnd = new Date(Date.UTC(year, month, 0));
    return this.prisma.$transaction(async (tx) => {
      const number = await this.seq.next(user.companyId, 'PAYROLL_RUN', tx, periodStart);
      const run = await tx.payrollRun.create({ data: { companyId: user.companyId, number, year, month, periodStart, periodEnd, createdBy: user.userId } });
      await this.audit.log(user, { action: 'CREATE', module: 'PAYROLL', entity: 'PayrollRun', entityId: run.id, newValue: { number, year, month } }, meta, tx);
      return run;
    });
  }

  /**
   * Calculate every employee's payslip for the run's period. Inputs (attendance,
   * no-pay leave, salaries, adjustments, rule versions) are read once in bulk and
   * the calculation is pure, so 1,000 employees take seconds.
   */
  async calculate(user: AuthUser, runId: string, meta: RequestMeta) {
    const run = await this.prisma.payrollRun.findFirst({ where: { id: runId, companyId: user.companyId } });
    if (!run) throw new NotFoundException();
    if (!['DRAFT', 'CALCULATED'].includes(run.status)) throw new BadRequestException(`A ${run.status.toLowerCase()} payroll cannot be recalculated`);

    const start = ymd(run.periodStart);
    const end = ymd(run.periodEnd);
    const { rules, versions } = await this.statutory.ruleSetAt(user.companyId, run.periodEnd);

    const [employees, components, holidays, adjustments, leaves, defaultSchedule] = await Promise.all([
      this.prisma.employee.findMany({
        where: {
          companyId: user.companyId,
          deletedAt: null,
          joiningDate: { lte: run.periodEnd },
          OR: [{ leavingDate: null }, { leavingDate: { gte: run.periodStart } }],
          salaries: { some: { effectiveFrom: { lte: run.periodEnd } } },
        },
        include: { salaries: { where: { effectiveFrom: { lte: run.periodEnd } }, orderBy: { effectiveFrom: 'desc' }, take: 1 }, workSchedule: true },
      }),
      this.prisma.earningComponent.findMany({ where: { companyId: user.companyId } }),
      this.prisma.holiday.findMany({ where: { companyId: user.companyId, date: { gte: run.periodStart, lte: run.periodEnd } } }),
      this.prisma.payrollAdjustment.findMany({ where: { companyId: user.companyId, year: run.year, month: run.month } }),
      this.prisma.leaveRequest.findMany({
        where: { companyId: user.companyId, status: 'APPROVED', leaveType: { isPaid: false }, startDate: { lte: run.periodEnd }, endDate: { gte: run.periodStart } },
      }),
      this.prisma.workSchedule.findFirst({ where: { companyId: user.companyId, isDefault: true } }),
    ]);
    if (!employees.length) throw new BadRequestException('No employees with a salary effective in this period');

    const compBy = new Map<string, EarningComponent>(components.map((c) => [c.code, c]));
    const holidaySet = new Set(holidays.map((h) => ymd(h.date)));
    const periodDates = eachDate(start, end);
    const fxCache = new Map<string, number>();

    const lines: Prisma.PayrollRunLineCreateManyInput[] = [];
    const lkrSlips: Parameters<typeof buildPayrollJournal>[0] = [];
    const errors: string[] = [];

    for (const e of employees) {
      try {
        const salary = e.salaries[0];
        const workDays = e.workSchedule?.workDays ?? defaultSchedule?.workDays ?? [1, 2, 3, 4, 5];
        const isWork = (d: string) => workDays.includes(isoWeekday(d)) && !holidaySet.has(d);
        const working = periodDates.filter(isWork);
        const from = ymd(e.joiningDate) > start ? ymd(e.joiningDate) : start;
        const to = e.leavingDate && ymd(e.leavingDate) < end ? ymd(e.leavingDate) : end;
        const employedDays = working.filter((d) => d >= from && d <= to).length;

        let noPayDays = 0;
        for (const l of leaves.filter((x) => x.employeeId === e.id)) {
          const ls = ymd(l.startDate);
          const le = ymd(l.endDate);
          const days = working.filter((d) => d >= ls && d <= le).length;
          noPayDays += l.portion === 'FULL' ? days : days > 0 ? 0.5 : 0;
        }

        const earnings: EarningInput[] = (salary.components as unknown as SalaryComponentInput[]).map((c) => {
          const comp = compBy.get(c.code);
          return { code: c.code, name: comp?.name ?? c.code, amount: c.amount, epfApplicable: comp?.epfApplicable ?? true, taxable: comp?.taxable ?? true, fixed: comp?.isFixed ?? true };
        });
        const empAdj = adjustments.filter((a) => a.employeeId === e.id);
        for (const a of empAdj.filter((x) => x.kind === 'EARNING')) {
          earnings.push({ code: a.code, name: a.name, amount: n(a.amount), epfApplicable: a.epfApplicable, taxable: a.taxable, fixed: false });
        }
        const deductions = empAdj.filter((x) => x.kind === 'DEDUCTION').map((a) => ({ code: a.code, name: a.name, amount: n(a.amount) }));

        let fxRate = 1;
        if (salary.currency !== 'LKR') {
          fxRate = fxCache.get(salary.currency) ?? (await this.fx.toLkr(user.companyId, salary.currency, run.periodEnd));
          fxCache.set(salary.currency, fxRate);
        }

        const slip = calculatePayslip(
          { employmentType: e.employmentType, currency: salary.currency, exchangeRateToLkr: fxRate, earnings, deductions, workingDays: working.length || 1, employedDays, noPayDays },
          rules,
        );
        lines.push({
          runId: run.id,
          employeeId: e.id,
          employmentType: e.employmentType,
          currency: salary.currency,
          exchangeRate: fxRate,
          workingDays: working.length,
          employedDays,
          noPayDays,
          totalEarnings: slip.totalEarnings,
          grossEarnings: slip.grossEarnings,
          epfEmployee: slip.epfEmployee,
          epfEmployer: slip.epfEmployer,
          etf: slip.etf,
          apit: slip.apit,
          contractTax: slip.contractTax,
          noPay: slip.noPay,
          otherDeductions: slip.otherDeductions,
          totalDeductions: slip.totalDeductions,
          netPay: slip.netPay,
          gratuityAccrual: slip.gratuityAccrual,
          totalEmployerCost: slip.totalEmployerCost,
          detail: { earnings: slip.earnings, deductions: slip.deductions, employerContributions: slip.employerContributions, trace: slip.trace } as unknown as Prisma.InputJsonValue,
        });
        lkrSlips.push(toLkr(slip));
      } catch (err) {
        errors.push(`${e.employeeNo} ${e.firstName} ${e.lastName}: ${(err as Error).message}`);
      }
    }
    if (errors.length) throw new BadRequestException({ message: 'Payroll could not be calculated for some employees', errors });

    const journal = buildPayrollJournal(lkrSlips);
    const sum = (k: keyof (typeof lkrSlips)[number]) => Math.round(lkrSlips.reduce((s, x) => s + (x[k] as number) * 100, 0)) / 100;

    await this.prisma.$transaction(
      async (tx) => {
        await tx.payrollRunLine.deleteMany({ where: { runId: run.id } });
        await tx.payrollRunLine.createMany({ data: lines });
        await tx.payrollRun.update({
          where: { id: run.id },
          data: {
            status: 'CALCULATED',
            employeeCount: lines.length,
            totalGross: sum('grossEarnings'),
            totalNet: sum('netPay'),
            totalEpfEmployee: sum('epfEmployee'),
            totalEpfEmployer: sum('epfEmployer'),
            totalEtf: sum('etf'),
            totalApit: sum('apit'),
            totalContractTax: sum('contractTax'),
            totalEmployerCost: Math.round(lkrSlips.reduce((s, x) => s + (x.grossEarnings + x.epfEmployer + x.etf + x.gratuityAccrual) * 100, 0)) / 100,
            rulesSnapshot: { versions, rules } as unknown as Prisma.InputJsonValue,
            journal: journal as unknown as Prisma.InputJsonValue,
            calculatedAt: new Date(),
          },
        });
        await this.audit.log(user, { action: 'CALCULATE', module: 'PAYROLL', entity: 'PayrollRun', entityId: run.id, newValue: { employees: lines.length, versions } }, meta, tx);
      },
      { timeout: 120_000 },
    );
    return this.getRun(user, run.id, meta);
  }

  async getRun(user: AuthUser, runId: string, meta: RequestMeta) {
    const run = await this.prisma.payrollRun.findFirst({
      where: { id: runId, companyId: user.companyId },
      include: {
        lines: {
          include: { employee: { select: { id: true, employeeNo: true, firstName: true, lastName: true, department: { select: { name: true } } } } },
          orderBy: { employee: { employeeNo: 'asc' } },
        },
      },
    });
    if (!run) throw new NotFoundException();
    await this.audit.log(user, { action: 'VIEW_RUN', module: 'PAYROLL', entity: 'PayrollRun', entityId: run.id }, meta);
    return run;
  }

  async approve(user: AuthUser, runId: string, meta: RequestMeta) {
    const run = await this.mustRun(user, runId, ['CALCULATED']);
    // Segregation of duties: the person who prepared the payroll should not approve it.
    if (run.createdBy === user.userId && !user.roles.includes('SUPER_ADMIN')) {
      throw new ForbiddenException('Payroll must be approved by someone other than the person who prepared it');
    }
    return this.transition(user, run, 'APPROVED', { approvedAt: new Date(), approvedBy: user.userId }, meta);
  }

  async returnToDraft(user: AuthUser, runId: string, reason: string, meta: RequestMeta) {
    const run = await this.mustRun(user, runId, ['APPROVED']);
    return this.transition(user, run, 'CALCULATED', { approvedAt: null, approvedBy: null }, meta, reason);
  }

  /** Post: payslip numbers are assigned and payslips become visible to employees. */
  async post(user: AuthUser, runId: string, meta: RequestMeta) {
    const run = await this.mustRun(user, runId, ['APPROVED']);
    await this.prisma.$transaction(
      async (tx) => {
        const lines = await tx.payrollRunLine.findMany({ where: { runId }, include: { employee: { select: { employeeNo: true } } }, orderBy: { employee: { employeeNo: 'asc' } } });
        for (const l of lines) {
          const number = await this.seq.next(user.companyId, 'PAYSLIP', tx, run.periodEnd);
          await tx.payrollRunLine.update({ where: { id: l.id }, data: { payslipNumber: number, publishedAt: new Date() } });
        }
        await tx.payrollRun.update({ where: { id: runId }, data: { status: 'POSTED', postedAt: new Date(), postedBy: user.userId } });
        await this.audit.log(user, { action: 'POST', module: 'PAYROLL', entity: 'PayrollRun', entityId: runId, oldValue: { status: run.status }, newValue: { status: 'POSTED', journal: run.journal } }, meta, tx);
      },
      { timeout: 120_000 },
    );
    const lines = await this.prisma.payrollRunLine.findMany({ where: { runId }, include: { employee: { select: { userId: true } } } });
    await this.notify.notify(user.companyId, lines.map((l) => l.employee.userId), { type: 'PAYSLIP_PUBLISHED', title: `Payslip for ${periodLabel(run.year, run.month)}`, link: '/payroll/my-payslips' });
    return this.prisma.payrollRun.findUniqueOrThrow({ where: { id: runId } });
  }

  /** Posted payroll is never edited: it is reversed and a new run is created. */
  async reverse(user: AuthUser, runId: string, reason: string, meta: RequestMeta) {
    const run = await this.mustRun(user, runId, ['POSTED']);
    return this.transition(user, run, 'REVERSED', { reversedAt: new Date() }, meta, reason);
  }

  private async mustRun(user: AuthUser, runId: string, allowed: string[]) {
    const run = await this.prisma.payrollRun.findFirst({ where: { id: runId, companyId: user.companyId } });
    if (!run) throw new NotFoundException();
    if (!allowed.includes(run.status)) throw new BadRequestException(`Payroll is ${run.status.toLowerCase()}; expected ${allowed.join(' or ').toLowerCase()}`);
    return run;
  }

  private async transition(user: AuthUser, run: { id: string; status: string }, status: 'APPROVED' | 'CALCULATED' | 'REVERSED', data: Prisma.PayrollRunUpdateInput, meta: RequestMeta, reason?: string) {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.payrollRun.update({ where: { id: run.id }, data: { ...data, status } });
      await this.audit.log(user, { action: status, module: 'PAYROLL', entity: 'PayrollRun', entityId: run.id, oldValue: { status: run.status }, newValue: { status }, reason }, meta, tx);
      return updated;
    });
  }

  // ───────────── Payslips ─────────────

  async myPayslips(user: AuthUser) {
    if (!user.employeeId) return [];
    return this.prisma.payrollRunLine.findMany({
      where: { employeeId: user.employeeId, run: { status: 'POSTED', companyId: user.companyId } },
      select: { id: true, payslipNumber: true, netPay: true, grossEarnings: true, currency: true, publishedAt: true, run: { select: { year: true, month: true, number: true } } },
      orderBy: [{ run: { year: 'desc' } }, { run: { month: 'desc' } }],
    });
  }

  private loadLine(companyId: string, lineId: string) {
    return this.prisma.payrollRunLine.findFirst({
      where: { id: lineId, run: { companyId } },
      include: {
        run: true,
        employee: { include: { department: { select: { name: true } }, designation: { select: { name: true } } } },
      },
    });
  }

  async payslip(user: AuthUser, lineId: string, meta: RequestMeta) {
    const line = await this.loadLine(user.companyId, lineId);
    if (!line) throw new NotFoundException();
    const own = line.employeeId === user.employeeId;
    if (own) {
      if (line.run.status !== 'POSTED') throw new NotFoundException();
    } else {
      const ok = await this.prisma.employee.findFirst({ where: { AND: [employeeScope(user, 'PAYROLL_VIEW'), { id: line.employeeId }] } });
      if (!ok) throw new NotFoundException();
      await this.audit.log(user, { action: 'VIEW_PAYSLIP', module: 'PAYROLL', entity: 'PayrollRunLine', entityId: line.id }, meta);
    }
    return line;
  }

  async payslipDocument(user: AuthUser, lineId: string, meta: RequestMeta, language?: string) {
    const line = await this.payslip(user, lineId, meta);
    const lang = language ?? line.employee.preferredLanguage ?? 'en';
    return this.docs.generate(user.companyId, 'PAYSLIP', this.payslipContext(line, lang), { language: lang });
  }

  private payslipContext(line: NonNullable<Awaited<ReturnType<PayrollService['loadLine']>>>, lang: string) {
    const d = line.detail as unknown as Pick<PayslipResult, 'earnings' | 'deductions' | 'employerContributions'>;
    const bank = this.crypto.decrypt(line.employee.bankAccountEncrypted);
    return {
      t: PAYSLIP_LABELS[lang] ?? PAYSLIP_LABELS.en,
      period: periodName(line.run.year, line.run.month, lang),
      currency: line.currency,
      earnings: d.earnings.map((x) => localiseLine(x, lang)),
      deductions: d.deductions.map((x) => localiseLine(x, lang)),
      employerContributions: d.employerContributions.map((x) => localiseLine(x, lang)),
      totalEarnings: n(line.totalEarnings),
      totalDeductions: n(line.totalDeductions),
      netPay: n(line.netPay),
      employee: {
        name: `${line.employee.firstName} ${line.employee.lastName}`,
        employeeNo: line.employee.employeeNo,
        designation: line.employee.designation?.name ?? '',
        department: line.employee.department?.name ?? '',
        employmentType: PAYSLIP_LINE_NAMES[lang]?.[line.employmentType] ?? PAYSLIP_LINE_NAMES.en[line.employmentType] ?? line.employmentType,
        epfNumber: line.employee.epfNumber ?? '',
        bank: [line.employee.bankName, this.crypto.mask(bank)].filter(Boolean).join(' '),
      },
      payslip: { number: line.payslipNumber ?? 'DRAFT', workingDays: line.workingDays, employedDays: line.employedDays, noPayDays: n(line.noPayDays) },
    };
  }

  /** Queue payslip emails (PDF attached when a PDF engine is configured). Runs in the background. */
  async emailPayslips(user: AuthUser, runId: string, meta: RequestMeta) {
    const run = await this.mustRun(user, runId, ['POSTED']);
    const lines = await this.prisma.payrollRunLine.findMany({ where: { runId, emailedAt: null }, select: { id: true } });
    await this.audit.log(user, { action: 'EMAIL_PAYSLIPS', module: 'PAYROLL', entity: 'PayrollRun', entityId: runId, newValue: { count: lines.length } }, meta);
    setImmediate(async () => {
      for (const { id } of lines) {
        try {
          const line = await this.loadLine(user.companyId, id);
          if (!line) continue;
          const lang = line.employee.preferredLanguage ?? 'en';
          const ctx = this.payslipContext(line, lang);
          const doc = await this.docs.generate(user.companyId, 'PAYSLIP', ctx, { language: lang });
          await this.mail.send({
            companyId: user.companyId,
            templateKey: 'PAYSLIP_PUBLISHED',
            to: line.employee.email,
            language: lang,
            data: { employee: { name: ctx.employee.name }, period: ctx.period, netPay: ctx.netPay, currency: ctx.currency },
            attachments: doc.pdf
              ? [{ filename: `${line.payslipNumber}.pdf`, contentType: 'application/pdf', content: doc.pdf }]
              : [{ filename: `${line.payslipNumber}.html`, contentType: 'text/html', content: Buffer.from(doc.html) }],
            related: { entity: 'PayrollRunLine', id },
          });
          await this.prisma.payrollRunLine.update({ where: { id }, data: { emailedAt: new Date() } });
        } catch (e) {
          this.logger.error(`Payslip email ${id} failed: ${(e as Error).message}`);
        }
      }
    });
    return { queued: lines.length, run: run.number };
  }

  // ───────────── Statutory reports ─────────────

  async report(user: AuthUser, runId: string, kind: 'epf' | 'etf' | 'contract-tax' | 'apit' | 'bank', meta: RequestMeta) {
    const run = await this.prisma.payrollRun.findFirst({ where: { id: runId, companyId: user.companyId, status: { in: ['APPROVED', 'POSTED'] } } });
    if (!run) throw new BadRequestException('Reports are available for approved or posted payroll');
    if (!hasPermission(user, 'PAYROLL_EXPORT')) throw new ForbiddenException();
    const lines = await this.prisma.payrollRunLine.findMany({ where: { runId }, include: { employee: true }, orderBy: { employee: { employeeNo: 'asc' } } });
    await this.audit.log(user, { action: 'EXPORT_REPORT', module: 'PAYROLL', entity: 'PayrollRun', entityId: runId, newValue: { kind } }, meta);
    const snapshot = run.rulesSnapshot as unknown as { rules: { CONTRACT_EMPLOYEE_TAX: { rate: number; thresholdAmount: number }; EPF_EMPLOYEE: { rate: number } } } | null;
    const epfRate = snapshot?.rules.EPF_EMPLOYEE.rate ?? 0.08;
    const period = `${run.year}-${String(run.month).padStart(2, '0')}`;
    const nic = (e: (typeof lines)[number]['employee']) => this.crypto.decrypt(e.nicEncrypted) ?? '';
    const lkr = (l: (typeof lines)[number], v: Prisma.Decimal) => (n(v) * n(l.exchangeRate)).toFixed(2);
    let header: string[];
    let rows: (string | number)[][];
    switch (kind) {
      case 'epf':
        header = ['Period', 'Employee No', 'Name', 'NIC', 'EPF No', 'Total earnings (EPF base) LKR', 'Employee contribution LKR', 'Employer contribution LKR', 'Total LKR'];
        rows = lines.filter((l) => n(l.epfEmployee) > 0).map((l) => {
          const base = (n(l.epfEmployee) / epfRate) * n(l.exchangeRate);
          return [period, l.employee.employeeNo, l.employee.nameWithInitials ?? `${l.employee.firstName} ${l.employee.lastName}`, nic(l.employee), l.employee.epfNumber ?? '', base.toFixed(2), lkr(l, l.epfEmployee), lkr(l, l.epfEmployer), ((n(l.epfEmployee) + n(l.epfEmployer)) * n(l.exchangeRate)).toFixed(2)];
        });
        break;
      case 'etf':
        header = ['Period', 'Employee No', 'Name', 'NIC', 'EPF No', 'ETF 3% LKR'];
        rows = lines.filter((l) => n(l.etf) > 0).map((l) => [period, l.employee.employeeNo, `${l.employee.firstName} ${l.employee.lastName}`, nic(l.employee), l.employee.epfNumber ?? '', lkr(l, l.etf)]);
        break;
      case 'contract-tax': {
        const ct = snapshot?.rules.CONTRACT_EMPLOYEE_TAX;
        header = ['Period', 'Employee No', 'Name', 'NIC', 'TIN', 'Gross LKR', 'Threshold LKR', 'Rate', 'Deduction LKR'];
        rows = lines.filter((l) => l.employmentType === 'CONTRACT').map((l) => [
          period, l.employee.employeeNo, `${l.employee.firstName} ${l.employee.lastName}`, nic(l.employee), this.crypto.decrypt(l.employee.tinEncrypted) ?? '',
          lkr(l, l.grossEarnings), ct?.thresholdAmount ?? '', ct ? `${ct.rate * 100}%` : '', lkr(l, l.contractTax),
        ]);
        break;
      }
      case 'apit':
        header = ['Period', 'Employee No', 'Name', 'NIC', 'TIN', 'Gross LKR', 'APIT LKR'];
        rows = lines.filter((l) => n(l.apit) > 0).map((l) => [period, l.employee.employeeNo, `${l.employee.firstName} ${l.employee.lastName}`, nic(l.employee), this.crypto.decrypt(l.employee.tinEncrypted) ?? '', lkr(l, l.grossEarnings), lkr(l, l.apit)]);
        break;
      case 'bank':
        header = ['Employee No', 'Name', 'Bank', 'Branch', 'Account', 'Currency', 'Net pay', 'Reference'];
        rows = lines.map((l) => [l.employee.employeeNo, `${l.employee.firstName} ${l.employee.lastName}`, l.employee.bankName ?? '', l.employee.bankBranch ?? '', this.crypto.decrypt(l.employee.bankAccountEncrypted) ?? '', l.currency, n(l.netPay).toFixed(2), `SALARY ${period}`]);
        break;
    }
    const esc = (v: unknown) => {
      const s = String(v ?? '');
      const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
      return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    return [header, ...rows].map((r) => r.map(esc).join(',')).join('\n');
  }
}

/** Convert a payslip to LKR for the base-currency journal, keeping it balanced. */
function toLkr(s: PayslipResult) {
  const r = s.exchangeRateToLkr;
  const c = (v: number) => Math.round(v * r * 100) / 100;
  const gross = c(s.grossEarnings);
  const epfEmployee = c(s.epfEmployee);
  const apit = c(s.apit);
  const contractTax = c(s.contractTax);
  const otherDeductions = c(s.otherDeductions);
  return {
    grossEarnings: gross,
    epfEmployee,
    epfEmployer: c(s.epfEmployer),
    etf: c(s.etf),
    apit,
    contractTax,
    otherDeductions,
    gratuityAccrual: c(s.gratuityAccrual),
    netPay: Math.round((gross - epfEmployee - apit - contractTax - otherDeductions) * 100) / 100,
  };
}
