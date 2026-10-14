import { z } from 'zod';

// Per-user grid column visibility. Operational/config data — stored in
// user_preferences and NEVER exported to parquet.
//
// We store what is HIDDEN (not what is visible) so newly added columns appear
// by default. hidden_group_ids is stored explicitly rather than derived from
// "every leaf hidden", so a collapsed group stays collapsed when new columns
// are later added to it.
export const GRID_PREFERENCES_KEY = 'grid_columns';

export const gridPreferencesSchema = z.object({
  hidden_column_ids: z.array(z.string().max(64)).max(200).default([]),
  hidden_group_ids: z.array(z.string().max(64)).max(50).default([]),
  version: z.literal(1).default(1),
});

export const gridPreferencesDefaults: GridPreferences = {
  hidden_column_ids: [],
  hidden_group_ids: [],
  version: 1,
};

export type GridPreferences = z.infer<typeof gridPreferencesSchema>;
