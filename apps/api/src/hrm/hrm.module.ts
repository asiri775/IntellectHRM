import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Prisma } from '@prisma/client';
import { EMPLOYMENT_STATUSES, EMPLOYMENT_TYPES, isValidNic, normalizeNic } from '@ihrm/shared';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.module';
import { CryptoService } from '../common/crypto.service';
import { CurrentUser, ReqMeta, RequirePermissions } from '../common/decorators';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { ZodPipe } from '../common/zod.pipe';
import { dateOnly, pageArgs, pageQuery, toPage, ymd, ymdSchema } from '../common/pagination';
import { employeeScope, hasPermission } from '../common/scope';
import { SequenceService } from '../settings/sequence.service';
import { DOCUMENT_TYPES, StorageService, type UploadedFileLike } from '../files/files.module';
import { MailService } from '../mail/mail.module';
import { hashPassword, passwordSchema } from '../common/password';
import { LeaveModule, LeaveService } from '../leave/leave.module';

const nic = z
  .string()
  .trim()
  .refine(isValidNic, 'NIC must be 9 digits + V/X or 12 digits')
  .transform(normalizeNic);

const employeeBase = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  nameWithInitials: z.string().nullable().optional(),
  preferredName: z.string().nullable().optional(),
  email: z.string().email().toLowerCase(),
  phone: z.string().nullable().optional(),
  dateOfBirth: ymdSchema.nullable().optional(),
  gender: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  emergencyContact: z.object({ name: z.string(), relationship: z.string().optional(), phone: z.string() }).nullable().optional(),
  joiningDate: ymdSchema,
  employmentType: z.enum(EMPLOYMENT_TYPES),
  departmentId: z.string().uuid().nullable().optional(),
  teamId: z.string().uuid().nullable().optional(),
  designationId: z.string().uuid().nullable().optional(),
  managerId: z.string().uuid().nullable().optional(),
  locationId: z.string().uuid().nullable().optional(),
  workScheduleId: z.string().uuid().nullable().optional(),
  timezone: z.string().default('Asia/Colombo'),
  preferredLanguage: z.enum(['en', 'si', 'ta']).default('en'),
  nic: nic.nullable().optional(),
  passportNumber: z.string().nullable().optional(),
  epfNumber: z.string().nullable().optional(),
  tin: z.string().nullable().optional(),
  bankName: z.string().nullable().optional(),
  bankBranch: z.string().nullable().optional(),
  bankAccountNumber: z.string().regex(/^[0-9 -]{4,30}$/, 'Digits only').nullable().optional(),
});

const createSchema = employeeBase
  .extend({
    contractStartDate: ymdSchema.optional(),
    contractEndDate: ymdSchema.optional(),
    createUser: z
      .object({ password: passwordSchema, roleCodes: z.array(z.string()).default(['EMPLOYEE']), sendWelcomeEmail: z.boolean().default(true) })
      .optional(),
  })
  .superRefine((v, ctx) => {
    if (v.employmentType === 'CONTRACT' && (!v.contractStartDate || !v.contractEndDate)) {
      ctx.addIssue({ code: 'custom', path: ['contractEndDate'], message: 'Contract employees need contract start and end dates' });
    }
    if (v.contractStartDate && v.contractEndDate && v.contractEndDate < v.contractStartDate) {
      ctx.addIssue({ code: 'custom', path: ['contractEndDate'], message: 'End date is before start date' });
    }
  });

const updateSchema = employeeBase.partial().extend({
  employmentStatus: z.enum(EMPLOYMENT_STATUSES).optional(),
  leavingDate: ymdSchema.nullable().optional(),
});

const listSchema = pageQuery.extend({
  departmentId: z.string().uuid().optional(),
  employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
  status: z.enum(EMPLOYMENT_STATUSES).optional(),
  contractEndingWithinDays: z.coerce.number().int().positive().optional(),
});

