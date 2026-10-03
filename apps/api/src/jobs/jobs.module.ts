import { Injectable, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import IORedis from 'ioredis';
import { localDate } from '@ihrm/shared';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.module';
import { NotificationService } from '../settings/settings.module';
import { config } from '../config';
import { dateOnly, ymd } from '../common/pagination';

const TZ = 'Asia/Colombo';

/**
 * Background jobs. When several API instances run, a Redis lock ensures each
 * job runs once per schedule. Disable with ENABLE_SCHEDULER=false (e.g. on
 * web-only nodes) and run a dedicated worker instance instead.
 */
@Injectable()
export class JobsService implements OnModuleDestroy {
  private readonly logger = new Logger(JobsService.name);
  private readonly redis = config.REDIS_URL ? new IORedis(config.REDIS_URL, { maxRetriesPerRequest: 2 }) : null;

  constructor(private readonly prisma: PrismaService, private readonly mail: MailService, private readonly notify: NotificationService) {}

  onModuleDestroy() {
    this.redis?.disconnect();
  }

  private async once(name: string, ttlSeconds: number, fn: () => Promise<void>) {
    if (!config.ENABLE_SCHEDULER) return;
    if (this.redis) {
      const ok = await this.redis.set(`ihrm:job:${name}`, '1', 'EX', ttlSeconds, 'NX');
      if (!ok) return;
    }
    try {
      await fn();
    } catch (e) {
      this.logger.error(`Job ${name} failed: ${(e as Error).message}`);
    }
  }

  /** Contract end reminders to HR at 60/30/7 days (configurable per company). */
  @Cron('0 7 * * *', { timeZone: TZ })
  async contractReminders() {
    await this.once('contract-reminders', 3000, async () => {
      const companies = await this.prisma.company.findMany();
      for (const c of companies) {
        const days = ((c.settings as { contractReminderDays?: number[] }).contractReminderDays ?? [60, 30, 7]).sort((a, b) => b - a);
        const today = ymd(new Date());
        const contracts = await this.prisma.employmentContract.findMany({
          where: { companyId: c.id, status: 'ACTIVE', endDate: { gte: dateOnly(today), lte: new Date(Date.now() + Math.max(...days) * 86400000) } },
          include: { employee: true },
        });
        const hr = await this.prisma.user.findMany({ where: { companyId: c.id, isActive: true, roles: { some: { role: { code: 'HR_MANAGER' } } } } });
        for (const k of contracts) {
          const left = Math.round((k.endDate!.getTime() - dateOnly(today).getTime()) / 86400000);
          const threshold = days.find((d) => left <= d && !k.remindersSent.includes(d));
          if (threshold === undefined) continue;
          const name = `${k.employee.firstName} ${k.employee.lastName}`;
          await this.notify.notify(c.id, hr.map((u) => u.id), { type: 'CONTRACT_ENDING', title: `Contract ending in ${left} days: ${name}`, link: `/employees/${k.employeeId}` });
          for (const u of hr) {
            await this.mail.send({ companyId: c.id, templateKey: 'CONTRACT_ENDING', to: u.email, language: u.preferredLanguage, data: { employee: { ...k.employee, name }, contract: k, daysLeft: left }, related: { entity: 'EmploymentContract', id: k.id } });
          }
          // Mark this and all larger thresholds as sent so a late first run does not send several reminders at once.
          await this.prisma.employmentContract.update({ where: { id: k.id }, data: { remindersSent: [...new Set([...k.remindersSent, ...days.filter((d) => d >= threshold)])] } });
        }
      }
    });
  }

  /** Flag yesterday's records with no sign-out. */
  @Cron('30 6 * * *', { timeZone: TZ })
  async missingCheckout() {
    await this.once('missing-checkout', 3000, async () => {
      const yesterday = localDate(new Date(Date.now() - 86400000), TZ);
      const recs = await this.prisma.attendanceRecord.findMany({ where: { workDate: dateOnly(yesterday), signOutAt: null }, include: { employee: { include: { user: true } } } });
      for (const r of recs) {
        await this.notify.notify(r.companyId, [r.employee.userId], { type: 'MISSING_CHECKOUT', title: `No sign-out recorded on ${yesterday}`, link: '/attendance' });
        await this.mail.send({
          companyId: r.companyId,
          templateKey: 'MISSING_CHECKOUT',
          to: r.employee.email,
          language: r.employee.user?.preferredLanguage ?? r.employee.preferredLanguage,
          data: { employee: { name: `${r.employee.firstName} ${r.employee.lastName}` }, workDate: yesterday },
        });
      }
    });
  }

  /** Lead follow-up reminders to the owner. */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async followUps() {
    await this.once('lead-follow-ups', 1500, async () => {
      const due = await this.prisma.lead.findMany({
        where: { deletedAt: null, status: { in: ['NEW', 'CONTACTED', 'QUALIFIED'] }, nextFollowUpAt: { lte: new Date() }, followUpReminderSentAt: null, ownerUserId: { not: null } },
        take: 500,
      });
      for (const l of due) {
        const owner = await this.prisma.user.findUnique({ where: { id: l.ownerUserId! } });
        if (owner?.isActive) {
          await this.notify.notify(l.companyId, [owner.id], { type: 'FOLLOW_UP', title: `Follow up: ${l.name}`, link: `/crm/leads/${l.id}` });
          await this.mail.send({ companyId: l.companyId, templateKey: 'FOLLOW_UP_REMINDER', to: owner.email, language: owner.preferredLanguage, data: { owner: { name: owner.displayName }, lead: l } });
        }
        await this.prisma.lead.update({ where: { id: l.id }, data: { followUpReminderSentAt: new Date() } });
      }
    });
  }
}

@Module({ providers: [JobsService] })
export class JobsModule {}
