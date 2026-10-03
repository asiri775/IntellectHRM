import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ActivityType, CustomerStatus, LeadStatus, OpportunityStatus, Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.module';
import { CurrentUser, ReqMeta, RequirePermissions } from '../common/decorators';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { ZodPipe } from '../common/zod.pipe';
import { dateOnly, pageArgs, pageQuery, toPage, ymd, ymdSchema } from '../common/pagination';
import { ownerScope } from '../common/scope';
import { SequenceService } from '../settings/sequence.service';
import { ExchangeRateService, NotificationService } from '../settings/settings.module';
import { MailService } from '../mail/mail.module';
import { DocumentService } from '../templates/templates.module';

const n = (d: Prisma.Decimal | number | null | undefined) => Number(d ?? 0);
const currency = z.string().length(3).toUpperCase();

const customerSchema = z.object({
  name: z.string().min(1),
  industry: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  website: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().email().nullable().optional().or(z.literal('').transform(() => null)),
  address: z.string().nullable().optional(),
  tin: z.string().nullable().optional(),
  vatNumber: z.string().nullable().optional(),
  currency: currency.default('LKR'),
  ownerUserId: z.string().uuid().nullable().optional(),
  status: z.nativeEnum(CustomerStatus).default('PROSPECT'),
  tags: z.array(z.string()).default([]),
  notes: z.string().nullable().optional(),
});
const contactSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  email: z.string().email().nullable().optional().or(z.literal('').transform(() => null)),
  phone: z.string().nullable().optional(),
  isPrimary: z.boolean().default(false),
  marketingConsent: z.boolean().default(false),
});
const leadSchema = z.object({
  name: z.string().min(1),
  companyName: z.string().nullable().optional(),
  email: z.string().email().nullable().optional().or(z.literal('').transform(() => null)),
  phone: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  sourceId: z.string().uuid().nullable().optional(),
  campaign: z.string().nullable().optional(),
  serviceInterest: z.string().nullable().optional(),
  estimatedValue: z.number().min(0).nullable().optional(),
  currency: currency.default('LKR'),
  probability: z.number().int().min(0).max(100).default(10),
  ownerUserId: z.string().uuid().nullable().optional(),
  status: z.nativeEnum(LeadStatus).optional(),
  nextFollowUpAt: z.string().datetime({ offset: true }).nullable().optional(),
  marketingConsent: z.boolean().default(false),
  notes: z.string().nullable().optional(),
});
const convertSchema = z.object({
  customerId: z.string().uuid().optional(),
  createOpportunity: z.boolean().default(true),
  opportunityTitle: z.string().optional(),
  expectedCloseDate: ymdSchema.optional(),
});
const lineItem = z.object({ description: z.string().min(1), quantity: z.number().positive(), unitPrice: z.number().min(0), taxCode: z.string().nullable().optional() });
const opportunitySchema = z.object({
  title: z.string().min(1),
  customerId: z.string().uuid(),
  contactId: z.string().uuid().nullable().optional(),
  service: z.string().nullable().optional(),
  expectedValue: z.number().min(0),
  currency: currency.default('LKR'),
  probability: z.number().int().min(0).max(100).optional(),
  expectedCloseDate: ymdSchema.nullable().optional(),
  ownerUserId: z.string().uuid().nullable().optional(),
  stageId: z.string().uuid().optional(),
  notes: z.string().nullable().optional(),
  lineItems: z.array(lineItem).optional(),
});
const moveSchema = z.object({ stageId: z.string().uuid(), lostReason: z.string().optional() });
const stageSchema = z.object({ name: z.string().min(1), order: z.number().int().min(0), probability: z.number().int().min(0).max(100), isWon: z.boolean().default(false), isLost: z.boolean().default(false), isActive: z.boolean().default(true) });
const activitySchema = z
  .object({
    type: z.nativeEnum(ActivityType),
    subject: z.string().min(1),
    body: z.string().nullable().optional(),
    dueAt: z.string().datetime({ offset: true }).nullable().optional(),
    leadId: z.string().uuid().optional(),
    customerId: z.string().uuid().optional(),
    opportunityId: z.string().uuid().optional(),
  })
  .refine((v) => v.leadId || v.customerId || v.opportunityId, 'Link the activity to a lead, customer or opportunity');
const docTypeSchema = z.enum(['QUOTATION', 'PROFORMA_INVOICE']);
const sendDocSchema = z.object({ type: docTypeSchema, to: z.string().email(), cc: z.string().email().optional(), message: z.string().max(2000).optional(), validDays: z.number().int().min(1).max(365).default(30) });

@Injectable()
export class CrmService {
  private readonly logger = new Logger(CrmService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly seq: SequenceService,
    private readonly mail: MailService,
    private readonly notify: NotificationService,
    private readonly fx: ExchangeRateService,
    private readonly docs: DocumentService,
  ) {}

