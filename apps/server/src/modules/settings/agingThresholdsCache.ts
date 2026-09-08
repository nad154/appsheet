import { getAgingThresholds } from './settingsService.js';
import type { AgingThresholds } from '@tracker/shared';

// Small in-memory cache so every project-list / chart-data request doesn't need
// an extra round trip to the settings table. Invalidated on every update via
// invalidateAgingThresholdsCache() (called from updateAgingThresholds).
let cached: AgingThresholds | null = null;

export async function resolveAgingThresholds(): Promise<AgingThresholds> {
  if (cached) return cached;
  cached = await getAgingThresholds();
  return cached;
}

export function invalidateAgingThresholdsCache(): void {
  cached = null;
}