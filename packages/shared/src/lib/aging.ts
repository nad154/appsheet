function toDate(value: string | Date): Date {
  return typeof value === 'string' ? new Date(value) : value;
}

function startOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function isWeekend(d: Date): boolean {
  const day = d.getDay();
  return day === 0 || day === 6;
}

/**
 * Count the number of weekdays strictly between startDate (exclusive) and
 * endDate (inclusive) — mirroring the spreadsheet formula's NETWORKDAYS(Q,U)-1
 * semantics. This yields the number of "aging" days after a project was sent
 * (the sent date itself is not counted) up through the reference end date.
 * Returns 0 when end is on or before start.
 */
export function networkDays(startDate: Date | string, endDate: Date | string): number {
  const start = startOfDay(toDate(startDate));
  const end = startOfDay(toDate(endDate));

  if (end <= start) return 0;

  let count = 0;
  const cursor = new Date(start);
  cursor.setDate(cursor.getDate() + 1);

  while (cursor <= end) {
    if (!isWeekend(cursor)) count++;
    cursor.setDate(cursor.getDate() + 1);
  }

  return count;
}

export interface AgingInput {
  project_sent_date?: string | null;
  approval_date?: string | null;
}

/**
 * Compute the aging value for a project. Returns null when project_sent_date
 * is missing (matches `IF(Q5="", "", ...)` in the source spreadsheet). Uses
 * today when approval_date is not yet set. No holiday awareness, matching the
 * original formula.
 */
export function computeAging(project: AgingInput, today: Date = new Date()): number | null {
  if (!project.project_sent_date) return null;
  const end = project.approval_date ? project.approval_date : today;
  return networkDays(project.project_sent_date, end);
}
