export function formatGridNumber(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  return n.toLocaleString('en-US');
}

export function formatGridDate(
  v: string | null | undefined,
  monthStyle: 'long' | 'short' = 'long',
): string {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: monthStyle, year: 'numeric' });
}