  // ───────── Customers ─────────
  async listCustomers(user: AuthUser, q: z.infer<typeof pageQuery> & { status?: CustomerStatus }) {
    const where: Prisma.CustomerWhereInput = {
      ...ownerScope(user, 'CUSTOMER_VIEW'),
      deletedAt: null,
      status: q.status,
      ...(q.search ? { OR: [{ name: { contains: q.search, mode: 'insensitive' } }, { code: { contains: q.search, mode: 'insensitive' } }, { email: { contains: q.search, mode: 'insensitive' } }] } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.customer.findMany({ where, orderBy: { name: 'asc' }, include: { _count: { select: { opportunities: true, contacts: true } } }, ...pageArgs(q) }),
      this.prisma.customer.count({ where }),
    ]);
    return toPage(items, total, q);
  }

  /** Customer 360 (CRM part): profile, contacts, opportunities, activities, pipeline totals. */
  async customer360(user: AuthUser, id: string) {
    const c = await this.prisma.customer.findFirst({
      where: { ...ownerScope(user, 'CUSTOMER_VIEW'), id, deletedAt: null },
      include: {
        contacts: { where: { deletedAt: null }, orderBy: [{ isPrimary: 'desc' }, { firstName: 'asc' }] },
        opportunities: { where: { deletedAt: null }, include: { stage: true }, orderBy: { createdAt: 'desc' } },
        activities: { orderBy: { createdAt: 'desc' }, take: 50 },
      },
    });
    if (!c) throw new NotFoundException('Customer not found');
    const leads = await this.prisma.lead.findMany({ where: { companyId: user.companyId, convertedCustomerId: id }, select: { id: true, number: true, name: true, convertedAt: true } });
    const open = c.opportunities.filter((o) => o.status === 'OPEN');
    const won = c.opportunities.filter((o) => o.status === 'WON');
    return {
      ...c,
      leads,
      stats: {
        openOpportunities: open.length,
        openValue: open.reduce((s, o) => s + n(o.expectedValue), 0),
        wonValue: won.reduce((s, o) => s + n(o.expectedValue), 0),
        wonCount: won.length,
      },
    };
  }

  async createCustomer(user: AuthUser, b: z.infer<typeof customerSchema>, meta: RequestMeta) {
    return this.prisma.$transaction(async (tx) => {
      const code = await this.seq.next(user.companyId, 'CUSTOMER', tx);
      const c = await tx.customer.create({ data: { ...b, code, companyId: user.companyId, ownerUserId: b.ownerUserId ?? user.userId, createdBy: user.userId } });
      await this.audit.log(user, { action: 'CREATE', module: 'CRM', entity: 'Customer', entityId: c.id, newValue: c }, meta, tx);
      return c;
    });
  }

  async updateCustomer(user: AuthUser, id: string, b: Partial<z.infer<typeof customerSchema>>, meta: RequestMeta) {
    const old = await this.prisma.customer.findFirst({ where: { ...ownerScope(user, 'CUSTOMER_MANAGE'), id, deletedAt: null } });
    if (!old) throw new NotFoundException();
    const c = await this.prisma.customer.update({ where: { id }, data: { ...b, updatedBy: user.userId } });
    await this.audit.log(user, { action: 'UPDATE', module: 'CRM', entity: 'Customer', entityId: id, oldValue: old, newValue: c }, meta);
    return c;
  }

  async upsertContact(user: AuthUser, customerId: string, contactId: string | null, b: z.infer<typeof contactSchema>, meta: RequestMeta) {
    const c = await this.prisma.customer.findFirst({ where: { ...ownerScope(user, 'CUSTOMER_MANAGE'), id: customerId, deletedAt: null } });
    if (!c) throw new NotFoundException('Customer not found');
    return this.prisma.$transaction(async (tx) => {
      if (b.isPrimary) await tx.contact.updateMany({ where: { customerId }, data: { isPrimary: false } });
      const row = contactId
        ? await tx.contact.update({ where: { id: contactId, customerId }, data: b })
        : await tx.contact.create({ data: { ...b, customerId, companyId: user.companyId } });
      await this.audit.log(user, { action: contactId ? 'UPDATE' : 'CREATE', module: 'CRM', entity: 'Contact', entityId: row.id, newValue: row }, meta, tx);
      return row;
    });
  }

  // ───────── Leads ─────────
  async listLeads(user: AuthUser, q: z.infer<typeof pageQuery> & { status?: LeadStatus; ownerUserId?: string; followUpDue?: boolean }) {
    const where: Prisma.LeadWhereInput = {
      ...ownerScope(user, 'LEAD_VIEW'),
      deletedAt: null,
      status: q.status,
      ...(q.ownerUserId ? { ownerUserId: q.ownerUserId } : {}),
      ...(q.followUpDue ? { nextFollowUpAt: { lte: new Date() }, status: { in: ['NEW', 'CONTACTED', 'QUALIFIED'] } } : {}),
      ...(q.search
        ? { OR: [{ name: { contains: q.search, mode: 'insensitive' } }, { companyName: { contains: q.search, mode: 'insensitive' } }, { email: { contains: q.search, mode: 'insensitive' } }, { number: { contains: q.search, mode: 'insensitive' } }] }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.lead.findMany({ where, include: { source: true }, orderBy: { createdAt: 'desc' }, ...pageArgs(q) }),
      this.prisma.lead.count({ where }),
    ]);
    return toPage(items, total, q);
  }