const contractSchema = z
  .object({
    employmentType: z.enum(EMPLOYMENT_TYPES),
    startDate: ymdSchema,
    endDate: ymdSchema.nullable().optional(),
    notes: z.string().optional(),
  })
  .refine((v) => v.employmentType !== 'CONTRACT' || !!v.endDate, { path: ['endDate'], message: 'Contract needs an end date' });

const listInclude = {
  department: { select: { id: true, name: true } },
  designation: { select: { id: true, name: true } },
  manager: { select: { id: true, firstName: true, lastName: true } },
  team: { select: { id: true, name: true } },
} satisfies Prisma.EmployeeInclude;

@Injectable()
export class EmployeeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly seq: SequenceService,
    private readonly mail: MailService,
    private readonly leave: LeaveService,
  ) {}

  async list(user: AuthUser, q: z.infer<typeof listSchema>) {
    const where: Prisma.EmployeeWhereInput = {
      AND: [
        employeeScope(user, 'EMPLOYEE_VIEW'),
        q.search
          ? {
              OR: [
                { firstName: { contains: q.search, mode: 'insensitive' } },
                { lastName: { contains: q.search, mode: 'insensitive' } },
                { email: { contains: q.search, mode: 'insensitive' } },
                { employeeNo: { contains: q.search, mode: 'insensitive' } },
              ],
            }
          : {},
        q.departmentId ? { departmentId: q.departmentId } : {},
        q.employmentType ? { employmentType: q.employmentType } : {},
        q.status ? { employmentStatus: q.status } : {},
        q.contractEndingWithinDays
          ? {
              contracts: {
                some: { status: 'ACTIVE', endDate: { gte: dateOnly(ymd(new Date())), lte: new Date(Date.now() + q.contractEndingWithinDays * 86400000) } },
              },
            }
          : {},
      ],
    };
    const [items, total] = await Promise.all([
      this.prisma.employee.findMany({
        where,
        include: { ...listInclude, contracts: { where: { status: 'ACTIVE' }, select: { endDate: true }, take: 1, orderBy: { startDate: 'desc' } } },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
        ...pageArgs(q),
      }),
      this.prisma.employee.count({ where }),
    ]);
    return toPage(items.map((e) => this.present(e, false)), total, q);
  }

  async get(user: AuthUser, id: string, meta: RequestMeta) {
    const e = await this.prisma.employee.findFirst({
      where: { AND: [employeeScope(user, 'EMPLOYEE_VIEW'), { id }] },
      include: {
        ...listInclude,
        location: { select: { id: true, name: true } },
        workSchedule: true,
        user: { select: { id: true, email: true, isActive: true } },
        contracts: { orderBy: { startDate: 'desc' } },
      },
    });
    if (!e) throw new NotFoundException('Employee not found');
    // Sensitive data: only with explicit permission (own record always visible to self), and every view is audited.
    const canSeeSensitive = hasPermission(user, 'EMPLOYEE_SENSITIVE_VIEW') || e.id === user.employeeId;
    if (canSeeSensitive && e.id !== user.employeeId) {
      await this.audit.log(user, { action: 'VIEW_SENSITIVE', module: 'HRM', entity: 'Employee', entityId: e.id }, meta);
    }
    return this.present(e, canSeeSensitive);
  }

  async create(user: AuthUser, b: z.infer<typeof createSchema>, meta: RequestMeta) {
    const nicHash = this.crypto.blindIndex(b.nic ?? null);
    if (nicHash && (await this.prisma.employee.findFirst({ where: { companyId: user.companyId, nicHash } }))) {
      throw new ConflictException('An employee with this NIC already exists');
    }
    await this.assertRefs(user, b);
    if (b.createUser && (await this.prisma.user.findUnique({ where: { email: b.email } }))) {
      throw new ConflictException('A user account with this email already exists');
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const employeeNo = await this.seq.next(user.companyId, 'EMPLOYEE', tx);
      let userId: string | undefined;
      if (b.createUser) {
        const roles = await tx.role.findMany({ where: { companyId: user.companyId, code: { in: b.createUser.roleCodes } } });
        if (roles.some((r) => r.code === 'SUPER_ADMIN') && !user.roles.includes('SUPER_ADMIN')) throw new BadRequestException('Only a super admin can grant SUPER_ADMIN');
        const u = await tx.user.create({
          data: {
            companyId: user.companyId,
            email: b.email,
            displayName: `${b.preferredName || b.firstName} ${b.lastName}`,
            passwordHash: await hashPassword(b.createUser.password),
            preferredLanguage: b.preferredLanguage,
            mustChangePassword: true,
            createdBy: user.userId,
            roles: { create: roles.map((r) => ({ roleId: r.id })) },
          },
        });
        userId = u.id;
      }
      const defaultSchedule = b.workScheduleId ? null : await tx.workSchedule.findFirst({ where: { companyId: user.companyId, isDefault: true } });
      const e = await tx.employee.create({
        data: {
          ...this.toData(b),
          companyId: user.companyId,
          employeeNo,
          userId,
          workScheduleId: b.workScheduleId ?? defaultSchedule?.id ?? null,
          joiningDate: dateOnly(b.joiningDate),
          createdBy: user.userId,
        },
      });
      await tx.employmentContract.create({
        data: {
          companyId: user.companyId,
          employeeId: e.id,
          employmentType: b.employmentType,
          startDate: dateOnly(b.contractStartDate ?? b.joiningDate),
          endDate: b.contractEndDate ? dateOnly(b.contractEndDate) : null,
          createdBy: user.userId,
        },
      });
      await this.leave.ensureBalances(user.companyId, e.id, new Date().getFullYear(), tx);
      await this.audit.log(user, { action: 'CREATE', module: 'HRM', entity: 'Employee', entityId: e.id, newValue: { ...e, nic: b.nic ? '[set]' : null } }, meta, tx);
      return e;
    });

    if (b.createUser?.sendWelcomeEmail) {
      await this.mail.send({
        companyId: user.companyId,
        templateKey: 'WELCOME_USER',
        to: b.email,
        language: b.preferredLanguage,
        data: { user: { displayName: `${b.firstName} ${b.lastName}`, email: b.email } },
        related: { entity: 'Employee', id: created.id },
      });
    }
    return this.get(user, created.id, meta);
  }

  async update(user: AuthUser, id: string, b: z.infer<typeof updateSchema>, meta: RequestMeta) {
    const old = await this.prisma.employee.findFirst({ where: { AND: [employeeScope(user, 'EMPLOYEE_EDIT'), { id }] } });
    if (!old) throw new NotFoundException('Employee not found');
    const touchesSensitive = ['nic', 'passportNumber', 'tin', 'bankAccountNumber'].some((k) => k in b);
    if (touchesSensitive && !hasPermission(user, 'EMPLOYEE_SENSITIVE_VIEW')) throw new BadRequestException('You cannot edit sensitive fields');
    if (b.managerId === id) throw new BadRequestException('An employee cannot be their own manager');
    await this.assertRefs(user, b);
    if (b.nic) {
      const hash = this.crypto.blindIndex(b.nic);
      const dup = await this.prisma.employee.findFirst({ where: { companyId: user.companyId, nicHash: hash, id: { not: id } } });
      if (dup) throw new ConflictException('An employee with this NIC already exists');
    }
    const e = await this.prisma.$transaction(async (tx) => {
      const row = await tx.employee.update({
        where: { id },
        data: {
          ...this.toData(b),
          joiningDate: b.joiningDate ? dateOnly(b.joiningDate) : undefined,
          employmentStatus: b.employmentStatus,
          leavingDate: b.leavingDate === undefined ? undefined : b.leavingDate ? dateOnly(b.leavingDate) : null,
          updatedBy: user.userId,
        },
      });
      if (b.employmentStatus && !['ACTIVE', 'ON_NOTICE'].includes(b.employmentStatus) && row.userId) {
        // Leavers lose access immediately.
        await tx.user.update({ where: { id: row.userId }, data: { isActive: false } });
        await tx.refreshToken.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      await this.audit.log(user, { action: 'UPDATE', module: 'HRM', entity: 'Employee', entityId: id, oldValue: old, newValue: row }, meta, tx);
      return row;
    });
    return this.get(user, e.id, meta);
  }

  async archive(user: AuthUser, id: string, meta: RequestMeta) {
    const old = await this.prisma.employee.findFirst({ where: { AND: [employeeScope(user, 'EMPLOYEE_DELETE'), { id }] } });
    if (!old) throw new NotFoundException();
    await this.prisma.$transaction(async (tx) => {
      await tx.employee.update({ where: { id }, data: { deletedAt: new Date(), updatedBy: user.userId } });
      if (old.userId) await tx.user.update({ where: { id: old.userId }, data: { isActive: false } });
      await this.audit.log(user, { action: 'ARCHIVE', module: 'HRM', entity: 'Employee', entityId: id }, meta, tx);
    });
  }

  // ── Contracts ──
  async addContract(user: AuthUser, employeeId: string, b: z.infer<typeof contractSchema>, meta: RequestMeta) {
    const emp = await this.prisma.employee.findFirst({ where: { AND: [employeeScope(user, 'CONTRACT_MANAGE'), { id: employeeId }] } });
    if (!emp) throw new NotFoundException();
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.employmentContract.findFirst({ where: { employeeId, status: 'ACTIVE' }, orderBy: { startDate: 'desc' } });
      if (current) {
        if (b.startDate <= ymd(current.startDate)) throw new BadRequestException('A renewal must start after the current contract started');
        await tx.employmentContract.update({ where: { id: current.id }, data: { status: 'RENEWED' } });
      }
      const c = await tx.employmentContract.create({
        data: {
          companyId: user.companyId,
          employeeId,
          employmentType: b.employmentType,
          startDate: dateOnly(b.startDate),
          endDate: b.endDate ? dateOnly(b.endDate) : null,
          previousContractId: current?.id,
          notes: b.notes,
          createdBy: user.userId,
        },
      });
      await tx.employee.update({ where: { id: employeeId }, data: { employmentType: b.employmentType, employmentStatus: 'ACTIVE' } });
      await this.audit.log(user, { action: current ? 'RENEW_CONTRACT' : 'CREATE_CONTRACT', module: 'HRM', entity: 'EmploymentContract', entityId: c.id, oldValue: current, newValue: c }, meta, tx);
      return c;
    });
  }

  async endContract(user: AuthUser, employeeId: string, contractId: string, endDate: string, meta: RequestMeta) {
    const c = await this.prisma.employmentContract.findFirst({ where: { id: contractId, employeeId, companyId: user.companyId, status: 'ACTIVE' } });
    if (!c) throw new NotFoundException();
    const emp = await this.prisma.employee.findFirst({ where: { AND: [employeeScope(user, 'CONTRACT_MANAGE'), { id: employeeId }] } });
    if (!emp) throw new NotFoundException();
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.employmentContract.update({ where: { id: c.id }, data: { status: 'ENDED', endDate: dateOnly(endDate) } });
      await tx.employee.update({ where: { id: employeeId }, data: { employmentStatus: 'CONTRACT_ENDED', leavingDate: dateOnly(endDate) } });
      if (emp.userId) await tx.user.update({ where: { id: emp.userId }, data: { isActive: false } });
      await this.audit.log(user, { action: 'END_CONTRACT', module: 'HRM', entity: 'EmploymentContract', entityId: c.id, oldValue: c, newValue: row }, meta, tx);
      return row;
    });
  }

  // ── Export ──
  async exportCsv(user: AuthUser, meta: RequestMeta) {
    const rows = await this.prisma.employee.findMany({ where: employeeScope(user, 'EMPLOYEE_EXPORT'), include: listInclude, orderBy: { employeeNo: 'asc' } });
    await this.audit.log(user, { action: 'EXPORT', module: 'HRM', entity: 'Employee', newValue: { count: rows.length } }, meta);
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? '' : String(v);
      // Neutralise spreadsheet formula injection.
      const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
      return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    const header = ['Employee No', 'First name', 'Last name', 'Email', 'Phone', 'Employment type', 'Status', 'Department', 'Designation', 'Manager', 'Joining date', 'EPF No'];
    const lines = rows.map((e) =>
      [
        e.employeeNo,
        e.firstName,
        e.lastName,
        e.email,
        e.phone,
        e.employmentType,
        e.employmentStatus,
        e.department?.name,
        e.designation?.name,
        e.manager ? `${e.manager.firstName} ${e.manager.lastName}` : '',
        ymd(e.joiningDate),
        e.epfNumber,
      ]
        .map(esc)
        .join(','),
    );
    return [header.join(','), ...lines].join('\n');
  }

  private toData(b: Partial<z.infer<typeof employeeBase>>): Prisma.EmployeeUncheckedUpdateInput & Prisma.EmployeeUncheckedCreateInput {
    const d: Record<string, unknown> = {
      firstName: b.firstName,
      lastName: b.lastName,
      nameWithInitials: b.nameWithInitials,
      preferredName: b.preferredName,
      email: b.email,
      phone: b.phone,
      dateOfBirth: b.dateOfBirth === undefined ? undefined : b.dateOfBirth ? dateOnly(b.dateOfBirth) : null,
      gender: b.gender,
      address: b.address,
      emergencyContact: b.emergencyContact === undefined ? undefined : (b.emergencyContact ?? Prisma.JsonNull),
      employmentType: b.employmentType,
      departmentId: b.departmentId,
      teamId: b.teamId,
      designationId: b.designationId,
      managerId: b.managerId,
      locationId: b.locationId,
      workScheduleId: b.workScheduleId,
      timezone: b.timezone,
      preferredLanguage: b.preferredLanguage,
      epfNumber: b.epfNumber,
      bankName: b.bankName,
      bankBranch: b.bankBranch,
    };
    if (b.nic !== undefined) {
      d.nicEncrypted = this.crypto.encrypt(b.nic);
      d.nicHash = this.crypto.blindIndex(b.nic);
    }
    if (b.passportNumber !== undefined) d.passportEncrypted = this.crypto.encrypt(b.passportNumber);
    if (b.tin !== undefined) d.tinEncrypted = this.crypto.encrypt(b.tin);
    if (b.bankAccountNumber !== undefined) d.bankAccountEncrypted = this.crypto.encrypt(b.bankAccountNumber);
    return d as Prisma.EmployeeUncheckedUpdateInput & Prisma.EmployeeUncheckedCreateInput;
  }

  private async assertRefs(user: AuthUser, b: Partial<z.infer<typeof employeeBase>>) {
    const checks: [string | null | undefined, () => Promise<unknown>, string][] = [
      [b.departmentId, () => this.prisma.department.findFirst({ where: { id: b.departmentId!, companyId: user.companyId } }), 'Department'],
      [b.teamId, () => this.prisma.team.findFirst({ where: { id: b.teamId!, companyId: user.companyId } }), 'Team'],
      [b.designationId, () => this.prisma.designation.findFirst({ where: { id: b.designationId!, companyId: user.companyId } }), 'Designation'],
      [b.managerId, () => this.prisma.employee.findFirst({ where: { id: b.managerId!, companyId: user.companyId } }), 'Manager'],
      [b.locationId, () => this.prisma.location.findFirst({ where: { id: b.locationId!, companyId: user.companyId } }), 'Location'],
      [b.workScheduleId, () => this.prisma.workSchedule.findFirst({ where: { id: b.workScheduleId!, companyId: user.companyId } }), 'Work schedule'],
    ];
    for (const [val, find, label] of checks) {
      if (val && !(await find())) throw new BadRequestException(`${label} not found`);
    }
  }

  /** Strip encrypted columns; decrypt or mask sensitive fields. */
  private present<T extends Record<string, unknown>>(e: T & { nicEncrypted?: string | null; passportEncrypted?: string | null; tinEncrypted?: string | null; bankAccountEncrypted?: string | null }, sensitive: boolean) {
    const { nicEncrypted, passportEncrypted, tinEncrypted, bankAccountEncrypted, nicHash: _h, ...rest } = e as typeof e & { nicHash?: string };
    void _h;
    const dec = (v?: string | null) => (v ? this.crypto.decrypt(v) : null);
    return {
      ...rest,
      nic: sensitive ? dec(nicEncrypted) : this.crypto.mask(dec(nicEncrypted)),
      passportNumber: sensitive ? dec(passportEncrypted) : passportEncrypted ? '••••' : null,
      tin: sensitive ? dec(tinEncrypted) : tinEncrypted ? '••••' : null,
      bankAccountNumber: sensitive ? dec(bankAccountEncrypted) : this.crypto.mask(dec(bankAccountEncrypted)),
      sensitiveVisible: sensitive,
    };
  }
}

