import { Global, Injectable, Logger, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import nodemailer, { type Transporter } from 'nodemailer';
import { randomUUID } from 'node:crypto';
import { config } from '../config';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../files/files.module';
import { RenderService } from '../templates/render.service';

export interface MailAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
}

interface StoredAttachment {
  filename: string;
  contentType: string;
  storageKey: string;
}

/** Provider interface — swap SMTP for SES/SendGrid by adding another implementation. */
interface MailProvider {
  send(msg: { from: string; to: string; cc?: string; subject: string; html: string; attachments: { filename: string; contentType: string; content: Buffer; cid?: string }[] }): Promise<void>;
}

class LogProvider implements MailProvider {
  private readonly logger = new Logger('MailLogProvider');
  async send(msg: Parameters<MailProvider['send']>[0]) {
    this.logger.log(`[MAIL_PROVIDER=log] to=${msg.to} subject="${msg.subject}" attachments=${msg.attachments.length}`);
  }
}

class SmtpProvider implements MailProvider {
  private readonly transport: Transporter;
  constructor() {
    this.transport = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
      pool: true, // reuse connections for bulk sends (payslip runs)
      maxConnections: 5,
    });
  }
  async send(msg: Parameters<MailProvider['send']>[0]) {
    await this.transport.sendMail(msg);
  }
}

const QUEUE = 'email';

/**
 * Email pipeline: render template → persist to outbox → queue → send with retries.
 * With REDIS_URL set, sending happens in a BullMQ worker (horizontally scalable,
 * exponential back-off, survives restarts). Without Redis it sends in-process.
 */
@Injectable()
export class MailService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MailService.name);
  private readonly provider: MailProvider = config.MAIL_PROVIDER === 'smtp' ? new SmtpProvider() : new LogProvider();
  private queue?: Queue;
  private worker?: Worker;
  private connection?: IORedis;

  constructor(
    private readonly prisma: PrismaService,
    private readonly render: RenderService,
    private readonly storage: StorageService,
  ) {}

  onModuleInit() {
    if (!config.REDIS_URL) {
      this.logger.warn('REDIS_URL not set: emails are sent in-process without a queue');
      return;
    }
    this.connection = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });
    this.queue = new Queue(QUEUE, { connection: this.connection });
    this.worker = new Worker(QUEUE, async (job) => this.deliver(job.data.outboxId as string), {
      connection: this.connection,
      concurrency: 5,
      limiter: { max: 20, duration: 1000 }, // stay under provider rate limits
    });
    this.worker.on('failed', (job, err) => this.logger.warn(`Email job ${job?.id} failed: ${err.message}`));
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
    this.connection?.disconnect();
  }

  /** Render a template and queue it. Returns the outbox id. */
  async send(opts: {
    companyId: string;
    templateKey: string;
    to: string;
    cc?: string;
    language?: string;
    data: Record<string, unknown>;
    attachments?: MailAttachment[];
    related?: { entity: string; id: string };
  }): Promise<string> {
    const { subject, html } = await this.render.renderEmail(opts.companyId, opts.templateKey, opts.language ?? 'en', opts.data);
    const stored: StoredAttachment[] = [];
    for (const a of opts.attachments ?? []) {
      const key = `${opts.companyId}/mail/${randomUUID()}-${a.filename.replace(/[^\w.-]/g, '_')}`;
      const { mkdir, writeFile } = await import('node:fs/promises');
      const { dirname } = await import('node:path');
      const path = this.storage.path(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, a.content);
      stored.push({ filename: a.filename, contentType: a.contentType, storageKey: key });
    }
    const row = await this.prisma.emailOutbox.create({
      data: {
        companyId: opts.companyId,
        templateKey: opts.templateKey,
        to: opts.to,
        cc: opts.cc,
        subject,
        html,
        attachments: stored as unknown as object,
        relatedEntity: opts.related?.entity,
        relatedId: opts.related?.id,
      },
    });
    if (this.queue) {
      await this.queue.add('send', { outboxId: row.id }, { jobId: row.id, attempts: 5, backoff: { type: 'exponential', delay: 30_000 }, removeOnComplete: 1000, removeOnFail: 5000 });
    } else {
      setImmediate(() => this.deliver(row.id).catch((e) => this.logger.error(e.message)));
    }
    return row.id;
  }

  /** Send one outbox row. Inlines the company logo as a CID image so it shows even when remote images are blocked. */
  async deliver(outboxId: string) {
    const row = await this.prisma.emailOutbox.findUnique({ where: { id: outboxId } });
    if (!row || row.status === 'SENT') return;
    const attachments: { filename: string; contentType: string; content: Buffer; cid?: string }[] = [];
    for (const a of row.attachments as unknown as StoredAttachment[]) {
      attachments.push({ filename: a.filename, contentType: a.contentType, content: await this.storage.readBuffer(a.storageKey) });
    }
    let html = row.html;
    const company = await this.prisma.company.findUnique({ where: { id: row.companyId } });
    if (company?.logoFileId) {
      const logo = await this.prisma.storedFile.findUnique({ where: { id: company.logoFileId } });
      const publicUrl = `${config.API_PUBLIC_URL}/api/public/files/${company.logoFileId}`;
      if (logo && html.includes(publicUrl)) {
        html = html.split(publicUrl).join('cid:company-logo');
        attachments.push({ filename: logo.originalName, contentType: logo.mimeType, content: await this.storage.readBuffer(logo.storageKey), cid: 'company-logo' });
      }
    }
    try {
      await this.provider.send({ from: config.MAIL_FROM, to: row.to, cc: row.cc ?? undefined, subject: row.subject, html, attachments });
      await this.prisma.emailOutbox.update({ where: { id: row.id }, data: { status: 'SENT', sentAt: new Date(), attempts: { increment: 1 } } });
    } catch (e) {
      await this.prisma.emailOutbox.update({
        where: { id: row.id },
        data: { status: 'FAILED', lastError: (e as Error).message.slice(0, 1000), attempts: { increment: 1 } },
      });
      throw e; // let BullMQ retry
    }
  }

  /** Re-queue a failed email (admin action). */
  async retry(companyId: string, outboxId: string) {
    const row = await this.prisma.emailOutbox.findFirst({ where: { id: outboxId, companyId } });
    if (!row) return false;
    await this.prisma.emailOutbox.update({ where: { id: row.id }, data: { status: 'QUEUED', lastError: null } });
    if (this.queue) await this.queue.add('send', { outboxId: row.id }, { attempts: 5, backoff: { type: 'exponential', delay: 30_000 } });
    else await this.deliver(row.id);
    return true;
  }
}

@Global()
@Module({ providers: [MailService], exports: [MailService] })
export class MailModule {}
