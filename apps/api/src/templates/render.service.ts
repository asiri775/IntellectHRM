import { Injectable, Logger } from '@nestjs/common';
import Handlebars from 'handlebars';
import { config } from '../config';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../files/files.module';

type HB = typeof Handlebars;

function formatDate(value: unknown, fmt: string): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = String(d.getUTCFullYear());
  return fmt.replace('DD', dd).replace('MM', mm).replace('YYYY', yyyy);
}

function createEngine(): HB {
  const hb = Handlebars.create();
  hb.registerHelper('money', (amount: unknown, currency: unknown) => {
    const n = Number(amount ?? 0);
    const s = new Intl.NumberFormat('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
    return typeof currency === 'string' ? `${currency} ${s}` : s;
  });
  hb.registerHelper('date', function (this: unknown, value: unknown, options: Handlebars.HelperOptions) {
    const fmt = (options?.data?.root?._dateFormat as string) || 'DD/MM/YYYY';
    return formatDate(value, fmt);
  });
  hb.registerHelper('percent', (rate: unknown) => `${(Number(rate) * 100).toFixed(2).replace(/\.00$/, '')}%`);
  hb.registerHelper('eq', (a: unknown, b: unknown) => a === b);
  hb.registerHelper('and', (...args: unknown[]) => args.slice(0, -1).every(Boolean));
  hb.registerHelper('or', (...args: unknown[]) => args.slice(0, -1).some(Boolean));
  hb.registerHelper('inc', (i: unknown) => Number(i) + 1);
  return hb;
}

export interface CompanyBranding {
  id: string;
  name: string;
  legalName: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  tin: string | null;
  vatNumber: string | null;
  primaryColor: string;
  accentColor: string;
  emailFooter: string | null;
  dateFormat: string;
  logoFileId: string | null;
  /** Public URL of the logo (for emails / screens). */
  logoUrl: string | null;
}

/**
 * Renders Handlebars templates stored in the database. Compiled templates are
 * cached by source text so edits take effect immediately without a restart.
 */
@Injectable()
export class RenderService {
  private readonly logger = new Logger(RenderService.name);
  private readonly hb = createEngine();
  private readonly cache = new Map<string, Handlebars.TemplateDelegate>();

  constructor(private readonly prisma: PrismaService, private readonly storage: StorageService) {}

  render(source: string, context: Record<string, unknown>): string {
    let fn = this.cache.get(source);
    if (!fn) {
      fn = this.hb.compile(source, { strict: false });
      if (this.cache.size > 500) this.cache.clear();
      this.cache.set(source, fn);
    }
    return fn(context);
  }

  /** Throws a readable error if a template does not compile. */
  validate(source: string) {
    try {
      this.hb.precompile(source);
    } catch (e) {
      throw new Error(`Template syntax error: ${(e as Error).message}`);
    }
  }

  async branding(companyId: string): Promise<CompanyBranding> {
    const c = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    return {
      id: c.id,
      name: c.name,
      legalName: c.legalName,
      address: c.address,
      phone: c.phone,
      email: c.email,
      website: c.website,
      tin: c.tin,
      vatNumber: c.vatNumber,
      primaryColor: c.primaryColor,
      accentColor: c.accentColor,
      emailFooter: c.emailFooter,
      dateFormat: c.dateFormat,
      logoFileId: c.logoFileId,
      logoUrl: c.logoFileId ? `${config.API_PUBLIC_URL}/api/public/files/${c.logoFileId}` : null,
    };
  }

  /**
   * Render an email: picks the template in the recipient's language (falls back
   * to English), renders the body, then wraps it in the editable LAYOUT template.
   */
  async renderEmail(companyId: string, key: string, language: string, data: Record<string, unknown>) {
    const templates = await this.prisma.emailTemplate.findMany({
      where: { companyId, key: { in: [key, 'LAYOUT'] }, language: { in: [language, 'en'] }, isActive: true },
    });
    const pick = (k: string) => templates.find((t) => t.key === k && t.language === language) ?? templates.find((t) => t.key === k && t.language === 'en');
    const tpl = pick(key);
    if (!tpl) throw new Error(`Email template ${key} not found`);
    const layout = pick('LAYOUT');
    const company = await this.branding(companyId);
    const ctx = { ...data, company, appUrl: config.APP_URL, year: new Date().getFullYear(), _dateFormat: company.dateFormat };
    const subject = this.render(tpl.subject, ctx);
    const content = this.render(tpl.bodyHtml, ctx);
    const html = layout ? this.render(layout.bodyHtml, { ...ctx, subject, content }) : content;
    return { subject, html, company };
  }

  /** Render a document template (invoice, quotation, payslip) to a full HTML page. */
  async renderDocument(templateId: string, data: Record<string, unknown>) {
    const tpl = await this.prisma.documentTemplate.findUniqueOrThrow({ where: { id: templateId } });
    return this.renderDocumentWith(tpl.companyId, { ...tpl, options: tpl.options as Record<string, unknown> }, data);
  }

  /** Render from template source (saved or unsaved edits from the editor). */
  async renderDocumentWith(
    companyId: string,
    tpl: { html: string; css: string; options: Record<string, unknown>; language: string; name: string },
    data: Record<string, unknown>,
  ) {
    const company = await this.branding(companyId);
    const logo = await this.storage.dataUri(company.logoFileId);
    const options = { ...tpl.options, ...((data.options as Record<string, unknown>) ?? {}) };
    const ctx = {
      ...data,
      options,
      company: { ...company, logo },
      theme: { primary: (options.primaryColor as string) || company.primaryColor, accent: company.accentColor },
      _dateFormat: company.dateFormat,
    };
    const css = this.render(tpl.css, ctx);
    const body = this.render(tpl.html, ctx);
    const title = String((data.doc as { number?: string } | undefined)?.number ?? tpl.name);
    return `<!doctype html><html lang="${tpl.language}"><head><meta charset="utf-8"><title>${Handlebars.escapeExpression(title)}</title><style>${css}</style></head><body>${body}</body></html>`;
  }
}
