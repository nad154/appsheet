import {
  IDLE_THRESHOLD_DAYS,
  DEADLINE_WARNING_DAYS,
} from '@tracker/shared';
import type { Project } from '@tracker/shared';

export type ProjectFlag = 'idle' | 'deadline' | 'finish' | 'ok';

// Thresholds are imported from packages/shared so the grid and the Gmail digest
// always agree on what counts as "idle" or "deadline-approaching". Never
// re-hardcode 14/7 here.

function parseDate(value: string | null | undefined): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

/** Idle when the project is on_progress and has had no activity for 14+ days. */
function isIdle(project: Project, now: number): boolean {
  if (project.current_stage !== 'on_progress') return false;
  const updated = parseDate(project.updated_at);
  if (updated === null) return false;
  const IDLE_MS = IDLE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;
  return now - updated >= IDLE_MS;
}

/** Deadline approaching when a customer/vendor end-contract is within 7 days. */
function isDeadlineApproaching(project: Project, now: number): boolean {
  const windowEnd = now + DEADLINE_WARNING_DAYS * 24 * 60 * 60 * 1000;
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const todayMs = startOfToday.getTime();

  for (const value of [project.customer_end_contract, project.vendor_end_contract]) {
    const t = parseDate(value as string | null | undefined);
    if (t !== null && t >= todayMs && t <= windowEnd) {
      return true;
    }
  }
  return false;
}

export function computeProjectFlag(project: Project, now: number = Date.now()): ProjectFlag {
  if (project.current_stage === 'finish') return 'finish';
  if (isDeadlineApproaching(project, now)) return 'deadline';
  if (isIdle(project, now)) return 'idle';
  return 'ok';
}

export const FLAG_LABEL: Record<ProjectFlag, string> = {
  idle: 'Idle',
  deadline: 'Deadline soon',
  finish: 'Finished',
  ok: 'On track',
};
