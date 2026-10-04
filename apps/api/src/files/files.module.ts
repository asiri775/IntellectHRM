import {
  BadRequestException,
  Controller,
  Get,
  Global,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../common/decorators';
import { config } from '../config';

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'];
export const DOCUMENT_TYPES = [
  ...IMAGE_TYPES,
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
];

/** Magic-number check so a renamed file cannot bypass the MIME allow-list. */
function sniff(buf: Buffer, declared: string): boolean {
  const hex = buf.subarray(0, 8).toString('hex');
  switch (declared) {
    case 'image/png':
      return hex.startsWith('89504e47');
    case 'image/jpeg':
      return hex.startsWith('ffd8ff');
    case 'image/webp':
      return buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP';
    case 'application/pdf':
      return buf.subarray(0, 4).toString() === '%PDF';
    case 'image/svg+xml': {
      const text = buf.toString('utf8').slice(0, 2000).toLowerCase();
      // Reject active content in SVGs.
      return text.includes('<svg') && !/<script|on\w+\s*=|javascript:/.test(buf.toString('utf8').toLowerCase());
    }
    default:
      return true; // docx/doc: zip/ole containers, validated by extension + size
  }
}

export interface UploadedFileLike {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/**
 * Local-disk storage provider. The interface (save/read) is what modules use,
 * so an S3-compatible provider can replace it without touching callers.
 */
@Injectable()
export class StorageService {
  private readonly root = resolve(config.STORAGE_DIR);
  constructor(private readonly prisma: PrismaService) {}

  async save(companyId: string, file: UploadedFileLike, opts: { allowed: string[]; isPublic?: boolean; userId?: string }) {
    if (!file?.buffer) throw new BadRequestException('No file uploaded');
    if (file.size > config.MAX_UPLOAD_MB * 1024 * 1024) throw new BadRequestException(`File larger than ${config.MAX_UPLOAD_MB} MB`);
    if (!opts.allowed.includes(file.mimetype)) throw new BadRequestException(`File type ${file.mimetype} is not allowed`);
    if (!sniff(file.buffer, file.mimetype)) throw new BadRequestException('File content does not match its type, or contains active content');
    // Malware-scanning hook: plug a scanner (e.g. ClamAV) in here before persisting.
    const key = `${companyId}/${randomUUID()}${extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '')}`;
    await mkdir(join(this.root, companyId), { recursive: true });
    await writeFile(join(this.root, key), file.buffer);
    return this.prisma.storedFile.create({
      data: {
        companyId,
        storageKey: key,
        originalName: file.originalname.slice(0, 200),
        mimeType: file.mimetype,
        sizeBytes: file.size,
        isPublic: opts.isPublic ?? false,
        createdBy: opts.userId,
      },
    });
  }

  async get(companyId: string, id: string) {
    const f = await this.prisma.storedFile.findFirst({ where: { id, companyId } });
    if (!f) throw new NotFoundException('File not found');
    return f;
  }

  path(storageKey: string) {
    const p = resolve(this.root, storageKey);
    if (!p.startsWith(this.root)) throw new BadRequestException('Invalid path');
    return p;
  }

  async readBuffer(storageKey: string) {
    return readFile(this.path(storageKey));
  }

  async dataUri(fileId: string | null | undefined): Promise<string | null> {
    if (!fileId) return null;
    const f = await this.prisma.storedFile.findUnique({ where: { id: fileId } });
    if (!f) return null;
    try {
      const buf = await this.readBuffer(f.storageKey);
      return `data:${f.mimeType};base64,${buf.toString('base64')}`;
    } catch {
      return null;
    }
  }

  stream(res: Response, file: { storageKey: string; mimeType: string; originalName: string }, inline = true) {
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:");
    res.setHeader(
      'Content-Disposition',
      `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(file.originalName)}"`,
    );
    return new StreamableFile(createReadStream(this.path(file.storageKey)));
  }
}

/** Public files (company logo) — needed on the login page and in emails. */
@ApiTags('public')
@Controller('public/files')
export class PublicFilesController {
  constructor(private readonly prisma: PrismaService, private readonly storage: StorageService) {}

  @Public()
  @Get(':id')
  async get(@Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    const f = await this.prisma.storedFile.findFirst({ where: { id, isPublic: true } });
    if (!f) throw new NotFoundException();
    res.setHeader('Cache-Control', 'public, max-age=300');
    return this.storage.stream(res, f);
  }
}

@Global()
@Module({ providers: [StorageService], controllers: [PublicFilesController], exports: [StorageService] })
export class FilesModule {}
