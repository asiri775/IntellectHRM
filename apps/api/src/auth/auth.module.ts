import {
  Body,
  Controller,
  Get,
  HttpCode,
  Injectable,
  Module,
  Post,
  Req,
  Res,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import * as argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto.service';
import { AuditService } from '../audit/audit.module';
import { CurrentUser, Public, ReqMeta } from '../common/decorators';
import type { AuthUser, RequestMeta } from '../common/auth-user';
import { ZodPipe } from '../common/zod.pipe';
import { config } from '../config';
import { PermissionCacheService } from '../access/permission-cache.service';
import { hashPassword, passwordSchema } from '../common/password';

const REFRESH_COOKIE = 'ihrm_rt';
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

const loginSchema = z.object({ email: z.string().email().toLowerCase(), password: z.string().min(1) });
const changePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema });

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly perms: PermissionCacheService,
  ) {}

  async login(email: string, password: string, meta: RequestMeta) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Same error for unknown user and wrong password (no account enumeration).
    const invalid = new UnauthorizedException('Invalid email or password');
    if (!user || !user.isActive) {
      await argon2.hash(password).catch(() => undefined); // equalize timing
      throw invalid;
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException('Account temporarily locked after failed attempts. Try again later.');
    }
    const ok = await argon2.verify(user.passwordHash, password);
    if (!ok) {
      const failed = user.failedLogins + 1;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLogins: failed >= MAX_FAILED ? 0 : failed,
          lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60000) : null,
        },
      });
      await this.audit.log({ userId: user.id, companyId: user.companyId }, { action: 'LOGIN_FAILED', module: 'AUTH', entity: 'User', entityId: user.id }, meta);
      throw invalid;
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
    await this.audit.log({ userId: user.id, companyId: user.companyId }, { action: 'LOGIN', module: 'AUTH', entity: 'User', entityId: user.id }, meta);
    return this.issue(user.id, randomUUID(), meta);
  }

  /** Rotate the refresh token. Re-use of a rotated token revokes the whole family. */
  async refresh(token: string | undefined, meta: RequestMeta) {
    if (!token) throw new UnauthorizedException();
    const hash = this.crypto.sha256(token);
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: hash } });
    if (!row) throw new UnauthorizedException();
    if (row.revokedAt) {
      const withinGrace = row.replacedBy && Date.now() - row.revokedAt.getTime() < config.REFRESH_REUSE_GRACE_SECONDS * 1000;
      if (withinGrace) {
        // Concurrent refresh from another tab: issue a sibling token in the same family.
        const family = await this.prisma.refreshToken.count({ where: { familyId: row.familyId, revokedAt: null } });
        if (family > 0 && row.expiresAt > new Date()) return this.issue(row.userId, row.familyId, meta);
      }
      // Re-use of an old token: assume it was stolen and end every session in the family.
      await this.prisma.refreshToken.updateMany({ where: { familyId: row.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
      throw new UnauthorizedException('Refresh token reuse detected; please sign in again');
    }
    if (row.expiresAt < new Date()) throw new UnauthorizedException('Session expired');
    const issued = await this.issue(row.userId, row.familyId, meta);
    await this.prisma.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date(), replacedBy: issued.refreshId } });
    return issued;
  }

  async logout(token: string | undefined) {
    if (!token) return;
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: this.crypto.sha256(token) } });
    if (row) await this.prisma.refreshToken.updateMany({ where: { familyId: row.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async changePassword(user: AuthUser, current: string, next: string, meta: RequestMeta) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: user.userId } });
    if (!(await argon2.verify(u.passwordHash, current))) throw new BadRequestException('Current password is incorrect');
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: u.id }, data: { passwordHash: await hashPassword(next), mustChangePassword: false } }),
      this.prisma.refreshToken.updateMany({ where: { userId: u.id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await this.audit.log(user, { action: 'PASSWORD_CHANGED', module: 'AUTH', entity: 'User', entityId: u.id }, meta);
  }

  private async issue(userId: string, familyId: string, meta: RequestMeta) {
    const accessToken = await this.jwt.signAsync({ sub: userId, typ: 'access' });
    const refreshToken = this.crypto.randomToken();
    const row = await this.prisma.refreshToken.create({
      data: {
        userId,
        familyId,
        tokenHash: this.crypto.sha256(refreshToken),
        expiresAt: new Date(Date.now() + config.REFRESH_TTL_DAYS * 86400000),
        ip: meta.ip,
        userAgent: meta.userAgent?.slice(0, 255),
      },
    });
    return { accessToken, refreshToken, refreshId: row.id };
  }

  async me(user: AuthUser) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: user.userId }, select: { mustChangePassword: true } });
    this.perms.invalidate(user.userId);
    const fresh = await this.perms.load(user.userId);
    return { ...fresh, mustChangePassword: u.mustChangePassword };
  }
}

function setRefreshCookie(res: Response, token: string) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api/auth',
    maxAge: config.REFRESH_TTL_DAYS * 86400000,
  });
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  async login(@Body(new ZodPipe(loginSchema)) body: z.infer<typeof loginSchema>, @ReqMeta() meta: RequestMeta, @Res({ passthrough: true }) res: Response) {
    const t = await this.auth.login(body.email, body.password, meta);
    setRefreshCookie(res, t.refreshToken);
    return { accessToken: t.accessToken };
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @ReqMeta() meta: RequestMeta, @Res({ passthrough: true }) res: Response) {
    const t = await this.auth.refresh(req.cookies?.[REFRESH_COOKIE], meta);
    setRefreshCookie(res, t.refreshToken);
    return { accessToken: t.accessToken };
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE]);
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
  }

  @ApiBearerAuth()
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user);
  }

  @ApiBearerAuth()
  @Post('change-password')
  @HttpCode(204)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(changePasswordSchema)) body: z.infer<typeof changePasswordSchema>,
    @ReqMeta() meta: RequestMeta,
  ) {
    await this.auth.changePassword(user, body.currentPassword, body.newPassword, meta);
  }
}

@Module({ providers: [AuthService], controllers: [AuthController] })
export class AuthModule {}
