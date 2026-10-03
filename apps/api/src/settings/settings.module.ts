import {
  Body,
  Controller,
  Delete,
  Get,
  Global,
  HttpCode,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.module';
import { StorageService, IMAGE_TYPES, type UploadedFileLike } from '../files/files.module';
import { CurrentUser, Public, ReqMeta, RequirePermissions } from '../common/decorators';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { ZodPipe } from '../common/zod.pipe';
import { dateOnly, pageArgs, pageQuery, toPage, ymdSchema } from '../common/pagination';
import { MailService } from '../mail/mail.module';
import { config } from '../config';
import { SequenceService } from './sequence.service';

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #1F4FD8');

const companySchema = z.object({
  name: z.string().min(1).optional(),
  legalName: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  website: z.string().nullable().optional(),
  tin: z.string().nullable().optional(),
  vatNumber: z.string().nullable().optional(),
  baseCurrency: z.string().length(3).optional(),
  timezone: z.string().optional(),
  dateFormat: z.enum(['DD/MM/YYYY', 'YYYY-MM-DD', 'MM/DD/YYYY']).optional(),
  fiscalYearStartMonth: z.number().int().min(1).max(12).optional(),
  defaultLanguage: z.enum(['en', 'si', 'ta']).optional(),
  primaryColor: hex.optional(),
  accentColor: hex.optional(),
  emailFooter: z.string().max(500).nullable().optional(),
  settings: z
    .object({
      attendance: z.object({ captureLocation: z.boolean(), allowRemote: z.boolean() }).partial().optional(),
      contractReminderDays: z.array(z.number().int().positive()).optional(),
    })
    .passthrough()
    .optional(),
});

const sequenceSchema = z.object({
  prefix: z.string().min(1).max(10),
  format: z.string().includes('{SEQ}', { message: 'Format must contain {SEQ}' }),
  padding: z.number().int().min(1).max(10),
  resetYearly: z.boolean(),
  nextValue: z.number().int().min(1).optional(),
});

const taxCodeSchema = z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(1),
  rate: z.number().min(0).max(1),
  isInclusive: z.boolean().default(false),
  account: z.string().optional(),
  effectiveFrom: ymdSchema,
  effectiveTo: ymdSchema.nullable().optional(),
  isActive: z.boolean().default(true),
});

const rateSchema = z.object({ fromCurrency: z.string().length(3), toCurrency: z.string().length(3).default('LKR'), rate: z.number().positive(), effectiveDate: ymdSchema, source: z.string().optional() });

@Injectable()
export class ExchangeRateService {
  constructor(private readonly prisma: PrismaService) {}
  /** Latest rate on or before `date` to convert 1 unit of `from` into LKR (1 for LKR). */
  async toLkr(companyId: string, from: string, date: Date): Promise<number> {
    if (from === 'LKR') return 1;
    const r = await this.prisma.exchangeRate.findFirst({
      where: { companyId, fromCurrency: from, toCurrency: 'LKR', effectiveDate: { lte: date } },
      orderBy: { effectiveDate: 'desc' },
    });
    if (!r) throw new NotFoundException(`No ${from}→LKR exchange rate on or before ${date.toISOString().slice(0, 10)}`);
    return Number(r.rate);
  }
}

