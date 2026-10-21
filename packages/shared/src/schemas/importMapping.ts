import { z } from 'zod';

// Per-user saved column mapping for the CSV import wizard (plan §7). Value is
// `{ "<csv header>": "<import field key or null>" }` where null = explicitly
// ignored. Stored in user_preferences and NEVER exported to parquet.
export const IMPORT_MAPPING_KEY = 'import_mapping_projects';

// Values are deliberately lenient (any string key): the loader drops entries
// whose field key no longer exists in IMPORT_FIELD_KEYS, so removing a field
// from the registry later never invalidates — and never wipes — an old saved
// mapping. Fresh writes are still whitelisted server-side on PUT.
export const importMappingSchema = z.object({
  mapping: z
    .record(z.string().max(300), z.string().max(64).nullable())
    .refine((m) => Object.keys(m).length <= 200, {
      message: 'Too many headers in mapping',
    })
    .default({}),
  version: z.literal(1).default(1),
});

export const importMappingDefaults: ImportMapping = {
  mapping: {},
  version: 1,
};

export type ImportMapping = z.infer<typeof importMappingSchema>;
