import { runRead, runWrite } from '../../db/connection.js';
import type { QueryResult } from '../../db/connection.js';

export interface Notification extends QueryResult {
  id: string;
  recipient_id: string;
  type: 'NEW_APPROVAL' | 'AGING_ALERT';
  project_id: string | null;
  pending_edit_id: string | null;
  message: string;
  is_read: boolean;
  created_at: string;
}

const DEFAULT_LIMIT = 50;

export async function listNotifications(userId: string, limit: number = DEFAULT_LIMIT): Promise<Notification[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 200);
  return runRead<Notification>(
    `SELECT id, recipient_id, type, project_id, pending_edit_id, message, is_read, created_at
     FROM notifications
     WHERE recipient_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
    [userId, safeLimit],
  );
}

export async function getUnreadCount(userId: string): Promise<number> {
  const rows = await runRead<{ count: number }>(
    `SELECT COUNT(*) AS count FROM notifications WHERE recipient_id = ? AND is_read = false`,
    [userId],
  );
  return rows[0]?.count ?? 0;
}

export async function markAsRead(notificationId: string, userId: string): Promise<void> {
  await runWrite(async (ex) => {
    await ex(
      `UPDATE notifications SET is_read = true WHERE id = ? AND recipient_id = ?`,
      [notificationId, userId],
    );
  });
}

export async function markAllAsRead(userId: string): Promise<void> {
  await runWrite(async (ex) => {
    await ex(`UPDATE notifications SET is_read = true WHERE recipient_id = ? AND is_read = false`, [userId]);
  });
}
