import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { formatSequence } from '@ihrm/shared';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULTS: Record<string, { prefix: string; format: string; padding: number; resetYearly: boolean }> = {
  EMPLOYEE: { prefix: 'EMP', format: '{PREFIX}{SEQ}', padding: 4, resetYearly: false },
  CUSTOMER: { prefix: 'CUS', format: '{PREFIX}-{SEQ}', padding: 5, resetYearly: false },
  LEAD: { prefix: 'LD', format: '{PREFIX}-{YYYY}-{SEQ}', padding: 5, resetYearly: true },
  OPPORTUNITY: { prefix: 'OPP', format: '{PREFIX}-{YYYY}-{SEQ}', padding: 5, resetYearly: true },
  PAYROLL_RUN: { prefix: 'PR', format: '{PREFIX}-{YYYY}-{SEQ}', padding: 3, resetYearly: true },
  PAYSLIP: { prefix: 'PS', format: '{PREFIX}-{YYYY}{MM}-{SEQ}', padding: 5, resetYearly: true },
  QUOTATION: { prefix: 'QT', format: '{PREFIX}-{YYYY}-{SEQ}', padding: 6, resetYearly: true },
  PROFORMA_INVOICE: { prefix: 'PI', format: '{PREFIX}-{YYYY}-{SEQ}', padding: 6, resetYearly: true },
  INVOICE: { prefix: 'INV', format: '{PREFIX}-{YYYY}-{SEQ}', padding: 6, resetYearly: true },
};

/**
 * Gap-free document numbers. The row is locked with SELECT … FOR UPDATE inside
 * the caller's transaction, so a rolled-back transaction does not consume a number.
 */
@Injectable()
export class SequenceService {
  constructor(private readonly prisma: PrismaService) {}

  async next(companyId: string, key: string, tx?: Prisma.TransactionClient, date = new Date()): Promise<string> {
    const run = async (db: Prisma.TransactionClient) => {
      const d = DEFAULTS[key] ?? { prefix: key.slice(0, 3), format: '{PREFIX}-{SEQ}', padding: 6, resetYearly: false };
      await db.numberSequence.upsert({
        where: { companyId_key: { companyId, key } },
        create: { companyId, key, ...d, lastYear: date.getFullYear() },
        update: {},
      });
      const rows = await db.$queryRaw<
        { id: string; prefix: string; format: string; padding: number; next_value: number; reset_yearly: boolean; last_year: number | null }[]
      >`SELECT id, prefix, format, padding, next_value, reset_yearly, last_year FROM number_sequences WHERE company_id = ${companyId}::uuid AND key = ${key} FOR UPDATE`;
      const s = rows[0];
      const year = date.getFullYear();
      const value = s.reset_yearly && s.last_year !== year ? 1 : s.next_value;
      await db.numberSequence.update({ where: { id: s.id }, data: { nextValue: value + 1, lastYear: year } });
      return formatSequence(s.format, s.prefix, value, s.padding, date);
    };
    return tx ? run(tx) : this.prisma.$transaction(run);
  }
}
