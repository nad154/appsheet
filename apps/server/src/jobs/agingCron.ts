import cron from 'node-cron';
import { runWrite, runRead } from '../db/connection.js';
import type { QueryResult } from '../db/connection.js';
import { uuid } from '../lib/uuid.js';
import { computeAging, AGING_ALERT_DAYS } from '@tracker/shared';

interface AgingVendorLineRow extends QueryResult {
  project_id: string;
  project_name: string;
  project_sent_date: string | null;
  approval_date: string | null;
}

interface SuperAdminRow extends QueryResult {
  id: string;
}

interface ExistingAlertRow extends QueryResult {
  id: string;
}

/**
 * Daily aging alert check. Finds all on_progress projects that have at least
 * one vendor line whose computed aging has crossed AGING_ALERT_DAYS and
 * notifies all active SUPER_ADMINs — unless an unread AGING_ALERT notification
 * already exists for that project. Per project, not per line: one alert when
 * ANY vendor line crosses the threshold (planning_customers_vendors decision).
 * Failures are caught and logged so a bad run never crashes the cron loop.
 */
export function startAgingCron(schedule: string = '0 7 * * *'): void {
  cron.schedule(schedule, async () => {
    try {
      await runAgingCheck();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Aging check failed:', err instanceof Error ? err.message : err);
    }
  });
}

export async function runAgingCheck(): Promise<void> {
  const lines = await runRead<AgingVendorLineRow>(
    `SELECT p.id AS project_id, p.project_name, pv.project_sent_date, pv.approval_date
     FROM project_vendors pv
     JOIN projects p ON p.id = pv.project_id
     WHERE p.current_stage = 'on_progress'`,
  );

  // One alert per project — the first line that crosses the threshold flags it.
  const alertedProjectIds = new Set<string>();
  const alerts = new Map<string, { project_id: string; project_name: string }>();
  for (const line of lines) {
    if (alertedProjectIds.has(line.project_id)) continue;
    const aging = computeAging(line);
    if (aging !== null && aging >= AGING_ALERT_DAYS) {
      alertedProjectIds.add(line.project_id);
      alerts.set(line.project_id, { project_id: line.project_id, project_name: line.project_name });
    }
  }

  if (alerts.size === 0) return;

  const recipients = await runRead<SuperAdminRow>(
    `SELECT id FROM users WHERE role = 'SUPER_ADMIN' AND is_active = true`,
  );

  if (recipients.length === 0) return;

  await runWrite(async (ex) => {
    for (const project of alerts.values()) {
      const existing = await ex<ExistingAlertRow>(
        `SELECT id FROM notifications
         WHERE project_id = ? AND type = 'AGING_ALERT' AND is_read = false
         LIMIT 1`,
        [project.project_id],
      );
      if (existing.length > 0) continue;

      const message = `Aging alert: ${project.project_name} has exceeded ${AGING_ALERT_DAYS} days`;
      for (const recipient of recipients) {
        await ex(
          `INSERT INTO notifications (id, recipient_id, type, project_id, pending_edit_id, message, is_read, created_at)
           VALUES (?, ?, 'AGING_ALERT', ?, NULL, ?, false, current_timestamp)`,
          [uuid(), recipient.id, project.project_id, message],
        );
      }
    }
  });
}