  async getLead(user: AuthUser, id: string) {
    const l = await this.prisma.lead.findFirst({ where: { ...ownerScope(user, 'LEAD_VIEW'), id, deletedAt: null }, include: { source: true, activities: { orderBy: { createdAt: 'desc' } } } });
    if (!l) throw new NotFoundException('Lead not found');
    return l;
  }

  async createLead(user: AuthUser, b: z.infer<typeof leadSchema>, meta: RequestMeta) {
    const lead = await this.prisma.$transaction(async (tx) => {
      const number = await this.seq.next(user.companyId, 'LEAD', tx);
      const l = await tx.lead.create({
        data: {
          ...b,
          number,
          companyId: user.companyId,
          status: b.status ?? 'NEW',
          ownerUserId: b.ownerUserId ?? user.userId,
          nextFollowUpAt: b.nextFollowUpAt ? new Date(b.nextFollowUpAt) : null,
          consentRecordedAt: b.marketingConsent ? new Date() : null,
          createdBy: user.userId,
        },
      });
      await this.audit.log(user, { action: 'CREATE', module: 'CRM', entity: 'Lead', entityId: l.id, newValue: l }, meta, tx);
      return l;
    });
    if (lead.ownerUserId && lead.ownerUserId !== user.userId) await this.announceAssignment(user.companyId, lead.id);
    return lead;
  }

  async updateLead(user: AuthUser, id: string, b: Partial<z.infer<typeof leadSchema>>, meta: RequestMeta) {
    const old = await this.prisma.lead.findFirst({ where: { ...ownerScope(user, 'LEAD_MANAGE'), id, deletedAt: null } });
    if (!old) throw new NotFoundException();
    if (old.status === 'CONVERTED') throw new BadRequestException('Converted leads cannot be edited');
    if (b.status === 'CONVERTED') throw new BadRequestException('Use the convert action');
    const l = await this.prisma.lead.update({
      where: { id },
      data: {
        ...b,
        nextFollowUpAt: b.nextFollowUpAt === undefined ? undefined : b.nextFollowUpAt ? new Date(b.nextFollowUpAt) : null,
        followUpReminderSentAt: b.nextFollowUpAt !== undefined ? null : undefined,
        consentRecordedAt: b.marketingConsent === true && !old.marketingConsent ? new Date() : b.marketingConsent === false ? null : undefined,
      },
    });
    await this.audit.log(user, { action: 'UPDATE', module: 'CRM', entity: 'Lead', entityId: id, oldValue: old, newValue: l }, meta);
    if (b.ownerUserId && b.ownerUserId !== old.ownerUserId && b.ownerUserId !== user.userId) await this.announceAssignment(user.companyId, id);
    return l;
  }

  private async announceAssignment(companyId: string, leadId: string) {
    const l = await this.prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    if (!l.ownerUserId) return;
    const owner = await this.prisma.user.findUnique({ where: { id: l.ownerUserId } });
    if (!owner) return;
    await this.notify.notify(companyId, [owner.id], { type: 'LEAD_ASSIGNED', title: `Lead assigned: ${l.name}`, link: `/crm/leads/${l.id}` });
    await this.mail
      .send({ companyId, templateKey: 'LEAD_ASSIGNED', to: owner.email, language: owner.preferredLanguage, data: { owner: { name: owner.displayName }, lead: l }, related: { entity: 'Lead', id: l.id } })
      .catch((e) => this.logger.error(e.message));
  }

