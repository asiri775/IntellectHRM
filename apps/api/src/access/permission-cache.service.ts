import { Injectable, UnauthorizedException } from '@nestjs/common';
import { SCOPE_RANK, type PermissionScope } from '@ihrm/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../common/auth-user';

const TTL_MS = 30_000;

/**
 * Resolves a user's effective permissions from their roles.
 * Cached per process for 30s; call invalidate() after role/permission changes.
 * (For multi-instance deployments the TTL bounds staleness; see docs/ARCHITECTURE.md.)
 */
@Injectable()
export class PermissionCacheService {
  private cache = new Map<string, { at: number; user: AuthUser }>();

  constructor(private readonly prisma: PrismaService) {}

  async load(userId: string): Promise<AuthUser> {
    const hit = this.cache.get(userId);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.user;

    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        employee: { select: { id: true, departmentId: true, teamId: true } },
        roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
      },
    });
    if (!u || !u.isActive) throw new UnauthorizedException('Account is inactive');

    const permissions: Record<string, PermissionScope> = {};
    for (const ur of u.roles) {
      for (const rp of ur.role.permissions) {
        const current = permissions[rp.permission.code];
        if (!current || SCOPE_RANK[rp.scope] > SCOPE_RANK[current]) permissions[rp.permission.code] = rp.scope;
      }
    }

    const user: AuthUser = {
      userId: u.id,
      companyId: u.companyId,
      email: u.email,
      displayName: u.displayName,
      language: u.preferredLanguage,
      employeeId: u.employee?.id ?? null,
      departmentId: u.employee?.departmentId ?? null,
      teamId: u.employee?.teamId ?? null,
      roles: u.roles.map((r) => r.role.code),
      permissions,
    };
    this.cache.set(userId, { at: Date.now(), user });
    return user;
  }

  invalidate(userId?: string) {
    if (userId) this.cache.delete(userId);
    else this.cache.clear();
  }
}