@ApiTags('employees')
@ApiBearerAuth()
@Controller('employees')
export class EmployeeController {
  constructor(
    private readonly svc: EmployeeService,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions('EMPLOYEE_VIEW')
  list(@CurrentUser() u: AuthUser, @Query(new ZodPipe(listSchema)) q: z.infer<typeof listSchema>) {
    return this.svc.list(u, q);
  }

  @Get('export.csv')
  @RequirePermissions('EMPLOYEE_EXPORT')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="employees.csv"')
  export(@CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.svc.exportCsv(u, m);
  }

  @Get('me')
  async me(@CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    if (!u.employeeId) throw new NotFoundException('Your user account is not linked to an employee record');
    return this.svc.get({ ...u, permissions: { ...u.permissions, EMPLOYEE_VIEW: u.permissions.EMPLOYEE_VIEW ?? 'OWN' } }, u.employeeId, m);
  }

  @Get(':id')
  @RequirePermissions('EMPLOYEE_VIEW')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() m: RequestMeta) {
    return this.svc.get(u, id, m);
  }

  @Post()
  @RequirePermissions('EMPLOYEE_CREATE')
  create(@CurrentUser() u: AuthUser, @Body(new ZodPipe(createSchema)) b: z.infer<typeof createSchema>, @ReqMeta() m: RequestMeta) {
    return this.svc.create(u, b, m);
  }