  /** Convert a qualified lead: customer (new or existing) + contact + opportunity. */
  async convertLead(user: AuthUser, id: string, b: z.infer<typeof convertSchema>, meta: RequestMeta) {
    const l = await this.prisma.lead.findFirst({ where: { ...ownerScope(user, 'LEAD_MANAGE'), id, deletedAt: null } });
    if (!l) throw new NotFoundException();
    if (l.status === 'CONVERTED') throw new BadRequestException('Lead is already converted');
    if (l.status === 'DISQUALIFIED') throw new BadRequestException('Disqualified leads cannot be converted');
    const firstStage = await this.prisma.pipelineStage.findFirst({ where: { companyId: user.companyId, isActive: true, isWon: false, isLost: false }, orderBy: { order: 'asc' } });
    if (b.createOpportunity && !firstStage) throw new BadRequestException('Configure pipeline stages first');

    return this.prisma.$transaction(async (tx) => {
      let customerId = b.customerId;
      if (customerId) {
        const c = await tx.customer.findFirst({ where: { id: customerId, companyId: user.companyId } });
        if (!c) throw new BadRequestException('Customer not found');
      } else {
        const code = await this.seq.next(user.companyId, 'CUSTOMER', tx);
        const c = await tx.customer.create({
          data: { companyId: user.companyId, code, name: l.companyName || l.name, email: l.email, phone: l.phone, country: l.country, currency: l.currency, ownerUserId: l.ownerUserId, status: 'PROSPECT', createdBy: user.userId },
        });
        customerId = c.id;
      }
      const [firstName, ...rest] = l.name.split(' ');
      const contact = await tx.contact.create({
        data: { companyId: user.companyId, customerId, firstName, lastName: rest.join(' ') || null, email: l.email, phone: l.phone, isPrimary: !b.customerId, marketingConsent: l.marketingConsent },
      });
      let opportunityId: string | null = null;
      if (b.createOpportunity && firstStage) {
        const number = await this.seq.next(user.companyId, 'OPPORTUNITY', tx);
        const o = await tx.opportunity.create({
          data: {
            companyId: user.companyId,
            number,
            title: b.opportunityTitle || `${l.serviceInterest || 'Opportunity'} – ${l.companyName || l.name}`,
            customerId,
            contactId: contact.id,
            leadId: l.id,
            service: l.serviceInterest,
            expectedValue: l.estimatedValue ?? 0,
            currency: l.currency,
            probability: firstStage.probability || l.probability,
            expectedCloseDate: b.expectedCloseDate ? dateOnly(b.expectedCloseDate) : null,
            ownerUserId: l.ownerUserId,
            stageId: firstStage.id,
            createdBy: user.userId,
          },
        });
        opportunityId = o.id;
      }
      const updated = await tx.lead.update({ where: { id }, data: { status: 'CONVERTED', convertedAt: new Date(), convertedCustomerId: customerId, convertedOpportunityId: opportunityId } });
      await tx.activity.updateMany({ where: { leadId: id }, data: { customerId } });
      await this.audit.log(user, { action: 'CONVERT', module: 'CRM', entity: 'Lead', entityId: id, newValue: { customerId, opportunityId } }, meta, tx);
      return { lead: updated, customerId, opportunityId };
    });
  }

  // ───────── Pipeline & opportunities ─────────
  stages(companyId: string) {
    return this.prisma.pipelineStage.findMany({ where: { companyId }, orderBy: { order: 'asc' } });
  }

  async listOpportunities(user: AuthUser, q: { status?: OpportunityStatus; customerId?: string; ownerUserId?: string; search?: string }) {
    return this.prisma.opportunity.findMany({
      where: {
        ...ownerScope(user, 'OPPORTUNITY_VIEW'),
        deletedAt: null,
        status: q.status,
        customerId: q.customerId,
        ...(q.ownerUserId ? { ownerUserId: q.ownerUserId } : {}),
        ...(q.search ? { OR: [{ title: { contains: q.search, mode: 'insensitive' } }, { number: { contains: q.search, mode: 'insensitive' } }, { customer: { name: { contains: q.search, mode: 'insensitive' } } }] } : {}),
      },
      include: { customer: { select: { id: true, name: true, code: true } }, stage: true },
      orderBy: [{ expectedCloseDate: 'asc' }, { createdAt: 'desc' }],
      take: 1000,
    });
  }

  async getOpportunity(user: AuthUser, id: string) {
    const o = await this.prisma.opportunity.findFirst({
      where: { ...ownerScope(user, 'OPPORTUNITY_VIEW'), id, deletedAt: null },
      include: { customer: { include: { contacts: { where: { deletedAt: null } } } }, stage: true, activities: { orderBy: { createdAt: 'desc' } } },
    });
    if (!o) throw new NotFoundException('Opportunity not found');
    return { ...o, totals: await this.totals(user.companyId, o.lineItems as unknown as z.infer<typeof lineItem>[], n(o.expectedValue)) };
  }

  async createOpportunity(user: AuthUser, b: z.infer<typeof opportunitySchema>, meta: RequestMeta) {
    const customer = await this.prisma.customer.findFirst({ where: { id: b.customerId, companyId: user.companyId, deletedAt: null } });
    if (!customer) throw new BadRequestException('Customer not found');
    const stage = b.stageId
      ? await this.prisma.pipelineStage.findFirst({ where: { id: b.stageId, companyId: user.companyId } })
      : await this.prisma.pipelineStage.findFirst({ where: { companyId: user.companyId, isActive: true, isWon: false, isLost: false }, orderBy: { order: 'asc' } });
    if (!stage) throw new BadRequestException('Pipeline stage not found');
    return this.prisma.$transaction(async (tx) => {
      const number = await this.seq.next(user.companyId, 'OPPORTUNITY', tx);
      const o = await tx.opportunity.create({
        data: {
          ...b,
          number,
          companyId: user.companyId,
          stageId: stage.id,
          probability: b.probability ?? stage.probability,
          expectedCloseDate: b.expectedCloseDate ? dateOnly(b.expectedCloseDate) : null,
          ownerUserId: b.ownerUserId ?? user.userId,
          lineItems: (b.lineItems ?? []) as unknown as Prisma.InputJsonValue,
          status: stage.isWon ? 'WON' : stage.isLost ? 'LOST' : 'OPEN',
          createdBy: user.userId,
        },
      });
      await this.audit.log(user, { action: 'CREATE', module: 'CRM', entity: 'Opportunity', entityId: o.id, newValue: o }, meta, tx);
      return o;
    });
  }

