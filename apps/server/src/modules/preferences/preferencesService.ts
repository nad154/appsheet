import { runRead, runWrite } from '../../db/connection.js';
import {
  gridPreferencesSchema,
  gridPreferencesDefaults,
  GRID_PREFERENCES_KEY,
} from '@tracker/shared';
import type { GridPreferences } from '@tracker/shared';

export class PreferencesError extends Error {
  constructor(message: string, public statusCode = 400) {
    super(message);
    this.name = 'PreferencesError';
  }
}

// Upper bound on the serialized value so a malformed/huge payload can't bloat
// the table. The schema already caps array lengths; this is a belt-and-braces
// guard on the raw JSON string.
const MAX_VALUE_BYTES = 8 * 1024;

/**
 * Read a user's own grid column visibility preferences. Returns the schema
 * defaults (nothing hidden) when no row exists or the stored JSON is
 * unreadable — the user id is always the authenticated caller's, so a user can
 * only ever read their own preferences.
 */
export async function getGridPreferences(userId: string): Promise<GridPreferences> {
  const rows = await runRead<{ value_json: string }>(
    `SELECT value_json FROM user_preferences WHERE user_id = ? AND pref_key = ?`,
    [userId, GRID_PREFERENCES_KEY],
  );
  if (rows.length === 0) return { ...gridPreferencesDefaults };

  try {
    const parsed = JSON.parse(rows[0].value_json);
    const result = gridPreferencesSchema.safeParse(parsed);
    return result.success ? result.data : { ...gridPreferencesDefaults };
  } catch {
    return { ...gridPreferencesDefaults };
  }
}

/**
 * Upsert a user's own grid preferences. Validated with the shared schema; the
 * stored value is the parsed object re-serialized, so unknown fields never
 * reach the DB. Upsert is DELETE-then-INSERT inside one runWrite block (the
 * project convention for constrained tables — avoids relying on UPDATE
 * behaviour). Not part of the parquet export.
 */
export async function saveGridPreferences(
  userId: string,
  rawPayload: unknown,
): Promise<GridPreferences> {
  const parsed = gridPreferencesSchema.safeParse(rawPayload);
  if (!parsed.success) {
    throw new PreferencesError('Invalid grid preferences', 400);
  }
  const valueJson = JSON.stringify(parsed.data);
  if (Buffer.byteLength(valueJson, 'utf8') > MAX_VALUE_BYTES) {
    throw new PreferencesError('Grid preferences payload is too large', 400);
  }

  await runWrite(async (ex) => {
    await ex(`DELETE FROM user_preferences WHERE user_id = ? AND pref_key = ?`, [
      userId,
      GRID_PREFERENCES_KEY,
    ]);
    await ex(
      `INSERT INTO user_preferences (user_id, pref_key, value_json, updated_at)
       VALUES (?, ?, ?, current_timestamp)`,
      [userId, GRID_PREFERENCES_KEY, valueJson],
    );
  });

  return parsed.data;
}

/** Reset a user's own grid preferences to the default (delete the row). */
export async function resetGridPreferences(userId: string): Promise<void> {
  await runWrite(async (ex) => {
    await ex(`DELETE FROM user_preferences WHERE user_id = ? AND pref_key = ?`, [
      userId,
      GRID_PREFERENCES_KEY,
    ]);
  });
}
