export interface PackableRow {
  id: string;
  // Number of vendor lines on the project. 0 counts as 1 (the blank-vendor
  // row), so a project with no vendor lines still occupies one grid row.
  lineCount: number;
}

/**
 * Greedy pack of ordered project ids into "pages" of grid display rows, never
 * splitting a project's vendor lines across a page (planning_customers_vendors
 * §3.1). Line counts are effective rows (max(1, vendor lines)). A single
 * project whose own line count exceeds pageSize is still placed alone on a
 * page and allowed to overflow, so a huge project can always render.
 *
 * Shared by the server (listProjects packs with it) and the frontend
 * (GridPage's drill-down locator replicates the exact page boundaries), so the
 * two can never disagree over which page a project lands on.
 */
export function packIntoPages(rows: PackableRow[], pageSize: number): string[][] {
  const pages: string[][] = [];
  let current: string[] = [];
  let currentLines = 0;

  for (const row of rows) {
    const lines = Math.max(1, row.lineCount);
    if (current.length > 0 && currentLines + lines > pageSize) {
      pages.push(current);
      current = [];
      currentLines = 0;
    }
    current.push(row.id);
    currentLines += lines;
  }

  if (current.length > 0) pages.push(current);
  return pages;
}

/**
 * Total number of display rows across the whole scoped set (every project's
 * max(1, vendor lines) summed) — what the grid's "M vendor line(s)" footer
 * label renders. Distinct from the raw project count.
 */
export function totalLinesFor(rows: PackableRow[]): number {
  return rows.reduce((sum, row) => sum + Math.max(1, row.lineCount), 0);
}