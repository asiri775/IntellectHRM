import { Controller, Get, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { config } from './config';
import { Public } from './common/decorators';
import { PrismaModule, PrismaService } from './prisma/prisma.service';
import { CryptoModule } from './common/crypto.service';
import { AuditModule } from './audit/audit.module';
import { AccessModule } from './access/access.module';
import { JwtAuthGuard, PermissionsGuard } from './access/guards';
import { AuthModule } from './auth/auth.module';
import { FilesModule } from './files/files.module';
import { TemplatesModule } from './templates/templates.module';
import { MailModule } from './mail/mail.module';
import { SettingsModule } from './settings/settings.module';
import { OrgModule } from './org/org.module';
import { ApprovalModule } from './approvals/approval.service';
import { LeaveModule } from './leave/leave.module';
import { HrmModule } from './hrm/hrm.module';
import { AttendanceModule } from './attendance/attendance.module';
import { PayrollModule } from './payroll/payroll.module';
import { CrmModule } from './crm/crm.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { JobsModule } from './jobs/jobs.module';

@Controller('health')
class HealthController {
  constructor(private readonly prisma: PrismaService) {}
  @Public()
  @Get()
  async health() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', time: new Date().toISOString() };
  }
}

@Module({
  imports: [
    JwtModule.register({ global: true, secret: config.JWT_ACCESS_SECRET, signOptions: { expiresIn: config.JWT_ACCESS_TTL } }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    ScheduleModule.forRoot(),
    PrismaModule,
    CryptoModule,
    AuditModule,
    AccessModule,
    AuthModule,
    FilesModule,
    TemplatesModule,
    MailModule,
    SettingsModule,
    ApprovalModule,
    OrgModule,
    LeaveModule,
    HrmModule,
    AttendanceModule,
    PayrollModule,
    CrmModule,
    DashboardModule,
    JobsModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
