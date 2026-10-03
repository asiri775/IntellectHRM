import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Global,
  Header,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { DocumentTemplateType, Prisma } from '@prisma/client';
import { calculatePayslip, DEFAULT_SRI_LANKA_RULES, DOCUMENT_TEMPLATE_TYPES, EMAIL_TEMPLATE_KEYS } from '@ihrm/shared';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.module';
import { CurrentUser, ReqMeta, RequirePermissions } from '../common/decorators';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { ZodPipe } from '../common/zod.pipe';
import { RenderService } from './render.service';
import { PdfService } from './pdf.service';
import { DEFAULT_DOCUMENT_TEMPLATES, DEFAULT_EMAIL_TEMPLATES, PAYSLIP_LABELS } from './defaults';

/** Picks the default template for a document type and renders HTML + (if available) PDF. */
@Injectable()
export class DocumentService {
  constructor(private readonly prisma: PrismaService, private readonly render: RenderService, private readonly pdf: PdfService) {}

  async template(companyId: string, type: DocumentTemplateType, language = 'en') {
    const all = await this.prisma.documentTemplate.findMany({ where: { companyId, type }, orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }] });
    const t = all.find((x) => x.language === language && x.isDefault) ?? all.find((x) => x.isDefault) ?? all[0];
    if (!t) throw new NotFoundException(`No ${type} template configured`);
    return t;
  }

  async generate(companyId: string, type: DocumentTemplateType, data: Record<string, unknown>, opts: { language?: string; templateId?: string } = {}) {
    const tpl = opts.templateId
      ? await this.prisma.documentTemplate.findFirstOrThrow({ where: { id: opts.templateId, companyId } })
      : await this.template(companyId, type, opts.language);
    const html = await this.render.renderDocument(tpl.id, data);
    const pdf = await this.pdf.render(html);
    return { html, pdf, templateId: tpl.id };
  }

  /** Send a generated document to the browser as PDF, or HTML when no PDF engine is configured. */
  static send(res: Response, doc: { html: string; pdf: Buffer | null }, filename: string, download = false) {
    if (doc.pdf) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${filename}.pdf"`);
      return res.send(doc.pdf);
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data: https: http:");
    res.setHeader('X-Document-Format', 'html');
    return res.send(doc.html);
  }
}

export function sampleInvoiceData(type: string) {
  const lines = [
    { description: 'Web application development – Phase 1 (React + NestJS)', quantity: 1, unitPrice: 450000, taxCode: 'VAT', amount: 450000 },
    { description: 'UI/UX design – 12 screens', quantity: 12, unitPrice: 15000, taxCode: 'VAT', amount: 180000 },
    { description: 'Cloud hosting setup (AWS)', quantity: 1, unitPrice: 60000, taxCode: 'VAT', amount: 60000 },
  ];
  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const vat = Math.round(subtotal * 0.18 * 100) / 100;
  return {
    doc: {
      type,
      title: type === 'QUOTATION' ? 'Quotation' : type === 'PROFORMA_INVOICE' ? 'Proforma Invoice' : 'Tax Invoice',
      number: `${type === 'QUOTATION' ? 'QT' : type === 'PROFORMA_INVOICE' ? 'PI' : 'INV'}-2026-000123`,
      date: new Date().toISOString().slice(0, 10),
      dueDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      currency: 'LKR',
      reference: 'OPP-2026-00042',
      notes: 'Sample data for preview only.',
    },
    customer: { name: 'Sample Customer (Pvt) Ltd', contactName: 'Nimal Perera', address: '123 Galle Road, Colombo 03', email: 'accounts@example.com', tin: '123456789', vatNumber: '123456789-7000' },
    lines,
    totals: { subtotal, discount: 0, taxes: [{ name: 'VAT', rate: 0.18, amount: vat }], total: subtotal + vat },
  };
}

