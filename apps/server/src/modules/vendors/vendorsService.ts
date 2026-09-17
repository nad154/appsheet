import { runRead, runWrite } from '../../db/connection.js';
import { uuid } from '../../lib/uuid.js';
import { exportSnapshots } from '../../db/export.js';
import { vendorCreateSchema, vendorUpdateSchema } from '@tracker/shared';
import type { Vendor } from '@tracker/shared';

export class VendorError extends Error {
  constructor(message: string, public statusCode = 400) {
    super(message);
    this.name = 'VendorError';
  }
}

export async function listVendors(q?: string): Promise<{ id: string; name: string }[]> {
  if (q && q.trim()) {
    return runRead<{ id: string; name: string }>(
      `SELECT id, name FROM vendors WHERE name ILIKE '%' || ? || '%' ORDER BY name LIMIT 20`,
      [q.trim()],
    );
  }
  return runRead<{ id: string; name: string }>(
    `SELECT id, name FROM vendors ORDER BY name ASC`,
  );
}

export async function createVendor(rawPayload: unknown): Promise<{ id: string }> {
  const payload = vendorCreateSchema.parse(rawPayload);
  const id = uuid();
  await runWrite(async (ex) => {
    await ex(`INSERT INTO vendors (id, name, created_at) VALUES (?, ?, current_timestamp)`, [id, payload.name]);
  });
  await exportSnapshots(['vendors']);
  return { id };
}

export async function updateVendor(id: string, rawPayload: unknown): Promise<void> {
  const payload = vendorUpdateSchema.parse(rawPayload);
  if (Object.keys(payload).length === 0) throw new VendorError('No changes to apply', 400);
  await runWrite(async (ex) => {
    const existing = await ex<{ id: string }>(`SELECT id FROM vendors WHERE id = ?`, [id]);
    if (existing.length === 0) throw new VendorError('Vendor not found', 404);
    await ex(`UPDATE vendors SET name = ? WHERE id = ?`, [payload.name, id]);
  });
  await exportSnapshots(['vendors']);
}

export async function deleteVendor(id: string): Promise<number> {
  const [countRow] = await runRead<{ count: number | bigint }>(
    `SELECT count(*) AS count FROM project_vendors WHERE vendor_id = ?`, [id],
  );
  const usageCount = Number(countRow?.count ?? 0);

  await runWrite(async (ex) => {
    await ex(`DELETE FROM vendors WHERE id = ?`, [id]);
  });
  await exportSnapshots(['vendors']);
  return usageCount;
}