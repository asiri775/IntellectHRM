import type { PermissionScope } from '@ihrm/shared';

/** The authenticated principal attached to every request by JwtAuthGuard. */
export interface AuthUser {
  userId: string;
  companyId: string;
  email: string;
  displayName: string;
  language: string;
  employeeId: string | null;
  departmentId: string | null;
  teamId: string | null;
  roles: string[];
  /** Effective permissions: code -> widest scope granted by any role. */
  permissions: Record<string, PermissionScope>;
}

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}