export function samplePayslipData(language: string) {
  const slip = calculatePayslip(
    {
      employmentType: 'CONTRACT',
      currency: 'LKR',
      exchangeRateToLkr: 1,
      earnings: [
        { code: 'BASIC', name: 'Basic salary', amount: 180000, epfApplicable: true, taxable: true, fixed: true },
        { code: 'TRAVEL', name: 'Travel allowance', amount: 20000, epfApplicable: false, taxable: true, fixed: true },
      ],
      deductions: [],
      workingDays: 22,
      employedDays: 22,
      noPayDays: 0,
    },
    DEFAULT_SRI_LANKA_RULES,
  );
  return {
    ...slip,
    t: PAYSLIP_LABELS[language] ?? PAYSLIP_LABELS.en,
    period: 'September 2026',
    employee: { name: 'Sample Employee', employeeNo: 'EMP0001', designation: 'Software Engineer', department: 'Software Development', employmentType: 'CONTRACT', epfNumber: '12345', bank: 'Commercial Bank ••••6789' },
    payslip: { number: 'PS-202609-00001', workingDays: 22, employedDays: 22, noPayDays: 0 },
  };
}

function sampleEmailData(key: string): Record<string, unknown> {
  const employee = { id: '00000000-0000-0000-0000-000000000001', name: 'Kasun Silva', employeeNo: 'EMP0007' };
  const leave = { type: 'Annual leave', days: 2, startDate: '2026-10-12', endDate: '2026-10-13', reason: 'Family event' };
  const lead = { id: '00000000-0000-0000-0000-000000000002', number: 'LD-2026-00012', name: 'Dilani Fernando', companyName: 'Acme Lanka', serviceInterest: 'Mobile app' };
  return {
    user: { displayName: 'Kasun Silva', email: 'kasun@example.com' },
    approver: { name: 'Team Lead' },
    employee,
    leave,
    comment: 'Enjoy your time off.',
    period: 'September 2026',
    netPay: 171000,
    currency: 'LKR',
    daysLeft: 30,
    contract: { endDate: '2026-11-03' },
    workDate: '2026-10-02',
    lead,
    owner: { name: 'Sales Executive' },
    doc: { title: 'Quotation', number: 'QT-2026-000123', currency: 'LKR' },
    totals: { total: 814200 },
    customer: { contactName: 'Nimal Perera' },
    sender: { name: 'Sales Team' },
    message: '',
    subject: `Preview: ${key}`,
  };
}

const emailUpdateSchema = z.object({
  subject: z.string().min(1).max(300),
  bodyHtml: z.string().min(1).max(100_000),
  name: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
});
const emailCreateSchema = emailUpdateSchema.extend({
  key: z.enum(EMAIL_TEMPLATE_KEYS),
  language: z.enum(['en', 'si', 'ta']),
  name: z.string().min(1),
});
const docSchema = z.object({
  name: z.string().min(1),
  type: z.enum(DOCUMENT_TEMPLATE_TYPES),
  language: z.enum(['en', 'si', 'ta']).default('en'),
  html: z.string().min(1).max(200_000),
  css: z.string().max(100_000).default(''),
  options: z.record(z.unknown()).default({}),
  isDefault: z.boolean().default(false),
});
const previewSchema = z.object({
  html: z.string().optional(),
  css: z.string().optional(),
  options: z.record(z.unknown()).optional(),
  subject: z.string().optional(),
  bodyHtml: z.string().optional(),
  language: z.enum(['en', 'si', 'ta']).default('en'),
});

