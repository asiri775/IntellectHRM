import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().optional(),
  APP_URL: z.string().default('http://localhost:5173'),
  API_PUBLIC_URL: z.string().default('http://localhost:3000'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  REFRESH_TTL_DAYS: z.coerce.number().default(14),
  /** A rotated refresh token re-presented within this window (e.g. two tabs refreshing at once) is accepted instead of treated as theft. */
  REFRESH_REUSE_GRACE_SECONDS: z.coerce.number().min(0).max(120).default(20),
  /** base64-encoded 32-byte key for AES-256-GCM field encryption. */
  DATA_ENCRYPTION_KEY: z.string().min(40),
  /** Secret for HMAC blind indexes (e.g. NIC uniqueness). */
  BLIND_INDEX_KEY: z.string().min(32),
  STORAGE_DIR: z.string().default('./storage'),
  /** Optional: path to the built web app (apps/web/dist). When set, the API also serves the web app (single-process hosting such as cPanel). */
  WEB_DIST_DIR: z.string().optional(),
  MAX_UPLOAD_MB: z.coerce.number().default(10),
  MAIL_PROVIDER: z.enum(['log', 'smtp']).default('log'),
  MAIL_FROM: z.string().default('Intellect Choice HR <no-reply@intellectchoice.co.nz>'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_SECURE: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  /** Optional Chromium/Chrome executable for PDF rendering. Without it, documents download as HTML. */
  CHROMIUM_PATH: z.string().optional(),
  ENABLE_SCHEDULER: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // Fail fast with a readable message instead of starting half-configured.
  console.error('Invalid environment configuration:\n' + parsed.error.issues.map((i) => ` - ${i.path.join('.')}: ${i.message}`).join('\n'));
  process.exit(1);
}

export const config = {
  ...parsed.data,
  corsOrigins: parsed.data.CORS_ORIGINS.split(',').map((s) => s.trim()),
};
export type AppConfig = typeof config;
