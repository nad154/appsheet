import { z } from 'zod';

// Customer row. Referenced by id from projects.customer_id (1:1 per project).
// Real delete is allowed — no is_active column, see planning_customers_vendors §3.4.
export const customerSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  created_at: z.string().datetime(),
});

export const customerCreateSchema = z.object({
  name: z.string().min(1),
});

export const customerUpdateSchema = z.object({
  name: z.string().min(1),
});

export type Customer = z.infer<typeof customerSchema>;
export type CustomerCreate = z.infer<typeof customerCreateSchema>;
export type CustomerUpdate = z.infer<typeof customerUpdateSchema>;