import { Global, Injectable, Module } from '@nestjs/common';
import type { ApprovalStep, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../common/auth-user';

export interface ApprovalSubject {
  /** Employee the request is about (for MANAGER steps and self-approval checks). */
  employeeId: string;
  managerId: string | null;
}

/**
 * Configurable approval workflows (Section 50). A workflow is an ordered list of
 * steps; each step is approved by the subject's MANAGER, anyone with a ROLE, or a
 * specific USER. Steps that cannot apply (e.g. no manager) are skipped.
 */
@Injectable()
export class ApprovalService {
  constructor(private readonly prisma: PrismaService) {}

  async steps(companyId: string, entityType: string): Promise<ApprovalStep[]> {
    const wf = await this.prisma.approvalWorkflow.findUnique({
      where: { companyId_entityType: { companyId, entityType } },
      include: { steps: { orderBy: { order: 'asc' } } },
    });
    return wf?.isActive ? wf.steps : [];
  }

  /** First step at or after `from` that applies to this subject; null = no more steps. */
  nextApplicable(steps: ApprovalStep[], subject: ApprovalSubject, from: number): ApprovalStep | null {
    for (const s of steps) {
      if (s.order < from) continue;
      if (s.approverType === 'MANAGER' && !subject.managerId) continue;
      return s;
    }
    return null;
  }

  canApprove(user: AuthUser, step: ApprovalStep, subject: ApprovalSubject): boolean {
    if (user.employeeId && user.employeeId === subject.employeeId) return false; // no self-approval
    switch (step.approverType) {
      case 'MANAGER':
        return !!user.employeeId && user.employeeId === subject.managerId;
      case 'ROLE':
        return !!step.roleCode && user.roles.includes(step.roleCode);
      case 'USER':
        return step.userId === user.userId;
      default:
        return false;
    }
  }

  /** User ids to notify for a step. */
  async approverUserIds(companyId: string, step: ApprovalStep, subject: ApprovalSubject): Promise<string[]> {
    if (step.approverType === 'USER') return step.userId ? [step.userId] : [];
    if (step.approverType === 'MANAGER') {
      if (!subject.managerId) return [];
      const m = await this.prisma.employee.findUnique({ where: { id: subject.managerId }, select: { userId: true } });
      return m?.userId ? [m.userId] : [];
    }
    const users = await this.prisma.user.findMany({
      where: { companyId, isActive: true, roles: { some: { role: { code: step.roleCode ?? '__none__', companyId } } } },
      select: { id: true },
    });
    return users.map((u) => u.id);
  }

  record(
    tx: Prisma.TransactionClient,
    data: { companyId: string; entityType: string; entityId: string; stepOrder: number; approverUserId: string; decision: 'APPROVED' | 'REJECTED'; comment?: string },
  ) {
    return tx.approvalAction.create({ data });
  }
}

@Global()
@Module({ providers: [ApprovalService], exports: [ApprovalService] })
export class ApprovalModule {}
