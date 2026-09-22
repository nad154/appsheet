# Plan: project-wide row hover + configurable sticky columns

Handoff doc for opencode. Two features on the Grid tab, plus one small prerequisite cleanup. Phases are ordered; run the gate at the end of each phase before starting the next.

## Requirements (from the user)

1. Hovering a row currently tints the row, but the sticky **Project Info** cells stay untinted. Make the hover tint also apply to the sticky cells. When a project has several vendor lines, hovering **any** line tints **every** row of that project (sticky cells included).
2. Add a **"Sticky columns"** button next to the **Year** filter on the Grid page. It lets the user choose which columns are sticky.
   - Default sticky set: `#` (number), `Folder`, `Project`.
   - Any leaf column from any group (Project Info, Customer Section, Vendor Section, Update Progress) can be made sticky.
   - A column that is made sticky sticks **when it reaches the left edge** (it does not get moved to the front).

## Root causes (why it behaves this way today)

- **Hover:** `ProjectTable.tsx` puts `hover:bg-gray-100/200` on the row `<div>`. Sticky cells set an inline opaque `background: var(--stripe-bg)` (they must be opaque so scrolled content doesn't show through), which covers the row's hover colour. Also, every vendor line is its own row `<div>`, so CSS `:hover` only ever tints one line.
- **Sticky:** stickiness is hard-wired to one column group: `STICKY_GROUP_ID = 'project_info'` in both `ProjectTable.tsx` and `ColumnGroupHeader.tsx`, and the "Project Info" group header is a single sticky cell spanning the whole group.

## Decisions (make these unless the user objects)

| # | Decision | Reason |
|---|----------|--------|
| D1 | Row hover is driven by React state (`hoveredProjectId`), not CSS `:hover`. | CSS can't tint sibling rows of the same project. Rows are virtualized (only ~20–40 mounted), so re-rendering on project change is cheap. `onMouseEnter` doesn't fire when moving between cells of the same row, and the id doesn't change between lines of the same project, so re-renders are rare. |
| D2 | Row background is one CSS variable, `--row-bg`, used by the row **and** every sticky cell. `--stripe-bg` stays as-is (it's the end colour of the flash animation in `index.css`). | Single source of truth; keeps the drill-down flash working. |
| D3 | Sticky = `position: sticky` with `left` = sum of widths of the sticky columns that precede it in display order. Column order is never changed. | This is exactly "sticks when it reaches the edge". |
| D4 | Group header cells are split into segments (runs of sticky / non-sticky leaf columns). Sticky runs are sticky; the group label sits in the widest segment. | Otherwise the top header row would scroll away over the sticky columns beneath it. |
| D5 | Sticky selection is persisted in `localStorage`, keyed per user id. | Simple, no new table/route. If the user wants it to follow them across machines later, add a `grid_preferences` table (excluded from parquet export) and a route separate from `/api/settings`. |
| D6 | Cap total sticky width at 60% of `window.innerWidth`; the menu warns and blocks adding more beyond that. | Prevents making the grid unusable. |

---

## Phase 0 — Column id hygiene (prerequisite)

Sticky selection is keyed by column id, so ids must be unique. `apps/web/src/components/data-grid/columns.tsx` currently has collisions:

- `vendorNumberCol('Nilai RAB', …)` and `vendorNumberCol('Nilai PO/PKS Vendor', …)` **both** use `accessorKey: 'vendor_price'` and both read `vendor_price`. So they share an id, and (as far as I can tell) "Nilai RAB" is showing the vendor price instead of `vendor_revenue`.
- The column group `id: 'update_progress'` has the same id as its child column (`accessorKey: 'update_progress'`).

### Changes in `columns.tsx`

1. Give `vendorNumberCol` a key parameter and use it for both the accessor and the cell value:

```tsx
function vendorNumberCol(
  key: 'vendor_price' | 'vendor_revenue',
  header: string,
  size = 120,
): ColumnDef<DisplayRow> {
  return {
    accessorKey: key,
    header,
    size,
    enableSorting: false,
    cell: ({ row }) => {
      const v = vendorCell(row.original, key);
      if (v === null || v === undefined || v === '') return <span className="text-gray-300">Rp —</span>;
      return <span className="block truncate text-sm text-gray-800">Rp {formatGridNumber(v as string | number | null | undefined)}</span>;
    },
  };
}
```

   Call sites: `vendorNumberCol('vendor_revenue', 'Nilai RAB', 120)` and `vendorNumberCol('vendor_price', 'Nilai PO/PKS Vendor', 150)`.

2. Rename the group id `'update_progress'` → `'update_progress_group'`.

3. Add helpers at the bottom of the file:

```tsx
export function columnId(def: ColumnDef<DisplayRow>): string {
  return (def.id ?? (def as { accessorKey?: string }).accessorKey) as string;
}

export interface ColumnOption { id: string; label: string; group: string }

const NOOP = () => undefined;

// Flat list of every leaf column, for the "Sticky columns" menu.
export function getColumnOptions(): ColumnOption[] {
  const groups = buildProjectColumns({
    isAdmin: true,
    onOpenHistory: NOOP,
    onOpenIssues: NOOP,
    onRequestFinish: NOOP,
    onLinkDrive: NOOP,
  });
  return groups.flatMap((g) =>
    ((g as { columns?: ColumnDef<DisplayRow>[] }).columns ?? []).map((c) => ({
      id: columnId(c),
      label: c.id === 'number' ? '# (row number)' : String(c.header),
      group: String(g.header),
    })),
  );
}

export const DEFAULT_STICKY_COLUMN_IDS = ['number', 'drive_folder_id', 'project_name'];
```

### Gate 0
- `npm run typecheck` passes.
- Manual: in the Vendor Section, "Nilai RAB" and "Nilai PO/PKS Vendor" now show different values on seeded data.

---

## Phase 1 — Project-wide row hover (requirement 1)

### `apps/web/src/components/data-grid/ProjectTable.tsx`

1. Add state next to the other `useState`s:

```tsx
const [hoveredProjectId, setHoveredProjectId] = useState<string | null>(null);
```

2. On the scroll container (`ref={parentRef}` div), clear on leave:

```tsx
onMouseLeave={() => setHoveredProjectId(null)}
```

3. In the row map, replace the tailwind bg/hover classes with computed colours. Replace the `isStripeGray` block and the row `className`/`style`:

```tsx
const isStripeGray = index % 2 === 0;
const stripeBg = isStripeGray ? '#f3f4f6' : '#ffffff';
const hoverBg = isStripeGray ? '#e5e7eb' : '#f3f4f6';
const rowBg = hoveredProjectId === project.id ? hoverBg : stripeBg;
```

```tsx
<div
  key={row.id}
  ...
  onMouseEnter={() => setHoveredProjectId(project.id)}
  className={`border-b border-gray-100 ${isHighlighted ? 'animate-[row-flash_1.2s_ease-in-out]' : ''} ${!isAdmin ? 'cursor-pointer' : ''}`}
  style={{
    display: 'grid',
    gridTemplateColumns,
    position: 'absolute',
    transform: `translateY(${virtualRow.start}px)`,
    width: tableWidth,
    backgroundColor: rowBg,
    ['--stripe-bg']: stripeBg, // flash end colour (unchanged meaning)
    ['--row-bg']: rowBg,       // live colour incl. hover
  } as CSSProperties}
>
```

   Remove `bg-gray-100 hover:bg-gray-200` / `hover:bg-gray-100` from the class list.

4. In the cell map, change the sticky cell background from `var(--stripe-bg)` to `var(--row-bg)`:

```tsx
background: isStickyCol ? 'var(--row-bg)' : undefined,
```

Leave the `animate-[row-flash-sticky…]` class as is — it animates to `var(--stripe-bg)` and then the inline `--row-bg` takes over again.

### Gate 1
- `npm run typecheck`, `npm run build`.
- Manual: hover a single-line project → whole row incl. `#/Folder/Project` cells tints. Hover the 2nd vendor line of a multi-vendor project → **all** its lines tint together, sticky cells included. Alternating stripes still look right; scroll horizontally while hovering — sticky cells stay tinted and opaque.
- `npx playwright test dashboard-drilldown multi-vendor` still pass (the flash test samples the first sticky cell).

---

## Phase 2 — Configurable sticky columns (requirement 2)

### 2.1 New hook `apps/web/src/hooks/useStickyColumns.ts`

```ts
import { useCallback, useState } from 'react';
import { DEFAULT_STICKY_COLUMN_IDS, getColumnOptions } from '../components/data-grid/columns';

const VALID = new Set(getColumnOptions().map((o) => o.id));
const keyFor = (userId?: string) => `tracker.grid.stickyColumns.${userId ?? 'anon'}`;

function read(userId?: string): string[] {
  try {
    const raw = localStorage.getItem(keyFor(userId));
    if (!raw) return DEFAULT_STICKY_COLUMN_IDS;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_STICKY_COLUMN_IDS;
    return parsed.filter((id): id is string => typeof id === 'string' && VALID.has(id)); // drops ids of removed columns
  } catch {
    return DEFAULT_STICKY_COLUMN_IDS;
  }
}

export function useStickyColumns(userId?: string) {
  const [ids, setIds] = useState<string[]>(() => read(userId));

  const save = useCallback((next: string[]) => {
    setIds(next);
    try { localStorage.setItem(keyFor(userId), JSON.stringify(next)); } catch { /* ignore quota/private mode */ }
  }, [userId]);

  const reset = useCallback(() => save(DEFAULT_STICKY_COLUMN_IDS), [save]);
  return { stickyColumnIds: ids, setStickyColumnIds: save, resetStickyColumns: reset };
}
```

An empty array is a valid selection (nothing sticky).

### 2.2 New component `apps/web/src/components/data-grid/StickyColumnsMenu.tsx`

Button + dropdown, same open/close pattern as `NotificationBell.tsx` (outside-click via `mousedown` listener).

Props:

```ts
interface StickyColumnsMenuProps {
  selectedIds: string[];
  columnWidths: Record<string, number>; // id -> px, so the width cap can be enforced (from the column defs' `size`)
  onChange: (ids: string[]) => void;
  onReset: () => void;
}
```

Behaviour:
- Button label: `Sticky columns (N)`, `data-testid="sticky-columns-button"`, styled like the Year select (`rounded border border-gray-300 px-2 py-1 text-sm`).
- Panel `data-testid="sticky-columns-panel"`, `max-h-96 overflow-auto`, one section per group (from `getColumnOptions()`, grouped by `group`), one checkbox per column: `aria-label={option.label}`.
- Footer: total sticky width (`Npx`), a **Reset to default** button (`data-testid="sticky-reset"`), and an amber warning when the total exceeds `window.innerWidth * 0.6`. While over the cap, unchecked boxes are disabled (already-checked ones can still be unchecked).
- Computing `columnWidths`: in `GridPage`, build once from the column defs (`size` field) — or export a `getColumnSizes()` next to `getColumnOptions()` in `columns.tsx` (`Record<id, size>` using `c.size ?? 150`).

### 2.3 `apps/web/src/app/grid/GridPage.tsx`

```tsx
import { useStickyColumns } from '../../hooks/useStickyColumns';
import { StickyColumnsMenu } from '../../components/data-grid/StickyColumnsMenu';
import { getColumnSizes } from '../../components/data-grid/columns';
...
const { stickyColumnIds, setStickyColumnIds, resetStickyColumns } = useStickyColumns(user?.id);
```

Render the menu inside the existing `flex items-center gap-3` div, right after the Year `<label>`:

```tsx
<StickyColumnsMenu
  selectedIds={stickyColumnIds}
  columnWidths={getColumnSizes()}
  onChange={setStickyColumnIds}
  onReset={resetStickyColumns}
/>
```

Pass `stickyColumnIds={stickyColumnIds}` to `<ProjectTable …/>`.

### 2.4 `apps/web/src/components/data-grid/ProjectTable.tsx`

1. Add prop `stickyColumnIds: string[]` to `ProjectTableProps` and destructure it. Delete the local `STICKY_GROUP_ID` constant.

2. Replace the sticky-offset block (the `stickyColIds` / `stickyLeftOffsets` / `lastStickyColId` code) with:

```tsx
const stickySet = useMemo(() => new Set(stickyColumnIds), [stickyColumnIds]);

// left offset = widths of sticky columns before it, in DISPLAY order — so a column
// sticks exactly when it reaches the edge (D3). runEndIds marks the last column of
// each contiguous sticky run (gets the right-edge shadow).
const stickyLeftOffsets = new Map<string, number>();
const runEndIds = new Set<string>();
let stickyAcc = 0;
leafHeaders.forEach((h, i) => {
  if (!stickySet.has(h.column.id)) return;
  stickyLeftOffsets.set(h.column.id, stickyAcc);
  stickyAcc += h.getSize();
  const next = leafHeaders[i + 1];
  if (!next || !stickySet.has(next.column.id)) runEndIds.add(h.column.id);
});
```

3. Leaf header cells: `const isStickyCol = stickySet.has(columnId);`, `const isLastStickyCol = runEndIds.has(columnId);`. Only apply the inline `backgroundColor: '#f9fafb'` when `isStickyCol && !leafTint` (the tinted Customer/Vendor headers are already opaque classes and must keep their colour when sticky).

4. Group header cells: pass the sticky info through:

```tsx
return (
  <ColumnGroupHeader
    key={header.id}
    header={header}
    stickySet={stickySet}
    stickyLeftOffsets={stickyLeftOffsets}
    runEndIds={runEndIds}
  />
);
```

5. Body cells: `const isStickyCol = stickySet.has(cell.column.id);` and `const isLastStickyCol = runEndIds.has(cell.column.id);`. Everything else (`Z.stickyBodyCol`, animation class, `left`) already keys off `isStickyCol` / `stickyLeftOffsets`.

6. `commitCell` looks columns up by `accessorKey`; that still works. Nothing else references sticky group ids.

### 2.5 `apps/web/src/components/data-grid/ColumnGroupHeader.tsx` (D4)

Rewrite to render segments instead of one spanning cell. Remove the exported `STICKY_GROUP_ID`.

```tsx
interface Props {
  header: Header<DisplayRow, unknown>;
  stickySet: Set<string>;
  stickyLeftOffsets: Map<string, number>;
  runEndIds: Set<string>;
}

// group tint for every group (project_info keeps the neutral grey)
const GROUP_HEADER_TINT: Record<string, string> = {
  customer: 'bg-green-200 text-green-800',
  vendor: 'bg-purple-200 text-purple-800',
};

export function ColumnGroupHeader({ header, stickySet, stickyLeftOffsets, runEndIds }: Props) {
  const leaves = header.subHeaders; // two-level header: children are leaf headers
  // 1. split into contiguous runs of same stickiness
  const segments: { sticky: boolean; leaves: typeof leaves; width: number }[] = [];
  for (const leaf of leaves) {
    const sticky = stickySet.has(leaf.column.id);
    const last = segments[segments.length - 1];
    if (last && last.sticky === sticky) {
      last.leaves.push(leaf);
      last.width += leaf.getSize();
    } else {
      segments.push({ sticky, leaves: [leaf], width: leaf.getSize() });
    }
  }
  // 2. label goes in the widest segment (first wins ties)
  const labelIdx = segments.reduce((best, s, i, arr) => (s.width > arr[best].width ? i : best), 0);
  const tint = GROUP_HEADER_TINT[header.column.id] ?? 'bg-gray-100 text-gray-600';

  return (
    <>
      {segments.map((seg, i) => {
        const first = seg.leaves[0];
        const lastLeaf = seg.leaves[seg.leaves.length - 1];
        const style: CSSProperties = {
          gridColumn: `span ${seg.leaves.length} / span ${seg.leaves.length}`,
          display: 'flex', alignItems: 'center', overflow: 'hidden',
          ...(seg.sticky ? {
            position: 'sticky',
            left: stickyLeftOffsets.get(first.column.id) ?? 0,
            zIndex: 40,
            boxShadow: runEndIds.has(lastLeaf.column.id) ? '2px 0 4px -2px rgba(0,0,0,0.08)' : undefined,
          } : {}),
        };
        return (
          <div key={`${header.id}-${i}`} role="columnheader" style={style}
               className={`border-b border-r border-gray-200 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide ${tint}`}>
            <span className="block truncate">
              {i === labelIdx && !header.isPlaceholder ? flexRender(header.column.columnDef.header, header.getContext()) : null}
            </span>
          </div>
        );
      })}
    </>
  );
}
```

Notes for the implementer:
- The header row is a CSS grid with `gridTemplateColumns` = one track per leaf, so several sibling segments per group place correctly in DOM order.
- `role="columnheader"` count changes (a group can now produce several). Nothing in the e2e specs counts group headers, but grep `columnheader` before merging.
- Segments must use opaque backgrounds (the tint classes are opaque) since sticky ones overlay scrolling content.

### Gate 2
- `npm run typecheck`, `npm run build`.
- Manual QA checklist:
  - Fresh state (clear the localStorage key): `#`, `Folder`, `Project` stick on horizontal scroll; Sales/PIC/Stage/Issues now scroll away (behaviour change from today — expected).
  - Tick **Customer** (Customer Section): it scrolls normally, then locks right after `Project` when it reaches that point; the other Customer columns scroll under it. Header tint stays green.
  - Tick **Vendor** and **Aging** (Vendor Section): same behaviour; two sticky columns stack side by side with no overlap.
  - Untick everything → nothing sticks; group headers scroll normally. Tick only `Project` → it sticks at `left: 0` (offsets recompute).
  - Group header row: the sticky columns' segment stays put; the label "Project Info" appears in the widest segment.
  - Hover from Phase 1 still tints sticky cells of newly-sticky columns (they use `--row-bg`).
  - Reload: selection persists; log in as another user: independent selection. **Reset to default** restores the three defaults.
  - Try to exceed 60% of the window width: menu warns and blocks further checks.
  - STAFF login: works identically (menu is available to both roles; it's purely a view preference).

---

## Phase 3 — Playwright coverage

New file `apps/web/e2e/sticky-columns.spec.ts` (same `login` helper as the other specs; fixtures via admin API like `multi-vendor.spec.ts`, pin `created_at: '2000-…'` so fixtures land on page 1; clean up by name).

Tests:

1. **defaults**: after login, clear `tracker.grid.stickyColumns.*` from localStorage and reload. Assert the `Project` cell, `Folder` cell and `#` cell have computed `position: sticky`, and the `Sales` cell does not.
2. **toggle + edge stick**: open `sticky-columns-button`, tick `Customer`, close. Scroll `[role="table"]` horizontally (`el.scrollLeft = 2000`). Assert the Customer column's cell bounding-box `x` (relative to the table) equals the total width of the three default columns (508px = 48 + 160 + 300), and that a non-sticky Customer-section column has scrolled past it.
3. **persistence + reset**: reload → still ticked; click `sticky-reset` → back to the three defaults.
4. **hover tints sticky cells across vendor lines**: create a project with 2 vendor lines. Hover the second line's vendor cell; assert the sticky Project cell of line 1 **and** line 2 both have the hover background (`rgb(243, 244, 246)` on white stripes, `rgb(229, 231, 235)` on gray stripes — compare against the un-hovered value being different); move the mouse off the table and assert both revert.

### Gate 3 (final)
- `npm run typecheck && npm run build`
- Make sure no `npm run dev:server` / `npm run start` / DB browser holds `apps/server/data/app.duckdb` (DuckDB single-writer lock — Playwright starts its own server via `start-safe.js`).
- `npx playwright test` — whole suite green, including the existing `grid`, `multi-vendor`, `edit-modal`, `update-progress`, `issues`, `priority` and `dashboard-drilldown` specs.

## Files touched (summary)

| File | Change |
|------|--------|
| `apps/web/src/components/data-grid/columns.tsx` | unique ids, `vendorNumberCol(key, …)`, group id rename, `columnId`, `getColumnOptions`, `getColumnSizes`, `DEFAULT_STICKY_COLUMN_IDS` |
| `apps/web/src/components/data-grid/ProjectTable.tsx` | hover state + `--row-bg`, `stickyColumnIds` prop, per-column sticky offsets |
| `apps/web/src/components/data-grid/ColumnGroupHeader.tsx` | segment rendering, remove `STICKY_GROUP_ID` |
| `apps/web/src/components/data-grid/StickyColumnsMenu.tsx` | **new** |
| `apps/web/src/hooks/useStickyColumns.ts` | **new** |
| `apps/web/src/app/grid/GridPage.tsx` | menu next to Year filter, pass prop |
| `apps/web/e2e/sticky-columns.spec.ts` | **new** |

No server, DB, or shared-package changes.

## Out of scope / possible follow-ups

- Server-side persistence of the sticky selection (D5).
- Reordering columns or drag-to-pin.
- Hover highlighting on the header row.