  @Patch(':id')
  @RequirePermissions('EMPLOYEE_EDIT')
  update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(updateSchema)) b: z.infer<typeof updateSchema>, @ReqMeta() m: RequestMeta) {
    return this.svc.update(u, id, b, m);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('EMPLOYEE_DELETE')
  archive(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() m: RequestMeta) {
    return this.svc.archive(u, id, m);
  }

  @Post(':id/contracts')
  @RequirePermissions('CONTRACT_MANAGE')
  addContract(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(contractSchema)) b: z.infer<typeof contractSchema>, @ReqMeta() m: RequestMeta) {
    return this.svc.addContract(u, id, b, m);
  }

  @Post(':id/contracts/:contractId/end')
  @RequirePermissions('CONTRACT_MANAGE')
  endContract(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('contractId', ParseUUIDPipe) contractId: string,
    @Body(new ZodPipe(z.object({ endDate: ymdSchema }))) b: { endDate: string },
    @ReqMeta() m: RequestMeta,
  ) {
    return this.svc.endContract(u, id, contractId, b.endDate, m);
  }

  // ── Documents ──
  @Get(':id/documents')
  @RequirePermissions('DOCUMENT_VIEW')
  async documents(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.assertEmployee(u, id, 'DOCUMENT_VIEW');
    return this.prisma.employeeDocument.findMany({ where: { employeeId: id, deletedAt: null }, orderBy: [{ category: 'asc' }, { version: 'desc' }] });
  }

  @Post(':id/documents')
  @ApiConsumes('multipart/form-data')
  @RequirePermissions('DOCUMENT_MANAGE')
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: UploadedFileLike,
    @Body(new ZodPipe(z.object({ category: z.string().min(1), name: z.string().min(1), expiryDate: ymdSchema.optional().or(z.literal('').transform(() => undefined)) }))) b: { category: string; name: string; expiryDate?: string },
    @ReqMeta() m: RequestMeta,
  ) {
    await this.assertEmployee(u, id, 'DOCUMENT_MANAGE');
    const stored = await this.storage.save(u.companyId, file, { allowed: DOCUMENT_TYPES, userId: u.userId });
    const prev = await this.prisma.employeeDocument.findFirst({ where: { employeeId: id, category: b.category, name: b.name, deletedAt: null }, orderBy: { version: 'desc' } });
    const doc = await this.prisma.employeeDocument.create({
      data: { companyId: u.companyId, employeeId: id, category: b.category, name: b.name, fileId: stored.id, version: (prev?.version ?? 0) + 1, expiryDate: b.expiryDate ? dateOnly(b.expiryDate) : null, createdBy: u.userId },
    });
    await this.audit.log(u, { action: 'UPLOAD', module: 'HRM', entity: 'EmployeeDocument', entityId: doc.id, newValue: { name: b.name, category: b.category, version: doc.version } }, m);
    return doc;
  }

  @Get(':id/documents/:docId/download')
  @RequirePermissions('DOCUMENT_VIEW')
  async download(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('docId', ParseUUIDPipe) docId: string, @Res({ passthrough: true }) res: Response, @ReqMeta() m: RequestMeta) {
    await this.assertEmployee(u, id, 'DOCUMENT_VIEW');
    const doc = await this.prisma.employeeDocument.findFirst({ where: { id: docId, employeeId: id, deletedAt: null } });
    if (!doc) throw new NotFoundException();
    const f = await this.storage.get(u.companyId, doc.fileId);
    await this.audit.log(u, { action: 'DOWNLOAD', module: 'HRM', entity: 'EmployeeDocument', entityId: doc.id }, m);
    return this.storage.stream(res, f);
  }

  @Delete(':id/documents/:docId')
  @HttpCode(204)
  @RequirePermissions('DOCUMENT_MANAGE')
  async deleteDoc(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('docId', ParseUUIDPipe) docId: string, @ReqMeta() m: RequestMeta) {
    await this.assertEmployee(u, id, 'DOCUMENT_MANAGE');
    const doc = await this.prisma.employeeDocument.findFirst({ where: { id: docId, employeeId: id, deletedAt: null } });
    if (!doc) throw new NotFoundException();
    await this.prisma.employeeDocument.update({ where: { id: docId }, data: { deletedAt: new Date() } });
    await this.audit.log(u, { action: 'DELETE', module: 'HRM', entity: 'EmployeeDocument', entityId: docId }, m);
  }

  private async assertEmployee(u: AuthUser, id: string, code: 'DOCUMENT_VIEW' | 'DOCUMENT_MANAGE') {
    // Document permission scope applies like employee scope.
    const e = await this.prisma.employee.findFirst({ where: { AND: [employeeScope(u, code), { id }] }, select: { id: true } });
    if (!e) throw new NotFoundException('Employee not found');
  }
}

@Module({ imports: [LeaveModule], providers: [EmployeeService], controllers: [EmployeeController], exports: [EmployeeService] })
export class HrmModule {}
