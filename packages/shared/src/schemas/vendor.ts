import { z } from 'zod';

// Vendor row. Referenced by id from project_vendors.vendor_id (many per
// project). Real delete is allowed — no is_active column, see
// planning_customers_vendors §3.4.
export const vendorSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  created_at: z.string().datetime(),
});

export const vendorCreateSchema = z.object({
  name: z.string().min(1),
});

export const vendorUpdateSchema = z.object({
  name: z.string().min(1),
});

export type Vendor = z.infer<typeof vendorSchema>;
export type VendorCreate = z.infer<typeof vendorCreateSchema>;
export type VendorUpdate = z.infer<typeof vendorUpdateSchema>;