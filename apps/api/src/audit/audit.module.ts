import { Controller, Get, Global, Injectable, Logger, Module, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { pageArgs, pageQuery, toPage } from '../common/pagination';

const REDACT = /password|hash|encrypted|secret|token/i;

function redact(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(redact);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if (Prisma.Decimal.isDecimal(value)) return (value as Prisma.Decimal).toString();
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, REDACT.test(k) ? '[redacted]' : redact(v)]),
    );
  }
  return value;
}

export interface AuditEntry {
  action: string;
  module: string;
  entity: string;
  entityId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Append an audit entry. Pass `tx` to write inside the same database
   * transaction as the change being audited.
   */
  async log(
    user: Pick<AuthUser, 'userId' | 'companyId'> | { userId: null; companyId: string },
    entry: AuditEntry,
    meta: RequestMeta = {},
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx ?? this.prisma;
    try {
      await db.auditLog.create({
        data: {
          companyId: user.companyId,
          userId: user.userId,
          action: entry.action,
          module: entry.module,
          entity: entry.entity,
          entityId: entry.entityId ?? null,
          oldValue: (redact(entry.oldValue) ?? undefined) as Prisma.InputJsonValue | undefined,
          newValue: (redact(entry.newValue) ?? undefined) as Prisma.InputJsonValue | undefined,
          reason: entry.reason ?? null,
          ip: meta.ip ?? null,
          userAgent: meta.userAgent?.slice(0, 255) ?? null,
        },
      });
    } catch (err) {
      if (tx) throw err; // inside a transaction, auditing failure must abort the change
      this.logger.error(`Audit write failed: ${(err as Error).message}`);
    }
  }
}

const auditQuery = pageQuery.extend({
  module: z.string().optional(),
  entity: z.string().optional(),
  entityId: z.string().optional(),
  userId: z.string().uuid().optional(),
});

@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermissions('AUDIT_VIEW')
  async list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(auditQuery)) q: z.infer<typeof auditQuery>) {
    const where: Prisma.AuditLogWhereInput = {
      companyId: user.companyId,
      module: q.module,
      entity: q.entity,
      entityId: q.entityId,
      userId: q.userId,
    };
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, ...pageArgs(q) }),
      this.prisma.auditLog.count({ where }),
    ]);
    return toPage(items, total, q);
  }
}

@Global()
@Module({ providers: [AuditService], controllers: [AuditController], exports: [AuditService] })
export class AuditModule {}
