import { ForbiddenException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { PermissionCode, PermissionScope } from '@ihrm/shared';
import type { AuthUser } from './auth-user';

const NO_MATCH = '00000000-0000-0000-0000-000000000000';

export function scopeOf(user: AuthUser, code: PermissionCode): PermissionScope | null {
  return user.permissions[code] ?? null;
}

export function hasPermission(user: AuthUser, code: PermissionCode): boolean {
  return code in user.permissions;
}

export function assertPermission(user: AuthUser, code: PermissionCode): PermissionScope {
  const s = scopeOf(user, code);
  if (!s) throw new ForbiddenException(`Missing permission ${code}`);
  return s;
}

/**
 * Restrict an Employee query to the records the user may see for a permission.
 * OWN: self · TEAM: self + direct reports + same team · DEPARTMENT: same department · COMPANY/ALL: whole company.
 */
export function employeeScope(user: AuthUser, code: PermissionCode): Prisma.EmployeeWhereInput {
  const scope = assertPermission(user, code);
  const base: Prisma.EmployeeWhereInput = { companyId: user.companyId, deletedAt: null };
  switch (scope) {
    case 'ALL':
    case 'COMPANY':
      return base;
    case 'DEPARTMENT':
      return user.departmentId
        ? { ...base, OR: [{ departmentId: user.departmentId }, { id: user.employeeId ?? NO_MATCH }] }
        : { ...base, id: user.employeeId ?? NO_MATCH };
    case 'TEAM': {
      const or: Prisma.EmployeeWhereInput[] = [{ id: user.employeeId ?? NO_MATCH }, { managerId: user.employeeId ?? NO_MATCH }];
      if (user.teamId) or.push({ teamId: user.teamId });
      return { ...base, OR: or };
    }
    case 'OWN':
    default:
      return { ...base, id: user.employeeId ?? NO_MATCH };
  }
}

/** Scope for CRM records owned by a user (leads, opportunities, customers). */
export function ownerScope(user: AuthUser, code: PermissionCode): { companyId: string; ownerUserId?: string } {
  const scope = assertPermission(user, code);
  if (scope === 'OWN' || scope === 'TEAM') return { companyId: user.companyId, ownerUserId: user.userId };
  return { companyId: user.companyId };
}