@ApiTags('settings')
@Controller()
export class SettingsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly mail: MailService,
  ) {}

  /** Branding for the login screen (no auth). */
  @Public()
  @Get('public/branding')
  async publicBranding() {
    const c = await this.prisma.company.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!c) return { name: 'IntellectHRM', logoUrl: null, primaryColor: '#1F4FD8', accentColor: '#0EA5A4' };
    return {
      name: c.name,
      logoUrl: c.logoFileId ? `/api/public/files/${c.logoFileId}` : null,
      primaryColor: c.primaryColor,
      accentColor: c.accentColor,
      defaultLanguage: c.defaultLanguage,
    };
  }

  @ApiBearerAuth()
  @Get('company')
  async company(@CurrentUser() user: AuthUser) {
    const c = await this.prisma.company.findUniqueOrThrow({ where: { id: user.companyId } });
    return { ...c, logoUrl: c.logoFileId ? `/api/public/files/${c.logoFileId}` : null };
  }

  @ApiBearerAuth()
  @Patch('company')
  @RequirePermissions('SETTINGS_MANAGE')
  async updateCompany(@CurrentUser() user: AuthUser, @Body(new ZodPipe(companySchema)) body: z.infer<typeof companySchema>, @ReqMeta() meta: RequestMeta) {
    const old = await this.prisma.company.findUniqueOrThrow({ where: { id: user.companyId } });
    const settings = body.settings ? { ...(old.settings as object), ...body.settings } : undefined;
    const c = await this.prisma.company.update({
      where: { id: user.companyId },
      data: { ...body, settings: settings as Prisma.InputJsonValue | undefined },
    });
    await this.audit.log(user, { action: 'UPDATE', module: 'ADMIN', entity: 'Company', entityId: c.id, oldValue: old, newValue: c }, meta);
    return c;
  }

  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @Post('company/logo')
  @RequirePermissions('SETTINGS_MANAGE')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } }))
  async uploadLogo(@CurrentUser() user: AuthUser, @UploadedFile() file: UploadedFileLike, @ReqMeta() meta: RequestMeta) {
    const stored = await this.storage.save(user.companyId, file, { allowed: IMAGE_TYPES, isPublic: true, userId: user.userId });
    const c = await this.prisma.company.update({ where: { id: user.companyId }, data: { logoFileId: stored.id } });
    await this.audit.log(user, { action: 'UPDATE_LOGO', module: 'ADMIN', entity: 'Company', entityId: c.id, newValue: { logoFileId: stored.id, name: stored.originalName } }, meta);
    return { logoFileId: stored.id, logoUrl: `/api/public/files/${stored.id}` };
  }

  @ApiBearerAuth()
  @Delete('company/logo')
  @HttpCode(204)
  @RequirePermissions('SETTINGS_MANAGE')
  async removeLogo(@CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    await this.prisma.company.update({ where: { id: user.companyId }, data: { logoFileId: null } });
    await this.audit.log(user, { action: 'REMOVE_LOGO', module: 'ADMIN', entity: 'Company', entityId: user.companyId }, meta);
  }

  // ── Number sequences ──
  @ApiBearerAuth()
  @Get('sequences')
  @RequirePermissions('SETTINGS_MANAGE')
  sequences(@CurrentUser() user: AuthUser) {
    return this.prisma.numberSequence.findMany({ where: { companyId: user.companyId }, orderBy: { key: 'asc' } });
  }

  @ApiBearerAuth()
  @Put('sequences/:key')
  @RequirePermissions('SETTINGS_MANAGE')
  async updateSequence(@CurrentUser() user: AuthUser, @Param('key') key: string, @Body(new ZodPipe(sequenceSchema)) body: z.infer<typeof sequenceSchema>, @ReqMeta() meta: RequestMeta) {
    const old = await this.prisma.numberSequence.findUnique({ where: { companyId_key: { companyId: user.companyId, key } } });
    if (!old) throw new NotFoundException();
    // Never allow moving a sequence backwards (would create duplicate numbers).
    const nextValue = body.nextValue && body.nextValue > old.nextValue ? body.nextValue : old.nextValue;
    const row = await this.prisma.numberSequence.update({ where: { id: old.id }, data: { ...body, nextValue } });
    await this.audit.log(user, { action: 'UPDATE', module: 'ADMIN', entity: 'NumberSequence', entityId: old.id, oldValue: old, newValue: row }, meta);
    return row;
  }

  // ── Tax codes ──
  @ApiBearerAuth()
  @Get('tax-codes')
  taxCodes(@CurrentUser() user: AuthUser) {
    return this.prisma.taxCode.findMany({ where: { companyId: user.companyId }, orderBy: [{ code: 'asc' }, { effectiveFrom: 'desc' }] });
  }

  @ApiBearerAuth()
  @Post('tax-codes')
  @RequirePermissions('SETTINGS_MANAGE')
  async createTaxCode(@CurrentUser() user: AuthUser, @Body(new ZodPipe(taxCodeSchema)) body: z.infer<typeof taxCodeSchema>, @ReqMeta() meta: RequestMeta) {
    const row = await this.prisma.taxCode.create({
      data: { ...body, companyId: user.companyId, effectiveFrom: dateOnly(body.effectiveFrom), effectiveTo: body.effectiveTo ? dateOnly(body.effectiveTo) : null },
    });
    await this.audit.log(user, { action: 'CREATE', module: 'ADMIN', entity: 'TaxCode', entityId: row.id, newValue: row }, meta);
    return row;
  }

  // ── Exchange rates ──
  @ApiBearerAuth()
  @Get('exchange-rates')
  exchangeRates(@CurrentUser() user: AuthUser) {
    return this.prisma.exchangeRate.findMany({ where: { companyId: user.companyId }, orderBy: { effectiveDate: 'desc' }, take: 200 });
  }

  @ApiBearerAuth()
  @Post('exchange-rates')
  @RequirePermissions('SETTINGS_MANAGE', 'PAYROLL_RUN')
  async addRate(@CurrentUser() user: AuthUser, @Body(new ZodPipe(rateSchema)) body: z.infer<typeof rateSchema>, @ReqMeta() meta: RequestMeta) {
    const row = await this.prisma.exchangeRate.upsert({
      where: { companyId_fromCurrency_toCurrency_effectiveDate: { companyId: user.companyId, fromCurrency: body.fromCurrency, toCurrency: body.toCurrency, effectiveDate: dateOnly(body.effectiveDate) } },
      create: { ...body, companyId: user.companyId, effectiveDate: dateOnly(body.effectiveDate) },
      update: { rate: body.rate, source: body.source },
    });
    await this.audit.log(user, { action: 'UPSERT', module: 'ADMIN', entity: 'ExchangeRate', entityId: row.id, newValue: row }, meta);
    return row;
  }

  // ── Email outbox ──
  @ApiBearerAuth()
  @Get('email-outbox')
  @RequirePermissions('TEMPLATE_MANAGE')
  async outbox(@CurrentUser() user: AuthUser, @Query(new ZodPipe(pageQuery.extend({ status: z.enum(['QUEUED', 'SENT', 'FAILED']).optional() }))) q: z.infer<typeof pageQuery> & { status?: 'QUEUED' | 'SENT' | 'FAILED' }) {
    const where: Prisma.EmailOutboxWhereInput = { companyId: user.companyId, status: q.status };
    const [items, total] = await Promise.all([
      this.prisma.emailOutbox.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        select: { id: true, to: true, subject: true, templateKey: true, status: true, attempts: true, lastError: true, createdAt: true, sentAt: true },
        ...pageArgs(q),
      }),
      this.prisma.emailOutbox.count({ where }),
    ]);
    return toPage(items, total, q);
  }

  @ApiBearerAuth()
  @Post('email-outbox/:id/retry')
  @RequirePermissions('TEMPLATE_MANAGE')
  retry(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.mail.retry(user.companyId, id);
  }

  @ApiBearerAuth()
  @Post('email-test')
  @RequirePermissions('TEMPLATE_MANAGE')
  async testEmail(@CurrentUser() user: AuthUser, @Body(new ZodPipe(z.object({ to: z.string().email(), templateKey: z.string().default('WELCOME_USER') }))) body: { to: string; templateKey: string }) {
    const id = await this.mail.send({
      companyId: user.companyId,
      templateKey: body.templateKey,
      to: body.to,
      language: user.language,
      data: { user: { displayName: user.displayName, email: user.email } },
    });
    return { outboxId: id, provider: config.MAIL_PROVIDER };
  }

  // ── Notifications (in-app) ──
  @ApiBearerAuth()
  @Get('notifications')
  async notifications(@CurrentUser() user: AuthUser) {
    const [items, unread] = await Promise.all([
      this.prisma.notification.findMany({ where: { userId: user.userId }, orderBy: { createdAt: 'desc' }, take: 30 }),
      this.prisma.notification.count({ where: { userId: user.userId, readAt: null } }),
    ]);
    return { items, unread };
  }

  @ApiBearerAuth()
  @Post('notifications/read-all')
  @HttpCode(204)
  async readAll(@CurrentUser() user: AuthUser) {
    await this.prisma.notification.updateMany({ where: { userId: user.userId, readAt: null }, data: { readAt: new Date() } });
  }
}

@Injectable()
export class NotificationService {
  constructor(private readonly prisma: PrismaService) {}
  async notify(companyId: string, userIds: (string | null | undefined)[], n: { type: string; title: string; body?: string; link?: string }) {
    const ids = [...new Set(userIds.filter((x): x is string => !!x))];
    if (!ids.length) return;
    await this.prisma.notification.createMany({ data: ids.map((userId) => ({ companyId, userId, ...n })) });
  }
}

@Global()
@Module({
  providers: [SequenceService, ExchangeRateService, NotificationService],
  controllers: [SettingsController],
  exports: [SequenceService, ExchangeRateService, NotificationService],
})
export class SettingsModule {}
