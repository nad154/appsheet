export const IDLE_THRESHOLD_DAYS = 14;
export const DEADLINE_WARNING_DAYS = 7;
export const AGING_ALERT_DAYS = 30;

// Default aging→priority thresholds, used to seed the singleton aging_thresholds
// row in DuckDB (High = anything strictly greater than medium_max_days).
export const DEFAULT_AGING_LOW_MAX_DAYS = 15;
export const DEFAULT_AGING_MEDIUM_MAX_DAYS = 30;