  async updateOpportunity(user: AuthUser, id: string, b: Partial<z.infer<typeof opportunitySchema>>, meta: RequestMeta) {
    const old = await this.prisma.opportunity.findFirst({ where: { ...ownerScope(user, 'OPPORTUNITY_MANAGE'), id, deletedAt: null } });
    if (!old) throw new NotFoundException();
    const { stageId: _ignored, ...rest } = b;
    void _ignored;
    const o = await this.prisma.opportunity.update({
      where: { id },
      data: {
        ...rest,
        expectedCloseDate: b.expectedCloseDate === undefined ? undefined : b.expectedCloseDate ? dateOnly(b.expectedCloseDate) : null,
        lineItems: b.lineItems as unknown as Prisma.InputJsonValue | undefined,
      },
    });
    await this.audit.log(user, { action: 'UPDATE', module: 'CRM', entity: 'Opportunity', entityId: id, oldValue: old, newValue: o }, meta);
    return o;
  }

  async move(user: AuthUser, id: string, b: z.infer<typeof moveSchema>, meta: RequestMeta) {
    const old = await this.prisma.opportunity.findFirst({ where: { ...ownerScope(user, 'OPPORTUNITY_MANAGE'), id, deletedAt: null } });
    if (!old) throw new NotFoundException();
    const stage = await this.prisma.pipelineStage.findFirst({ where: { id: b.stageId, companyId: user.companyId } });
    if (!stage) throw new BadRequestException('Stage not found');
    if (stage.isLost && !b.lostReason) throw new BadRequestException('A reason is required to mark an opportunity as lost');
    const status: OpportunityStatus = stage.isWon ? 'WON' : stage.isLost ? 'LOST' : 'OPEN';
    const o = await this.prisma.$transaction(async (tx) => {
      const row = await tx.opportunity.update({
        where: { id },
        data: { stageId: stage.id, probability: stage.probability, status, lostReason: stage.isLost ? b.lostReason : null, closedAt: status === 'OPEN' ? null : new Date() },
      });
      if (status === 'WON') await tx.customer.update({ where: { id: old.customerId }, data: { status: 'ACTIVE' } });
      await tx.activity.create({ data: { companyId: user.companyId, type: 'NOTE', subject: `Stage changed to ${stage.name}`, body: b.lostReason ?? null, opportunityId: id, customerId: old.customerId, userId: user.userId, completedAt: new Date() } });
      await this.audit.log(user, { action: 'MOVE_STAGE', module: 'CRM', entity: 'Opportunity', entityId: id, oldValue: { stageId: old.stageId, status: old.status }, newValue: { stageId: stage.id, status }, reason: b.lostReason }, meta, tx);
      return row;
    });
    return o;
  }

  /** Sales dashboard: pipeline value, weighted pipeline, won/lost, conversion, average deal size (in LKR). */
  async pipelineSummary(user: AuthUser, from?: string, to?: string) {
    const scope = ownerScope(user, 'OPPORTUNITY_VIEW');
    const [stages, opps, leadsTotal, leadsConverted] = await Promise.all([
      this.stages(user.companyId),
      this.prisma.opportunity.findMany({
        where: { ...scope, deletedAt: null, ...(from || to ? { createdAt: { gte: from ? dateOnly(from) : undefined, lte: to ? new Date(`${to}T23:59:59Z`) : undefined } } : {}) },
        select: { expectedValue: true, currency: true, probability: true, status: true, stageId: true },
      }),
      this.prisma.lead.count({ where: { ...ownerScope(user, 'LEAD_VIEW'), deletedAt: null } }),
      this.prisma.lead.count({ where: { ...ownerScope(user, 'LEAD_VIEW'), deletedAt: null, status: 'CONVERTED' } }),
    ]);
    const rates = new Map<string, number | null>();
    const missing = new Set<string>();
    const toLkr = async (v: number, cur: string) => {
      if (cur === 'LKR') return v;
      if (!rates.has(cur)) rates.set(cur, await this.fx.toLkr(user.companyId, cur, new Date()).catch(() => null));
      const r = rates.get(cur);
      if (r === null || r === undefined) {
        missing.add(cur);
        return 0;
      }
      return v * r;
    };
    const byStage = new Map<string, { count: number; value: number; weighted: number }>();
    let pipeline = 0;
    let weighted = 0;
    let wonValue = 0;
    let won = 0;
    let lost = 0;
    for (const o of opps) {
      const v = await toLkr(n(o.expectedValue), o.currency);
      const s = byStage.get(o.stageId) ?? { count: 0, value: 0, weighted: 0 };
      s.count++;
      s.value += v;
      s.weighted += (v * o.probability) / 100;
      byStage.set(o.stageId, s);
      if (o.status === 'OPEN') {
        pipeline += v;
        weighted += (v * o.probability) / 100;
      } else if (o.status === 'WON') {
        won++;
        wonValue += v;
      } else lost++;
    }
    const r2 = (x: number) => Math.round(x * 100) / 100;
    return {
      currency: 'LKR',
      pipelineValue: r2(pipeline),
      weightedPipeline: r2(weighted),
      won,
      lost,
      wonValue: r2(wonValue),
      winRate: won + lost ? Math.round((won / (won + lost)) * 1000) / 10 : 0,
      averageDealSize: won ? r2(wonValue / won) : 0,
      leadConversionRate: leadsTotal ? Math.round((leadsConverted / leadsTotal) * 1000) / 10 : 0,
      stages: stages.map((s) => ({ id: s.id, name: s.name, order: s.order, isWon: s.isWon, isLost: s.isLost, ...(byStage.get(s.id) ?? { count: 0, value: 0, weighted: 0 }) })),
      missingExchangeRates: [...missing],
    };
  }

