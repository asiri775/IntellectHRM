import { Controller, Get, Module } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import type { AuthUser } from '../common/auth-user';
import { dateOnly, ymd } from '../common/pagination';
import { employeeScope } from '../common/scope';

@ApiTags('dashboard')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly prisma: PrismaService) {}

  /** HR dashboard (Section 44) — headcount, joiners/leavers, contracts ending, leave today, payroll status. */
  @Get('hr')
  @RequirePermissions('EMPLOYEE_VIEW')
  async hr(@CurrentUser() user: AuthUser) {
    const scope = employeeScope(user, 'EMPLOYEE_VIEW');
    const today = ymd(new Date());
    const monthStart = `${today.slice(0, 7)}-01`;
    const in30 = new Date(Date.now() + 30 * 86400000);
    const [byType, byDept, joiners, leavers, ending, onLeave, pendingLeave, lastRun, expiringDocs] = await Promise.all([
      this.prisma.employee.groupBy({ by: ['employmentType'], where: { ...scope, employmentStatus: { in: ['ACTIVE', 'ON_NOTICE'] } }, _count: true }),
      this.prisma.employee.groupBy({ by: ['departmentId'], where: { ...scope, employmentStatus: { in: ['ACTIVE', 'ON_NOTICE'] } }, _count: true }),
      this.prisma.employee.count({ where: { ...scope, joiningDate: { gte: dateOnly(monthStart) } } }),
      this.prisma.employee.count({ where: { ...scope, leavingDate: { gte: dateOnly(monthStart), lte: dateOnly(today) } } }),
      this.prisma.employmentContract.findMany({
        where: { companyId: user.companyId, status: 'ACTIVE', endDate: { gte: dateOnly(today), lte: in30 }, employee: scope },
        include: { employee: { select: { id: true, employeeNo: true, firstName: true, lastName: true } } },
        orderBy: { endDate: 'asc' },
        take: 20,
      }),
      this.prisma.leaveRequest.count({ where: { companyId: user.companyId, status: 'APPROVED', startDate: { lte: dateOnly(today) }, endDate: { gte: dateOnly(today) }, employee: scope } }),
      this.prisma.leaveRequest.count({ where: { companyId: user.companyId, status: 'PENDING', employee: scope } }),
      'PAYROLL_VIEW' in user.permissions
        ? this.prisma.payrollRun.findFirst({ where: { companyId: user.companyId, status: { not: 'REVERSED' } }, orderBy: [{ year: 'desc' }, { month: 'desc' }], select: { id: true, number: true, year: true, month: true, status: true, employeeCount: true, totalNet: true, totalEmployerCost: true } })
        : Promise.resolve(null),
      this.prisma.employeeDocument.count({ where: { companyId: user.companyId, deletedAt: null, expiryDate: { gte: dateOnly(today), lte: in30 }, employee: scope } }),
    ]);
    const depts = await this.prisma.department.findMany({ where: { companyId: user.companyId }, select: { id: true, name: true } });
    const deptName = new Map(depts.map((d) => [d.id, d.name]));
    return {
      headcount: byType.reduce((s, x) => s + x._count, 0),
      byEmploymentType: byType.map((x) => ({ employmentType: x.employmentType, count: x._count })),
      byDepartment: byDept.map((x) => ({ department: x.departmentId ? deptName.get(x.departmentId) ?? 'Unknown' : 'Unassigned', count: x._count })),
      joinersThisMonth: joiners,
      leaversThisMonth: leavers,
      contractsEnding: ending,
      onLeaveToday: onLeave,
      pendingLeaveRequests: pendingLeave,
      documentsExpiring: expiringDocs,
      lastPayroll: lastRun,
    };
  }
}

@Module({ controllers: [DashboardController] })
export class DashboardModule {}
