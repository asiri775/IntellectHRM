import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Global,
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
import { Prisma } from '@prisma/client';
import { PERMISSION_SCOPES, PERMISSIONS } from '@ihrm/shared';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.module';
import { CurrentUser, ReqMeta, RequirePermissions } from '../common/decorators';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { ZodPipe } from '../common/zod.pipe';
import { pageArgs, pageQuery, toPage } from '../common/pagination';
import { hashPassword, passwordSchema } from '../common/password';
import { PermissionCacheService } from './permission-cache.service';
import { JwtAuthGuard, PermissionsGuard } from './guards';

const userSelect = {
  id: true,
  email: true,
  displayName: true,
  preferredLanguage: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
  employee: { select: { id: true, employeeNo: true, firstName: true, lastName: true } },
  roles: { select: { role: { select: { id: true, code: true, name: true } } } },
} satisfies Prisma.UserSelect;

const createUserSchema = z.object({
  email: z.string().email().toLowerCase(),
  displayName: z.string().min(1),
  password: passwordSchema,
  roleIds: z.array(z.string().uuid()).default([]),
  employeeId: z.string().uuid().optional(),
  preferredLanguage: z.enum(['en', 'si', 'ta']).default('en'),
});
const updateUserSchema = z.object({
  displayName: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
  roleIds: z.array(z.string().uuid()).optional(),
  preferredLanguage: z.enum(['en', 'si', 'ta']).optional(),
  resetPassword: passwordSchema.optional(),
});

const roleSchema = z.object({
  code: z.string().regex(/^[A-Z][A-Z0-9_]+$/, 'UPPER_SNAKE_CASE'),
  name: z.string().min(1),
  description: z.string().optional(),
});
const rolePermsSchema = z.object({
  permissions: z.array(z.object({ code: z.string(), scope: z.enum(PERMISSION_SCOPES) })),
});