  // ───────── Quotations / proforma invoices ─────────
  private async totals(companyId: string, lines: z.infer<typeof lineItem>[], fallbackValue: number, date = new Date()) {
    const items = lines.length ? lines : [{ description: 'Services as agreed', quantity: 1, unitPrice: fallbackValue, taxCode: null }];
    const codes = await this.prisma.taxCode.findMany({ where: { companyId, isActive: true, effectiveFrom: { lte: date }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }] }, orderBy: { effectiveFrom: 'desc' } });
    const taxBy = new Map<string, { name: string; rate: number; amount: number }>();
    const out = items.map((l) => {
      const amount = Math.round(l.quantity * l.unitPrice * 100) / 100;
      const tc = l.taxCode ? codes.find((c) => c.code === l.taxCode) : null;
      if (tc && !tc.isInclusive) {
        const t = taxBy.get(tc.code) ?? { name: tc.name, rate: n(tc.rate), amount: 0 };
        t.amount += amount * n(tc.rate);
        taxBy.set(tc.code, t);
      }
      return { ...l, amount };
    });
    const subtotal = out.reduce((s, l) => s + l.amount, 0);
    const taxes = [...taxBy.values()].map((t) => ({ ...t, amount: Math.round(t.amount * 100) / 100 }));
    return { lines: out, subtotal: Math.round(subtotal * 100) / 100, discount: 0, taxes, total: Math.round((subtotal + taxes.reduce((s, t) => s + t.amount, 0)) * 100) / 100 };
  }

  private async documentData(user: AuthUser, id: string, type: 'QUOTATION' | 'PROFORMA_INVOICE', number: string, validDays = 30) {
    const o = await this.getOpportunity(user, id);
    const contact = o.customer.contacts.find((c) => c.id === o.contactId) ?? o.customer.contacts.find((c) => c.isPrimary) ?? o.customer.contacts[0];
    const t = o.totals;
    return {
      doc: {
        type,
        title: type === 'QUOTATION' ? 'Quotation' : 'Proforma Invoice',
        number,
        date: ymd(new Date()),
        dueDate: ymd(new Date(Date.now() + validDays * 86400000)),
        currency: o.currency,
        reference: o.number,
        notes: o.notes,
      },
      customer: {
        name: o.customer.name,
        contactName: contact ? `${contact.firstName} ${contact.lastName ?? ''}`.trim() : '',
        address: o.customer.address,
        email: contact?.email ?? o.customer.email,
        tin: o.customer.tin,
        vatNumber: o.customer.vatNumber,
      },
      lines: t.lines,
      totals: { subtotal: t.subtotal, discount: t.discount, taxes: t.taxes, total: t.total },
      opportunity: o,
    };
  }

  /** Preview (number shown as DRAFT — no number is consumed). */
  async previewDocument(user: AuthUser, id: string, type: 'QUOTATION' | 'PROFORMA_INVOICE') {
    const data = await this.documentData(user, id, type, 'DRAFT');
    return this.docs.generate(user.companyId, type, data);
  }

  /** Issue (assigns a gap-free number) and email the document to the customer. */
  async sendDocument(user: AuthUser, id: string, b: z.infer<typeof sendDocSchema>, meta: RequestMeta) {
    const number = await this.seq.next(user.companyId, b.type);
    const data = await this.documentData(user, id, b.type, number, b.validDays);
    const doc = await this.docs.generate(user.companyId, b.type, data);
    const outboxId = await this.mail.send({
      companyId: user.companyId,
      templateKey: 'PROFORMA_INVOICE',
      to: b.to,
      cc: b.cc,
      language: 'en',
      data: { ...data, message: b.message, sender: { name: user.displayName } },
      attachments: doc.pdf
        ? [{ filename: `${number}.pdf`, contentType: 'application/pdf', content: doc.pdf }]
        : [{ filename: `${number}.html`, contentType: 'text/html', content: Buffer.from(doc.html) }],
      related: { entity: 'Opportunity', id },
    });
    await this.prisma.activity.create({
      data: { companyId: user.companyId, type: 'EMAIL', subject: `${data.doc.title} ${number} sent to ${b.to}`, body: b.message ?? null, opportunityId: id, customerId: data.opportunity.customerId, userId: user.userId, completedAt: new Date() },
    });
    await this.audit.log(user, { action: 'SEND_DOCUMENT', module: 'CRM', entity: 'Opportunity', entityId: id, newValue: { type: b.type, number, to: b.to, total: data.totals.total } }, meta);
    return { number, outboxId, format: doc.pdf ? 'pdf' : 'html' };
  }
}

