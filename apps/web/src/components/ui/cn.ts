// Tiny className joiner — no dependency (the project intentionally avoids
// clsx/tailwind-merge). Filters falsy values and joins with spaces.
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
