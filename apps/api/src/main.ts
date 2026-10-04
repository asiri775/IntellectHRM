import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: true });
  app.set('trust proxy', 1); // correct client IPs behind a load balancer (audit logs, rate limits)
  app.setGlobalPrefix('api');
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      // Only ask browsers to upgrade to HTTPS when the site is actually served over HTTPS.
      contentSecurityPolicy: { directives: { upgradeInsecureRequests: config.APP_URL.startsWith('https://') ? [] : null } },
    }),
  );
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '2mb' });
  app.enableCors({ origin: config.corsOrigins, credentials: true });
  app.enableShutdownHooks();

  const doc = new DocumentBuilder()
    .setTitle('IntellectHRM API')
    .setDescription('HRM, attendance, leave, payroll (Sri Lanka) and CRM for Intellect Choice')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, doc));

  // Single-process hosting (e.g. cPanel/Passenger): serve the built web app from the API.
  if (config.WEB_DIST_DIR) {
    const dir = resolve(config.WEB_DIST_DIR);
    const indexHtml = join(dir, 'index.html');
    if (!existsSync(indexHtml)) throw new Error(`WEB_DIST_DIR is set but ${indexHtml} does not exist — build the web app first`);
    app.useStaticAssets(dir, {
      index: false,
      setHeaders: (res, path) => res.setHeader('Cache-Control', path.includes(`${join('/', 'assets', '/')}`) ? 'public, max-age=31536000, immutable' : 'no-cache'),
    });
    // Client-side routes (/, /leave, /payroll/runs/…) return index.html; /api is left to Nest.
    app.use((req: Request, res: Response, next: NextFunction) => {
      if ((req.method !== 'GET' && req.method !== 'HEAD') || req.path === '/api' || req.path.startsWith('/api/')) return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(indexHtml);
    });
    Logger.log(`Serving web app from ${dir}`, 'Bootstrap');
  }

  await app.listen(config.PORT);
  Logger.log(`API listening on :${config.PORT} (docs at /api/docs)`, 'Bootstrap');
}

bootstrap();
