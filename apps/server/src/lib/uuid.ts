import { randomUUID } from 'node:crypto';

/** App-generated UUID v4 — DuckDB has no native uuid() default. */
export function uuid(): string {
  return randomUUID();
}
