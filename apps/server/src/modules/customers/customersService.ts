import { runRead, runWrite } from '../../db/connection.js';
import { uuid } from '../../lib/uuid.js';
import { exportSnapshots } from '../../db/export.js';
import { customerCreateSchema, customerUpdateSchema } from '@tracker/shared';
import type { Customer } from '@tracker/shared';

export class CustomerError extends Error {
  constructor(message: string, public statusCode = 400) {
    super(message);
    this.name = 'CustomerError';
  }
}

export async function listCustomers(q?: string): Promise<{ id: string; name: string }[]> {
  if (q && q.trim()) {
    return runRead<{ id: string; name: string }>(
      `SELECT id, name FROM customers WHERE name ILIKE '%' || ? || '%' ORDER BY name LIMIT 20`,
      [q.trim()],
    );
  }
  return runRead<{ id: string; name: string }>(
    `SELECT id, name FROM customers ORDER BY name ASC`,
  );
}

export async function createCustomer(rawPayload: unknown): Promise<{ id: string }> {
  const payload = customerCreateSchema.parse(rawPayload);
  const id = uuid();
  await runWrite(async (ex) => {
    await ex(`INSERT INTO customers (id, name, created_at) VALUES (?, ?, current_timestamp)`, [id, payload.name]);
  });
  await exportSnapshots(['customers']);
  return { id };
}

export async function updateCustomer(id: string, rawPayload: unknown): Promise<void> {
  const payload = customerUpdateSchema.parse(rawPayload);
  if (Object.keys(payload).length === 0) throw new CustomerError('No changes to apply', 400);
  await runWrite(async (ex) => {
    const existing = await ex<{ id: string }>(`SELECT id FROM customers WHERE id = ?`, [id]);
    if (existing.length === 0) throw new CustomerError('Customer not found', 404);
    await ex(`UPDATE customers SET name = ? WHERE id = ?`, [payload.name, id]);
  });
  await exportSnapshots(['customers']);
}

export async function deleteCustomer(id: string): Promise<number> {
  // Count how many projects reference this customer, so the route can return
  // the count for the confirmation UI (plan §3.4).
  const [countRow] = await runRead<{ count: number | bigint }>(
    `SELECT count(*) AS count FROM projects WHERE customer_id = ?`, [id],
  );
  const usageCount = Number(countRow?.count ?? 0);

  await runWrite(async (ex) => {
    await ex(`DELETE FROM customers WHERE id = ?`, [id]);
  });
  await exportSnapshots(['customers']);
  return usageCount;
}