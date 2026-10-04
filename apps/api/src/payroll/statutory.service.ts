import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EMPLOYMENT_TYPES, STATUTORY_RULE_META, type PayrollRuleSet, type StatutoryRuleCode } from '@ihrm/shared';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.module';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { dateOnly, ymd } from '../common/pagination';

const types = z.array(z.enum(EMPLOYMENT_TYPES));
const rate = z.number().min(0).max(1);

export const RULE_CONFIG_SCHEMAS: Record<StatutoryRuleCode, z.ZodTypeAny> = {
  EPF_EMPLOYEE: z.object({ rate, employmentTypes: types }),
  EPF_EMPLOYER: z.object({ rate, employmentTypes: types }),
  ETF: z.object({ rate, employmentTypes: types }),
  APIT: z.object({
    employmentTypes: types,
    slabs: z
      .array(z.object({ width: z.number().positive().nullable(), rate }))
      .min(1)
      .refine((s) => s.slice(0, -1).every((x) => x.width !== null), 'Only the last slab may be unlimited'),
  }),
  CONTRACT_EMPLOYEE_TAX: z.object({
    employmentTypes: types,
    rate,
    thresholdAmount: z.number().min(0),
    thresholdCurrency: z.literal('LKR'),
    thresholdPeriod: z.literal('MONTHLY'),
    comparison: z.enum(['GREATER_THAN', 'GREATER_THAN_OR_EQUAL']),
    basis: z.enum(['FULL_AMOUNT', 'EXCESS_OVER_THRESHOLD']),
    includedComponents: z.array(z.string()),
    replacesApit: z.boolean(),
    liabilityAccount: z.string().min(1),
  }),
  GRATUITY: z.object({ employmentTypes: types, monthsPerYearOfService: z.number().min(0).max(12), eligibilityYears: z.number().min(0).max(50) }),
  NO_PAY: z.object({ divisor: z.enum(['WORKING_DAYS', 'FIXED']), fixedDivisor: z.number().positive() }),
};

export const RULE_CODES = Object.keys(RULE_CONFIG_SCHEMAS) as StatutoryRuleCode[];

/**
 * Versioned statutory rules (Section 2.2). Versions are never edited in place:
 * a change adds a new version with an effective date, and the previous open
 * version is closed the day before. Payroll runs snapshot the versions used.
 */
@Injectable()
export class StatutoryService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  list(companyId: string) {
    return this.prisma.statutoryRule.findMany({
      where: { companyId },
      include: { versions: { orderBy: { effectiveFrom: 'desc' } } },
      orderBy: { code: 'asc' },
    });
  }

  async addVersion(user: AuthUser, code: string, body: { effectiveFrom: string; config?: unknown; note?: string }, meta: RequestMeta) {
    if (!RULE_CODES.includes(code as StatutoryRuleCode)) throw new NotFoundException(`Unknown rule ${code}`);
    const parsed = RULE_CONFIG_SCHEMAS[code as StatutoryRuleCode].safeParse(body.config);
    if (!parsed.success) {
      throw new BadRequestException({ message: 'Invalid rule configuration', errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    }
    const rule = await this.prisma.statutoryRule.upsert({
      where: { companyId_code: { companyId: user.companyId, code } },
      create: { companyId: user.companyId, code, name: STATUTORY_RULE_META[code as StatutoryRuleCode].name, description: STATUTORY_RULE_META[code as StatutoryRuleCode].description },
      update: {},
      include: { versions: true },
    });
    const from = dateOnly(body.effectiveFrom);
    if (rule.versions.some((v) => ymd(v.effectiveFrom) === body.effectiveFrom)) throw new BadRequestException('A version with this effective date already exists');
    // A version may not start inside a period that has already been posted.
    const posted = await this.prisma.payrollRun.findFirst({ where: { companyId: user.companyId, status: { in: ['APPROVED', 'POSTED'] }, periodEnd: { gte: from } } });
    if (posted) throw new BadRequestException(`Payroll ${posted.number} is already approved/posted for a period on or after this date. Use a later effective date.`);

    return this.prisma.$transaction(async (tx) => {
      const prev = rule.versions
        .filter((v) => v.effectiveFrom < from && (!v.effectiveTo || v.effectiveTo >= from))
        .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0];
      if (prev) await tx.statutoryRuleVersion.update({ where: { id: prev.id }, data: { effectiveTo: new Date(from.getTime() - 86400000) } });
      const next = rule.versions.filter((v) => v.effectiveFrom > from).sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime())[0];
      const v = await tx.statutoryRuleVersion.create({
        data: {
          ruleId: rule.id,
          effectiveFrom: from,
          effectiveTo: next ? new Date(next.effectiveFrom.getTime() - 86400000) : null,
          config: parsed.data as Prisma.InputJsonValue,
          note: body.note,
          createdBy: user.userId,
        },
      });
      await this.audit.log(user, { action: 'ADD_VERSION', module: 'PAYROLL', entity: 'StatutoryRule', entityId: rule.id, oldValue: prev?.config, newValue: { code, effectiveFrom: body.effectiveFrom, config: parsed.data }, reason: body.note }, meta, tx);
      return v;
    });
  }

  /** The complete rule set in force on a date, plus the version ids used. */
  async ruleSetAt(companyId: string, date: Date): Promise<{ rules: PayrollRuleSet; versions: Record<string, string> }> {
    const rules = await this.prisma.statutoryRule.findMany({
      where: { companyId },
      include: { versions: { where: { effectiveFrom: { lte: date }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }] }, orderBy: { effectiveFrom: 'desc' }, take: 1 } },
    });
    const out: Partial<PayrollRuleSet> = {};
    const versions: Record<string, string> = {};
    for (const code of RULE_CODES) {
      const r = rules.find((x) => x.code === code);
      const v = r?.versions[0];
      if (!v) throw new BadRequestException(`No ${code} rule version in force on ${ymd(date)}. Configure it under Payroll → Statutory rules.`);
      (out as Record<string, unknown>)[code] = v.config;
      versions[code] = v.id;
    }
    return { rules: out as PayrollRuleSet, versions };
  }
}
