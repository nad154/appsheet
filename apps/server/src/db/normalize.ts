/**
 * The DuckDB node driver returns every BIGINT column as a JS BigInt, which
 * JSON.stringify throws on. Every BIGINT in this schema is a money value or a
 * COUNT/SUM that is guaranteed within Number.MAX_SAFE_INTEGER, so converting to
 * Number is lossless. This runs at the single read choke point (connection
 * execute) and recurses into result objects, since the driver never returns
 * arrays. Kept in its own module so it can be unit-tested without opening the
 * real database.
 */
export function normalizeBigInt<T>(value: T): T {
  if (typeof value === 'bigint') return Number(value) as unknown as T;
  if (value && typeof value === 'object' && !(value instanceof Date) && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const key of Object.keys(obj)) obj[key] = normalizeBigInt(obj[key]);
  }
  return value;
}