@ApiTags('templates')
@ApiBearerAuth()
@Controller('templates')
export class TemplatesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly render: RenderService,
    private readonly docs: DocumentService,
    private readonly audit: AuditService,
  ) {}

  // ── Email templates ──
  @Get('email')
  @RequirePermissions('TEMPLATE_MANAGE')
  emailList(@CurrentUser() user: AuthUser) {
    return this.prisma.emailTemplate.findMany({ where: { companyId: user.companyId }, orderBy: [{ key: 'asc' }, { language: 'asc' }] });
  }

  @Post('email')
  @RequirePermissions('TEMPLATE_MANAGE')
  async emailCreate(@CurrentUser() user: AuthUser, @Body(new ZodPipe(emailCreateSchema)) body: z.infer<typeof emailCreateSchema>, @ReqMeta() meta: RequestMeta) {
    this.check(body.subject, body.bodyHtml);
    const row = await this.prisma.emailTemplate.create({ data: { ...body, companyId: user.companyId, updatedBy: user.userId } });
    await this.audit.log(user, { action: 'CREATE', module: 'ADMIN', entity: 'EmailTemplate', entityId: row.id, newValue: { key: row.key, language: row.language } }, meta);
    return row;
  }

  @Patch('email/:id')
  @RequirePermissions('TEMPLATE_MANAGE')
  async emailUpdate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(emailUpdateSchema)) body: z.infer<typeof emailUpdateSchema>, @ReqMeta() meta: RequestMeta) {
    const old = await this.prisma.emailTemplate.findFirst({ where: { id, companyId: user.companyId } });
    if (!old) throw new NotFoundException();
    this.check(body.subject, body.bodyHtml);
    const row = await this.prisma.emailTemplate.update({ where: { id }, data: { ...body, updatedBy: user.userId } });
    await this.audit.log(user, { action: 'UPDATE', module: 'ADMIN', entity: 'EmailTemplate', entityId: id, oldValue: { subject: old.subject, bodyHtml: old.bodyHtml }, newValue: body }, meta);
    return row;
  }

  @Post('email/:id/reset')
  @RequirePermissions('TEMPLATE_MANAGE')
  async emailReset(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    const row = await this.prisma.emailTemplate.findFirst({ where: { id, companyId: user.companyId } });
    if (!row) throw new NotFoundException();
    const def = DEFAULT_EMAIL_TEMPLATES.find((t) => t.key === row.key && t.language === row.language);
    if (!def) throw new BadRequestException('No built-in default for this template');
    await this.audit.log(user, { action: 'RESET', module: 'ADMIN', entity: 'EmailTemplate', entityId: id }, meta);
    return this.prisma.emailTemplate.update({ where: { id }, data: { subject: def.subject, bodyHtml: def.bodyHtml, updatedBy: user.userId } });
  }

  /** Live preview with sample data — the editor posts unsaved changes here. */
  @Post('email/:id/preview')
  @RequirePermissions('TEMPLATE_MANAGE')
  async emailPreview(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(previewSchema)) body: z.infer<typeof previewSchema>) {
    const tpl = await this.prisma.emailTemplate.findFirst({ where: { id, companyId: user.companyId } });
    if (!tpl) throw new NotFoundException();
    const company = await this.render.branding(user.companyId);
    const data = { ...sampleEmailData(tpl.key), company, appUrl: '#', _dateFormat: company.dateFormat };
    try {
      if (tpl.key === 'LAYOUT') {
        const html = this.render.render(body.bodyHtml ?? tpl.bodyHtml, { ...data, content: '<p>Hello Kasun,</p><p>This is where the message body appears. Every email uses this layout.</p>' });
        return { subject: 'Layout preview', html };
      }
      const layout = await this.prisma.emailTemplate.findFirst({ where: { companyId: user.companyId, key: 'LAYOUT', language: 'en' } });
      const subject = this.render.render(body.subject ?? tpl.subject, data);
      const content = this.render.render(body.bodyHtml ?? tpl.bodyHtml, data);
      const html = layout ? this.render.render(layout.bodyHtml, { ...data, subject, content }) : content;
      return { subject, html };
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }

  // ── Document templates (invoice / quotation / proforma / payslip) ──
  @Get('documents')
  @RequirePermissions('TEMPLATE_MANAGE')
  docList(@CurrentUser() user: AuthUser, @Query('type') type?: string) {
    return this.prisma.documentTemplate.findMany({
      where: { companyId: user.companyId, ...(type ? { type: type as DocumentTemplateType } : {}) },
      orderBy: [{ type: 'asc' }, { isDefault: 'desc' }, { name: 'asc' }],
    });
  }

  @Post('documents')
  @RequirePermissions('TEMPLATE_MANAGE')
  async docCreate(@CurrentUser() user: AuthUser, @Body(new ZodPipe(docSchema)) body: z.infer<typeof docSchema>, @ReqMeta() meta: RequestMeta) {
    this.check(body.html, body.css);
    const row = await this.prisma.$transaction(async (tx) => {
      if (body.isDefault) await tx.documentTemplate.updateMany({ where: { companyId: user.companyId, type: body.type, language: body.language }, data: { isDefault: false } });
      return tx.documentTemplate.create({ data: { ...body, options: body.options as Prisma.InputJsonValue, companyId: user.companyId, updatedBy: user.userId } });
    });
    await this.audit.log(user, { action: 'CREATE', module: 'ADMIN', entity: 'DocumentTemplate', entityId: row.id, newValue: { name: row.name, type: row.type } }, meta);
    return row;
  }

  @Patch('documents/:id')
  @RequirePermissions('TEMPLATE_MANAGE')
  async docUpdate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(docSchema.partial())) body: Partial<z.infer<typeof docSchema>>, @ReqMeta() meta: RequestMeta) {
    const old = await this.prisma.documentTemplate.findFirst({ where: { id, companyId: user.companyId } });
    if (!old) throw new NotFoundException();
    this.check(body.html ?? old.html, body.css ?? old.css);
    const row = await this.prisma.$transaction(async (tx) => {
      if (body.isDefault) await tx.documentTemplate.updateMany({ where: { companyId: user.companyId, type: old.type, language: body.language ?? old.language, id: { not: id } }, data: { isDefault: false } });
      return tx.documentTemplate.update({
        where: { id },
        data: { ...body, options: body.options as Prisma.InputJsonValue | undefined, version: { increment: 1 }, updatedBy: user.userId },
      });
    });
    await this.audit.log(user, { action: 'UPDATE', module: 'ADMIN', entity: 'DocumentTemplate', entityId: id, oldValue: { version: old.version, options: old.options }, newValue: { version: row.version, options: row.options } }, meta);
    return row;
  }

  @Post('documents/:id/reset')
  @RequirePermissions('TEMPLATE_MANAGE')
  async docReset(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    const row = await this.prisma.documentTemplate.findFirst({ where: { id, companyId: user.companyId } });
    if (!row) throw new NotFoundException();
    const def = DEFAULT_DOCUMENT_TEMPLATES.find((t) => t.type === row.type)!;
    await this.audit.log(user, { action: 'RESET', module: 'ADMIN', entity: 'DocumentTemplate', entityId: id }, meta);
    return this.prisma.documentTemplate.update({ where: { id }, data: { html: def.html, css: def.css, options: def.options, version: { increment: 1 }, updatedBy: user.userId } });
  }

  /** Preview a document template (saved or unsaved edits) with sample data. Returns HTML. */
  @Post('documents/:id/preview')
  @RequirePermissions('TEMPLATE_MANAGE')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async docPreview(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(previewSchema)) body: z.infer<typeof previewSchema>) {
    const tpl = await this.prisma.documentTemplate.findFirst({ where: { id, companyId: user.companyId } });
    if (!tpl) throw new NotFoundException();
    const data = tpl.type === 'PAYSLIP' ? samplePayslipData(body.language) : sampleInvoiceData(tpl.type);
    try {
      return await this.render.renderDocumentWith(
        user.companyId,
        {
          html: body.html ?? tpl.html,
          css: body.css ?? tpl.css,
          options: { ...(tpl.options as Record<string, unknown>), ...(body.options ?? {}) },
          language: tpl.language,
          name: tpl.name,
        },
        data,
      );
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }

  /** Download a sample PDF of a document template. */
  @Get('documents/:id/sample')
  @RequirePermissions('TEMPLATE_MANAGE')
  async docSample(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const tpl = await this.prisma.documentTemplate.findFirst({ where: { id, companyId: user.companyId } });
    if (!tpl) throw new NotFoundException();
    const data = tpl.type === 'PAYSLIP' ? samplePayslipData(tpl.language) : sampleInvoiceData(tpl.type);
    const doc = await this.docs.generate(user.companyId, tpl.type, data, { templateId: tpl.id });
    return DocumentService.send(res, doc, `sample-${tpl.type.toLowerCase()}`);
  }

  private check(...sources: string[]) {
    for (const s of sources) {
      try {
        this.render.validate(s);
      } catch (e) {
        throw new BadRequestException((e as Error).message);
      }
    }
  }
}

@Global()
@Module({
  providers: [RenderService, PdfService, DocumentService],
  controllers: [TemplatesController],
  exports: [RenderService, PdfService, DocumentService],
})
export class TemplatesModule {}
