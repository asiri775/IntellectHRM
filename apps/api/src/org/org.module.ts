import { Body, ConflictException, Controller, Get, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.module';
import { CurrentUser, ReqMeta, RequirePermissions } from '../common/decorators';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { ZodPipe } from '../common/zod.pipe';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm');

const deptSchema = z.object({ code: z.string().min(1).max(20), name: z.string().min(1), parentId: z.string().uuid().nullable().optional() });
const teamSchema = z.object({ departmentId: z.string().uuid(), name: z.string().min(1) });
const designationSchema = z.object({ name: z.string().min(1), jobLevel: z.string().nullable().optional() });
const locationSchema = z.object({ name: z.string().min(1), address: z.string().nullable().optional(), timezone: z.string().default('Asia/Colombo') });
const scheduleSchema = z.object({
  name: z.string().min(1),
  startTime: hhmm,
  endTime: hhmm,
  breakMinutes: z.number().int().min(0).max(240),
  graceMinutes: z.number().int().min(0).max(120),
  workDays: z.array(z.number().int().min(1).max(7)).min(1),
  isDefault: z.boolean().default(false),
});

type Kind = 'department' | 'team' | 'designation' | 'location' | 'workSchedule';

@ApiTags('organization')
@ApiBearerAuth()
@Controller('org')
export class OrgController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  /** Everything the employee form needs, in one call. */
  @Get('lookups')
  async lookups(@CurrentUser() user: AuthUser) {
    const where = { companyId: user.companyId };
    const [departments, teams, designations, locations, schedules, managers] = await Promise.all([
      this.prisma.department.findMany({ where: { ...where, deletedAt: null }, orderBy: { name: 'asc' } }),
      this.prisma.team.findMany({ where: { ...where, deletedAt: null }, orderBy: { name: 'asc' } }),
      this.prisma.designation.findMany({ where: { ...where, deletedAt: null }, orderBy: { name: 'asc' } }),
      this.prisma.location.findMany({ where: { ...where, deletedAt: null }, orderBy: { name: 'asc' } }),
      this.prisma.workSchedule.findMany({ where, orderBy: { name: 'asc' } }),
      this.prisma.employee.findMany({
        where: { ...where, deletedAt: null, employmentStatus: { in: ['ACTIVE', 'ON_NOTICE'] } },
        select: { id: true, employeeNo: true, firstName: true, lastName: true },
        orderBy: { firstName: 'asc' },
        take: 2000,
      }),
    ]);
    return { departments, teams, designations, locations, schedules, managers };
  }

  @Post('departments')
  @RequirePermissions('ORG_MANAGE')
  createDept(@CurrentUser() u: AuthUser, @Body(new ZodPipe(deptSchema)) b: z.infer<typeof deptSchema>, @ReqMeta() m: RequestMeta) {
    return this.create(u, m, 'department', () => this.prisma.department.create({ data: { ...b, companyId: u.companyId } }));
  }
  @Patch('departments/:id')
  @RequirePermissions('ORG_MANAGE')
  updateDept(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(deptSchema.partial().extend({ archived: z.boolean().optional() }))) b: Partial<z.infer<typeof deptSchema>> & { archived?: boolean }, @ReqMeta() m: RequestMeta) {
    const { archived, ...data } = b;
    return this.update(u, m, 'department', id, () => this.prisma.department.update({ where: { id }, data: { ...data, deletedAt: archived === undefined ? undefined : archived ? new Date() : null } }));
  }

  @Post('teams')
  @RequirePermissions('ORG_MANAGE')
  async createTeam(@CurrentUser() u: AuthUser, @Body(new ZodPipe(teamSchema)) b: z.infer<typeof teamSchema>, @ReqMeta() m: RequestMeta) {
    const dept = await this.prisma.department.findFirst({ where: { id: b.departmentId, companyId: u.companyId } });
    if (!dept) throw new NotFoundException('Department not found');
    return this.create(u, m, 'team', () => this.prisma.team.create({ data: { ...b, companyId: u.companyId } }));
  }

  @Post('designations')
  @RequirePermissions('ORG_MANAGE')
  createDesignation(@CurrentUser() u: AuthUser, @Body(new ZodPipe(designationSchema)) b: z.infer<typeof designationSchema>, @ReqMeta() m: RequestMeta) {
    return this.create(u, m, 'designation', () => this.prisma.designation.create({ data: { ...b, companyId: u.companyId } }));
  }

  @Post('locations')
  @RequirePermissions('ORG_MANAGE')
  createLocation(@CurrentUser() u: AuthUser, @Body(new ZodPipe(locationSchema)) b: z.infer<typeof locationSchema>, @ReqMeta() m: RequestMeta) {
    return this.create(u, m, 'location', () => this.prisma.location.create({ data: { ...b, companyId: u.companyId } }));
  }

  @Post('work-schedules')
  @RequirePermissions('SCHEDULE_MANAGE')
  async createSchedule(@CurrentUser() u: AuthUser, @Body(new ZodPipe(scheduleSchema)) b: z.infer<typeof scheduleSchema>, @ReqMeta() m: RequestMeta) {
    return this.create(u, m, 'workSchedule', () =>
      this.prisma.$transaction(async (tx) => {
        if (b.isDefault) await tx.workSchedule.updateMany({ where: { companyId: u.companyId }, data: { isDefault: false } });
        return tx.workSchedule.create({ data: { ...b, companyId: u.companyId } });
      }),
    );
  }
  @Patch('work-schedules/:id')
  @RequirePermissions('SCHEDULE_MANAGE')
  async updateSchedule(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(scheduleSchema.partial())) b: Partial<z.infer<typeof scheduleSchema>>, @ReqMeta() m: RequestMeta) {
    return this.update(u, m, 'workSchedule', id, () =>
      this.prisma.$transaction(async (tx) => {
        if (b.isDefault) await tx.workSchedule.updateMany({ where: { companyId: u.companyId }, data: { isDefault: false } });
        return tx.workSchedule.update({ where: { id }, data: b });
      }),
    );
  }

  private async create<T extends { id: string }>(u: AuthUser, m: RequestMeta, kind: Kind, fn: () => Promise<T>) {
    try {
      const row = await fn();
      await this.audit.log(u, { action: 'CREATE', module: 'ORG', entity: kind, entityId: row.id, newValue: row }, m);
      return row;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException(`That ${kind} already exists`);
      throw e;
    }
  }

  private async update<T extends { id: string }>(u: AuthUser, m: RequestMeta, kind: Kind, id: string, fn: () => Promise<T>) {
    const delegate = this.prisma[kind] as unknown as { findFirst(args: unknown): Promise<unknown> };
    const old = await delegate.findFirst({ where: { id, companyId: u.companyId } });
    if (!old) throw new NotFoundException();
    const row = await fn();
    await this.audit.log(u, { action: 'UPDATE', module: 'ORG', entity: kind, entityId: id, oldValue: old, newValue: row }, m);
    return row;
  }
}

@Module({ controllers: [OrgController] })
export class OrgModule {}
