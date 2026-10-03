import { Global, Injectable, Module } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { config } from '../config';

/**
 * Field-level encryption for sensitive personal data (NIC, passport, TIN, bank account).
 * AES-256-GCM with a random IV per value. Format: v1:<iv>:<tag>:<ciphertext> (base64).
 */
@Injectable()
export class CryptoService {
  private readonly key: Buffer;

  constructor() {
    this.key = Buffer.from(config.DATA_ENCRYPTION_KEY, 'base64');
    if (this.key.length !== 32) throw new Error('DATA_ENCRYPTION_KEY must decode to 32 bytes (base64)');
  }

  encrypt(plain: string | null | undefined): string | null {
    if (plain === null || plain === undefined || plain === '') return null;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
  }

  decrypt(value: string | null | undefined): string | null {
    if (!value) return null;
    const [v, iv, tag, data] = value.split(':');
    if (v !== 'v1') throw new Error('Unknown ciphertext version');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  }

  /** Deterministic keyed hash for equality lookups on encrypted values. */
  blindIndex(value: string | null | undefined): string | null {
    if (!value) return null;
    return createHmac('sha256', config.BLIND_INDEX_KEY).update(value.trim().toUpperCase()).digest('hex');
  }

  sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  randomToken(bytes = 48): string {
    return randomBytes(bytes).toString('base64url');
  }

  /** "199123456789" -> "********6789" */
  mask(value: string | null): string | null {
    if (!value) return null;
    return value.length <= 4 ? '****' : '*'.repeat(value.length - 4) + value.slice(-4);
  }
}

@Global()
@Module({ providers: [CryptoService], exports: [CryptoService] })
export class CryptoModule {}
