import { Body, Controller, Delete, Get, HttpCode, Module, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.module';
import { CurrentUser, ReqMeta, RequirePermissions } from '../common/decorators';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { ZodPipe } from '../common/zod.pipe';
import { ymdSchema } from '../common/pagination';
import { DocumentService } from '../templates/templates.module';
import { PayrollService } from './payroll.service';
import { StatutoryService } from './statutory.service';

const salarySchema = z.object({
  effectiveFrom: ymdSchema,
  currency: z.string().length(3).default('LKR'),
  components: z.array(z.object({ code: z.string().min(1), amount: z.number().min(0) })).min(1),
  note: z.string().max(500).optional(),
});
const adjustmentSchema = z.object({
  employeeId: z.string().uuid(),
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
  kind: z.enum(['EARNING', 'DEDUCTION']),
  code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  name: z.string().min(1),
  amount: z.number().positive(),
  epfApplicable: z.boolean().default(false),
  taxable: z.boolean().default(true),
  note: z.string().max(500).optional(),
});
const runSchema = z.object({ year: z.number().int().min(2000).max(2100), month: z.number().int().min(1).max(12) });
const reasonSchema = z.object({ reason: z.string().min(3) });
const versionSchema = z.object({ effectiveFrom: ymdSchema, config: z.unknown(), note: z.string().max(500).optional() });
const componentSchema = z.object({
  code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  name: z.string().min(1),
  isFixed: z.boolean().default(true),
  epfApplicable: z.boolean().default(true),
  taxable: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

@ApiTags('payroll')
@ApiBearerAuth()
@Controller('payroll')
export class PayrollController {
  constructor(
    private readonly svc: PayrollService,
    private readonly statutory: StatutoryService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── Statutory rules ──
  @Get('statutory-rules')
  @RequirePermissions('PAYROLL_VIEW', 'STATUTORY_MANAGE')
  rules(@CurrentUser() u: AuthUser) {
    return this.statutory.list(u.companyId);
  }

  @Post('statutory-rules/:code/versions')
  @RequirePermissions('STATUTORY_MANAGE')
  addVersion(@CurrentUser() u: AuthUser, @Param('code') code: string, @Body(new ZodPipe(versionSchema)) b: z.infer<typeof versionSchema>, @ReqMeta() m: RequestMeta) {
    return this.statutory.addVersion(u, code, b, m);
  }

  // ── Earning components ──
  @Get('components')
  @RequirePermissions('PAYROLL_VIEW', 'SALARY_MANAGE')
  components(@CurrentUser() u: AuthUser) {
    return this.prisma.earningComponent.findMany({ where: { companyId: u.companyId }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
  }

  @Post('components')
  @RequirePermissions('STATUTORY_MANAGE')
  async addComponent(@CurrentUser() u: AuthUser, @Body(new ZodPipe(componentSchema)) b: z.infer<typeof componentSchema>, @ReqMeta() m: RequestMeta) {
    const row = await this.prisma.earningComponent.create({ data: { ...b, companyId: u.companyId } });
    await this.audit.log(u, { action: 'CREATE', module: 'PAYROLL', entity: 'EarningComponent', entityId: row.id, newValue: row }, m);
    return row;
  }

  // ── Salaries & adjustments ──
  @Get('salaries/:employeeId')
  salaryHistory(@CurrentUser() u: AuthUser, @Param('employeeId', ParseUUIDPipe) id: string, @ReqMeta() m: RequestMeta) {
    return this.svc.salaryHistory(u, id, m);
  }

  @Post('salaries/:employeeId')
  @RequirePermissions('SALARY_MANAGE')
  setSalary(@CurrentUser() u: AuthUser, @Param('employeeId', ParseUUIDPipe) id: string, @Body(new ZodPipe(salarySchema)) b: z.infer<typeof salarySchema>, @ReqMeta() m: RequestMeta) {
    return this.svc.setSalary(u, id, b, m);
  }

  @Get('adjustments')
  @RequirePermissions('PAYROLL_VIEW', 'SALARY_MANAGE')
  adjustments(@CurrentUser() u: AuthUser, @Query(new ZodPipe(runSchema.extend({ year: z.coerce.number().int(), month: z.coerce.number().int() }))) q: { year: number; month: number }) {
    return this.svc.listAdjustments(u, q.year, q.month);
  }

  @Post('adjustments')
  @RequirePermissions('SALARY_MANAGE')
  addAdjustment(@CurrentUser() u: AuthUser, @Body(new ZodPipe(adjustmentSchema)) b: z.infer<typeof adjustmentSchema>, @ReqMeta() m: RequestMeta) {
    return this.svc.addAdjustment(u, b, m);
  }

  @Delete('adjustments/:id')
  @HttpCode(204)
  @RequirePermissions('SALARY_MANAGE')
  deleteAdjustment(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() m: RequestMeta) {
    return this.svc.deleteAdjustment(u, id, m);
  }

  // ── Runs ──
  @Get('runs')
  @RequirePermissions('PAYROLL_VIEW')
  runs(@CurrentUser() u: AuthUser) {
    return this.svc.listRuns(u);
  }

  @Post('runs')
  @RequirePermissions('PAYROLL_RUN')
  createRun(@CurrentUser() u: AuthUser, @Body(new ZodPipe(runSchema)) b: z.infer<typeof runSchema>, @ReqMeta() m: RequestMeta) {
    return this.svc.createRun(u, b.year, b.month, m);
  }

  @Get('runs/:id')
  @RequirePermissions('PAYROLL_VIEW')
  getRun(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() m: RequestMeta) {
    return this.svc.getRun(u, id, m);
  }

  @Post('runs/:id/calculate')
  @RequirePermissions('PAYROLL_RUN')
  calculate(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() m: RequestMeta) {
    return this.svc.calculate(u, id, m);
  }

  @Post('runs/:id/approve')
  @RequirePermissions('PAYROLL_APPROVE')
  approve(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() m: RequestMeta) {
    return this.svc.approve(u, id, m);
  }

  @Post('runs/:id/return')
  @RequirePermissions('PAYROLL_APPROVE')
  returnToDraft(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(reasonSchema)) b: { reason: string }, @ReqMeta() m: RequestMeta) {
    return this.svc.returnToDraft(u, id, b.reason, m);
  }

  @Post('runs/:id/post')
  @RequirePermissions('PAYROLL_APPROVE')
  post(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() m: RequestMeta) {
    return this.svc.post(u, id, m);
  }

  @Post('runs/:id/reverse')
  @RequirePermissions('PAYROLL_APPROVE')
  reverse(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(reasonSchema)) b: { reason: string }, @ReqMeta() m: RequestMeta) {
    return this.svc.reverse(u, id, b.reason, m);
  }

  @Post('runs/:id/email-payslips')
  @RequirePermissions('PAYROLL_APPROVE')
  email(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() m: RequestMeta) {
    return this.svc.emailPayslips(u, id, m);
  }

  @Get('runs/:id/reports/:kind')
  @RequirePermissions('PAYROLL_EXPORT')
  async report(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('kind') kind: string, @ReqMeta() m: RequestMeta, @Res() res: Response) {
    const k = z.enum(['epf', 'etf', 'contract-tax', 'apit', 'bank']).parse(kind);
    const csv = await this.svc.report(u, id, k, m);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${k}-${id.slice(0, 8)}.csv"`);
    res.send(csv);
  }

  // ── Payslips ──
  @Get('payslips/me')
  @RequirePermissions('PAYSLIP_VIEW_OWN')
  mine(@CurrentUser() u: AuthUser) {
    return this.svc.myPayslips(u);
  }

  @Get('payslips/:lineId')
  payslip(@CurrentUser() u: AuthUser, @Param('lineId', ParseUUIDPipe) id: string, @ReqMeta() m: RequestMeta) {
    return this.svc.payslip(u, id, m);
  }

  @Get('payslips/:lineId/document')
  async payslipDoc(@CurrentUser() u: AuthUser, @Param('lineId', ParseUUIDPipe) id: string, @Query('lang') lang: string | undefined, @ReqMeta() m: RequestMeta, @Res() res: Response) {
    const doc = await this.svc.payslipDocument(u, id, m, lang && ['en', 'si', 'ta'].includes(lang) ? lang : undefined);
    return DocumentService.send(res, doc, `payslip-${id.slice(0, 8)}`);
  }
}

@Module({ providers: [PayrollService, StatutoryService], controllers: [PayrollController], exports: [PayrollService, StatutoryService] })
export class PayrollModule {}
