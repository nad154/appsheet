import type { Role } from '@tracker/shared';

// UI-level role helpers. These only hide/show UI — they are NEVER a security
// boundary. Server-side middleware enforces actual authorization.
export function canManageProjects(role: Role | undefined): boolean {
  return role === 'SUPER_ADMIN';
}

export function canSeeApprovals(role: Role | undefined): boolean {
  return role === 'SUPER_ADMIN';
}

export function canManageSettings(role: Role | undefined): boolean {
  return role === 'SUPER_ADMIN';
}