@ApiTags('access')
@ApiBearerAuth()
@Controller()
export class AccessController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly perms: PermissionCacheService,
  ) {}

  @Get('permissions')
  @RequirePermissions('ROLE_VIEW')
  catalogue() {
    return PERMISSIONS;
  }

  // ── Users ──
  @Get('users')
  @RequirePermissions('USER_VIEW', 'USER_MANAGE')
  async listUsers(@CurrentUser() user: AuthUser, @Query(new ZodPipe(pageQuery)) q: z.infer<typeof pageQuery>) {
    const where: Prisma.UserWhereInput = {
      companyId: user.companyId,
      ...(q.search ? { OR: [{ email: { contains: q.search, mode: 'insensitive' } }, { displayName: { contains: q.search, mode: 'insensitive' } }] } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({ where, select: userSelect, orderBy: { displayName: 'asc' }, ...pageArgs(q) }),
      this.prisma.user.count({ where }),
    ]);
    return toPage(items, total, q);
  }

  @Post('users')
  @RequirePermissions('USER_MANAGE')
  async createUser(@CurrentUser() user: AuthUser, @Body(new ZodPipe(createUserSchema)) body: z.infer<typeof createUserSchema>, @ReqMeta() meta: RequestMeta) {
    if (await this.prisma.user.findUnique({ where: { email: body.email } })) throw new ConflictException('Email already in use');
    await this.assertRoles(user, body.roleIds);
    const created = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          companyId: user.companyId,
          email: body.email,
          displayName: body.displayName,
          passwordHash: await hashPassword(body.password),
          preferredLanguage: body.preferredLanguage,
          mustChangePassword: true,
          createdBy: user.userId,
          roles: { create: body.roleIds.map((roleId) => ({ roleId })) },
        },
        select: userSelect,
      });
      if (body.employeeId) {
        const emp = await tx.employee.findFirst({ where: { id: body.employeeId, companyId: user.companyId } });
        if (!emp) throw new BadRequestException('Employee not found');
        await tx.employee.update({ where: { id: emp.id }, data: { userId: u.id } });
      }
      await this.audit.log(user, { action: 'CREATE', module: 'ADMIN', entity: 'User', entityId: u.id, newValue: { email: u.email, roles: body.roleIds } }, meta, tx);
      return u;
    });
    return created;
  }

  @Patch('users/:id')
  @RequirePermissions('USER_MANAGE')
  async updateUser(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateUserSchema)) body: z.infer<typeof updateUserSchema>,
    @ReqMeta() meta: RequestMeta,
  ) {
    const existing = await this.prisma.user.findFirst({ where: { id, companyId: user.companyId }, select: userSelect });
    if (!existing) throw new NotFoundException();
    if (id === user.userId && body.isActive === false) throw new BadRequestException('You cannot deactivate your own account');
    if (body.roleIds) await this.assertRoles(user, body.roleIds);
    const updated = await this.prisma.$transaction(async (tx) => {
      if (body.roleIds) {
        await tx.userRole.deleteMany({ where: { userId: id } });
        await tx.userRole.createMany({ data: body.roleIds.map((roleId) => ({ userId: id, roleId })) });
      }
      const u = await tx.user.update({
        where: { id },
        data: {
          displayName: body.displayName,
          isActive: body.isActive,
          preferredLanguage: body.preferredLanguage,
          updatedBy: user.userId,
          ...(body.resetPassword ? { passwordHash: await hashPassword(body.resetPassword), mustChangePassword: true } : {}),
        },
        select: userSelect,
      });
      if (body.isActive === false || body.resetPassword) {
        await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      await this.audit.log(
        user,
        { action: 'UPDATE', module: 'ADMIN', entity: 'User', entityId: id, oldValue: existing, newValue: { ...u, passwordReset: !!body.resetPassword } },
        meta,
        tx,
      );
      return u;
    });
    this.perms.invalidate(id);
    return updated;
  }

  // ── Roles ──
  @Get('roles')
  @RequirePermissions('ROLE_VIEW', 'USER_MANAGE')
  roles(@CurrentUser() user: AuthUser) {
    return this.prisma.role.findMany({
      where: { companyId: user.companyId },
      orderBy: { name: 'asc' },
      include: { permissions: { include: { permission: { select: { code: true } } } }, _count: { select: { users: true } } },
    });
  }

  @Post('roles')
  @RequirePermissions('ROLE_MANAGE')
  async createRole(@CurrentUser() user: AuthUser, @Body(new ZodPipe(roleSchema)) body: z.infer<typeof roleSchema>, @ReqMeta() meta: RequestMeta) {
    try {
      const role = await this.prisma.role.create({ data: { ...body, companyId: user.companyId } });
      await this.audit.log(user, { action: 'CREATE', module: 'ADMIN', entity: 'Role', entityId: role.id, newValue: role }, meta);
      return role;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('Role code already exists');
      throw e;
    }
  }

  @Put('roles/:id/permissions')
  @RequirePermissions('ROLE_MANAGE')
  async setRolePermissions(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(rolePermsSchema)) body: z.infer<typeof rolePermsSchema>,
    @ReqMeta() meta: RequestMeta,
  ) {
    const role = await this.prisma.role.findFirst({
      where: { id, companyId: user.companyId },
      include: { permissions: { include: { permission: true } } },
    });
    if (!role) throw new NotFoundException();
    if (role.code === 'SUPER_ADMIN') throw new BadRequestException('SUPER_ADMIN always has every permission');
    const catalogue = await this.prisma.permission.findMany({ where: { code: { in: body.permissions.map((p) => p.code) } } });
    const byCode = new Map(catalogue.map((p) => [p.code, p.id]));
    const unknown = body.permissions.filter((p) => !byCode.has(p.code));
    if (unknown.length) throw new BadRequestException(`Unknown permissions: ${unknown.map((u) => u.code).join(', ')}`);
    await this.prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId: id } });
      await tx.rolePermission.createMany({
        data: body.permissions.map((p) => ({ roleId: id, permissionId: byCode.get(p.code)!, scope: p.scope })),
      });
      await this.audit.log(
        user,
        {
          action: 'SET_PERMISSIONS',
          module: 'ADMIN',
          entity: 'Role',
          entityId: id,
          oldValue: role.permissions.map((p) => ({ code: p.permission.code, scope: p.scope })),
          newValue: body.permissions,
        },
        meta,
        tx,
      );
    });
    this.perms.invalidate();
    return { ok: true };
  }

  private async assertRoles(user: AuthUser, roleIds: string[]) {
    if (!roleIds.length) return;
    const count = await this.prisma.role.count({ where: { id: { in: roleIds }, companyId: user.companyId } });
    if (count !== roleIds.length) throw new BadRequestException('One or more roles not found');
    // Only a super admin can grant SUPER_ADMIN.
    const granting = await this.prisma.role.findMany({ where: { id: { in: roleIds } }, select: { code: true } });
    if (granting.some((r) => r.code === 'SUPER_ADMIN') && !user.roles.includes('SUPER_ADMIN')) {
      throw new BadRequestException('Only a super admin can grant SUPER_ADMIN');
    }
  }
}

@Global()
@Module({
  providers: [PermissionCacheService, JwtAuthGuard, PermissionsGuard],
  controllers: [AccessController],
  exports: [PermissionCacheService, JwtAuthGuard, PermissionsGuard],
})
export class AccessModule {}