const listQuery = pageQuery.extend({ status: z.string().optional(), ownerUserId: z.string().uuid().optional(), followUpDue: z.coerce.boolean().optional() });

@ApiTags('crm')
@ApiBearerAuth()
@Controller('crm')
export class CrmController {
  constructor(private readonly svc: CrmService, private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  // Customers
  @Get('customers')
  @RequirePermissions('CUSTOMER_VIEW')
  customers(@CurrentUser() u: AuthUser, @Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.svc.listCustomers(u, { ...q, status: q.status as CustomerStatus | undefined });
  }
  @Get('customers/:id')
  @RequirePermissions('CUSTOMER_VIEW')
  customer(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.customer360(u, id);
  }
  @Post('customers')
  @RequirePermissions('CUSTOMER_MANAGE')
  createCustomer(@CurrentUser() u: AuthUser, @Body(new ZodPipe(customerSchema)) b: z.infer<typeof customerSchema>, @ReqMeta() m: RequestMeta) {
    return this.svc.createCustomer(u, b, m);
  }
  @Patch('customers/:id')
  @RequirePermissions('CUSTOMER_MANAGE')
  updateCustomer(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(customerSchema.partial())) b: Partial<z.infer<typeof customerSchema>>, @ReqMeta() m: RequestMeta) {
    return this.svc.updateCustomer(u, id, b, m);
  }
  @Post('customers/:id/contacts')
  @RequirePermissions('CUSTOMER_MANAGE')
  addContact(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(contactSchema)) b: z.infer<typeof contactSchema>, @ReqMeta() m: RequestMeta) {
    return this.svc.upsertContact(u, id, null, b, m);
  }
  @Put('customers/:id/contacts/:contactId')
  @RequirePermissions('CUSTOMER_MANAGE')
  editContact(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('contactId', ParseUUIDPipe) cid: string, @Body(new ZodPipe(contactSchema)) b: z.infer<typeof contactSchema>, @ReqMeta() m: RequestMeta) {
    return this.svc.upsertContact(u, id, cid, b, m);
  }

  // Leads
  @Get('lead-sources')
  sources(@CurrentUser() u: AuthUser) {
    return this.prisma.leadSource.findMany({ where: { companyId: u.companyId }, orderBy: { name: 'asc' } });
  }
  @Post('lead-sources')
  @RequirePermissions('PIPELINE_CONFIG')
  addSource(@CurrentUser() u: AuthUser, @Body(new ZodPipe(z.object({ name: z.string().min(1) }))) b: { name: string }) {
    return this.prisma.leadSource.create({ data: { ...b, companyId: u.companyId } });
  }
  @Get('leads')
  @RequirePermissions('LEAD_VIEW')
  leads(@CurrentUser() u: AuthUser, @Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.svc.listLeads(u, { ...q, status: q.status as LeadStatus | undefined });
  }
  @Get('leads/:id')
  @RequirePermissions('LEAD_VIEW')
  lead(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getLead(u, id);
  }
  @Post('leads')
  @RequirePermissions('LEAD_MANAGE')
  createLead(@CurrentUser() u: AuthUser, @Body(new ZodPipe(leadSchema)) b: z.infer<typeof leadSchema>, @ReqMeta() m: RequestMeta) {
    return this.svc.createLead(u, b, m);
  }
  @Patch('leads/:id')
  @RequirePermissions('LEAD_MANAGE')
  updateLead(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(leadSchema.partial())) b: Partial<z.infer<typeof leadSchema>>, @ReqMeta() m: RequestMeta) {
    return this.svc.updateLead(u, id, b, m);
  }
  @Post('leads/:id/convert')
  @RequirePermissions('LEAD_MANAGE')
  convert(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(convertSchema)) b: z.infer<typeof convertSchema>, @ReqMeta() m: RequestMeta) {
    return this.svc.convertLead(u, id, b, m);
  }

  // Pipeline
  @Get('stages')
  stages(@CurrentUser() u: AuthUser) {
    return this.svc.stages(u.companyId);
  }
  @Post('stages')
  @RequirePermissions('PIPELINE_CONFIG')
  async addStage(@CurrentUser() u: AuthUser, @Body(new ZodPipe(stageSchema)) b: z.infer<typeof stageSchema>, @ReqMeta() m: RequestMeta) {
    const s = await this.prisma.pipelineStage.create({ data: { ...b, companyId: u.companyId } });
    await this.audit.log(u, { action: 'CREATE', module: 'CRM', entity: 'PipelineStage', entityId: s.id, newValue: s }, m);
    return s;
  }
  @Patch('stages/:id')
  @RequirePermissions('PIPELINE_CONFIG')
  async editStage(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(stageSchema.partial())) b: Partial<z.infer<typeof stageSchema>>, @ReqMeta() m: RequestMeta) {
    const old = await this.prisma.pipelineStage.findFirst({ where: { id, companyId: u.companyId } });
    if (!old) throw new NotFoundException();
    const s = await this.prisma.pipelineStage.update({ where: { id }, data: b });
    await this.audit.log(u, { action: 'UPDATE', module: 'CRM', entity: 'PipelineStage', entityId: id, oldValue: old, newValue: s }, m);
    return s;
  }
  @Get('pipeline/summary')
  @RequirePermissions('OPPORTUNITY_VIEW')
  summary(@CurrentUser() u: AuthUser, @Query(new ZodPipe(z.object({ from: ymdSchema.optional(), to: ymdSchema.optional() }))) q: { from?: string; to?: string }) {
    return this.svc.pipelineSummary(u, q.from, q.to);
  }

  // Opportunities
  @Get('opportunities')
  @RequirePermissions('OPPORTUNITY_VIEW')
  opportunities(@CurrentUser() u: AuthUser, @Query(new ZodPipe(z.object({ status: z.nativeEnum(OpportunityStatus).optional(), customerId: z.string().uuid().optional(), ownerUserId: z.string().uuid().optional(), search: z.string().optional() }))) q: { status?: OpportunityStatus; customerId?: string; ownerUserId?: string; search?: string }) {
    return this.svc.listOpportunities(u, q);
  }
  @Get('opportunities/:id')
  @RequirePermissions('OPPORTUNITY_VIEW')
  opportunity(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getOpportunity(u, id);
  }
  @Post('opportunities')
  @RequirePermissions('OPPORTUNITY_MANAGE')
  createOpportunity(@CurrentUser() u: AuthUser, @Body(new ZodPipe(opportunitySchema)) b: z.infer<typeof opportunitySchema>, @ReqMeta() m: RequestMeta) {
    return this.svc.createOpportunity(u, b, m);
  }
  @Patch('opportunities/:id')
  @RequirePermissions('OPPORTUNITY_MANAGE')
  updateOpportunity(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(opportunitySchema.partial())) b: Partial<z.infer<typeof opportunitySchema>>, @ReqMeta() m: RequestMeta) {
    return this.svc.updateOpportunity(u, id, b, m);
  }
  @Post('opportunities/:id/move')
  @RequirePermissions('OPPORTUNITY_MANAGE')
  move(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(moveSchema)) b: z.infer<typeof moveSchema>, @ReqMeta() m: RequestMeta) {
    return this.svc.move(u, id, b, m);
  }
  @Get('opportunities/:id/document')
  @RequirePermissions('INVOICE_PRINT')
  async document(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query('type') type: string, @Res() res: Response) {
    const t = docTypeSchema.parse(type ?? 'QUOTATION');
    const doc = await this.svc.previewDocument(u, id, t);
    return DocumentService.send(res, doc, `${t.toLowerCase()}-draft`);
  }
  @Post('opportunities/:id/send-document')
  @RequirePermissions('INVOICE_PRINT')
  sendDocument(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(sendDocSchema)) b: z.infer<typeof sendDocSchema>, @ReqMeta() m: RequestMeta) {
    return this.svc.sendDocument(u, id, b, m);
  }

  // Activities
  @Get('activities')
  async activities(@CurrentUser() u: AuthUser, @Query(new ZodPipe(z.object({ leadId: z.string().uuid().optional(), customerId: z.string().uuid().optional(), opportunityId: z.string().uuid().optional(), mine: z.coerce.boolean().optional(), open: z.coerce.boolean().optional() }))) q: { leadId?: string; customerId?: string; opportunityId?: string; mine?: boolean; open?: boolean }) {
    return this.prisma.activity.findMany({
      where: { companyId: u.companyId, leadId: q.leadId, customerId: q.customerId, opportunityId: q.opportunityId, ...(q.mine ? { userId: u.userId } : {}), ...(q.open ? { completedAt: null } : {}) },
      include: { lead: { select: { id: true, name: true, number: true } }, customer: { select: { id: true, name: true } }, opportunity: { select: { id: true, title: true, number: true } } },
      orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }],
      take: 200,
    });
  }
  @Post('activities')
  async addActivity(@CurrentUser() u: AuthUser, @Body(new ZodPipe(activitySchema)) b: z.infer<typeof activitySchema>) {
    if (!('LEAD_MANAGE' in u.permissions || 'CUSTOMER_MANAGE' in u.permissions || 'OPPORTUNITY_MANAGE' in u.permissions)) throw new BadRequestException('Not permitted');
    return this.prisma.activity.create({ data: { ...b, dueAt: b.dueAt ? new Date(b.dueAt) : null, companyId: u.companyId, userId: u.userId, completedAt: b.type === 'NOTE' ? new Date() : null } });
  }
  @Post('activities/:id/complete')
  @HttpCode(200)
  async complete(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const a = await this.prisma.activity.findFirst({ where: { id, companyId: u.companyId } });
    if (!a) throw new NotFoundException();
    return this.prisma.activity.update({ where: { id }, data: { completedAt: new Date() } });
  }
  @Delete('activities/:id')
  @HttpCode(204)
  async deleteActivity(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const a = await this.prisma.activity.findFirst({ where: { id, companyId: u.companyId, userId: u.userId } });
    if (!a) throw new NotFoundException();
    await this.prisma.activity.delete({ where: { id } });
  }
}

@Module({ providers: [CrmService], controllers: [CrmController] })
export class CrmModule {}
