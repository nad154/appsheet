# UI Refresh Instructions (opencode2 Project Tracker)

Goal: restyle the whole app into a clean, professional look: white surfaces, red accent, light-red tints, and a few subtle gradients/patterns. Add supporting non-red colors for dashboards and data. **This is a visual change only. Do not change behavior, routes, API calls, labels, or data logic.**

Stack: React + Tailwind 3 (`apps/web`). Colors live in `apps/web/tailwind.config.js`; global CSS in `apps/web/src/index.css`; shared UI primitives in `apps/web/src/components/ui/`.

---

## 0. Ground rules (read first)

1. **Change styling through tokens first.** Edit `tailwind.config.js` and the `components/ui/*` primitives, then fix stragglers. Do not scatter new hex values through components.
2. Keep the existing semantic token names (`surface`, `canvas`, `border`, `ink`, `accent`, `success`, `warning`, `danger`) so existing classes keep working. Add new tokens; don't remove old ones.
3. No new dependencies. No emoji in the UI. Icons stay inline SVG (`components/ui/icons.tsx`). Font stays Inter Variable.
4. Gradients and patterns must be **subtle**. Rule of thumb: if you notice the gradient before the content, tone it down.
5. Check contrast: body text on any background must be at least WCAG AA (4.5:1). White text only on `accent` 600 or darker.
6. Do not break the Playwright specs. See section 9 for the things that must not change.

---

## 1. Color palette

### 1.1 Brand / accent (red)

Replace the current deep-wine accent with a clean, brighter red scale. Add to `theme.extend.colors`:

```js
brand: {
  50:  '#fef2f2',
  100: '#fee2e2',
  200: '#fecaca',
  300: '#fca5a5',
  400: '#f87171',
  500: '#ef4444',
  600: '#dc2626',   // primary action
  700: '#b91c1c',   // hover / pressed
  800: '#991b1b',
  900: '#7f1d1d',
},
```

Remap the existing `accent` token so old classes pick it up:

```js
accent: {
  DEFAULT: '#dc2626', // brand-600
  hover:   '#b91c1c', // brand-700
  soft:    '#fef2f2', // brand-50
},
```

Light red usage: `brand-50` and `brand-100` for hover rows, selected states, soft badges, and section tints. `brand-600` for primary buttons, active nav, focus rings, links.

### 1.2 Neutrals

```js
surface: '#ffffff',
canvas:  '#faf8f8',   // warm off-white page background (very slight red undertone)
border:  '#ece7e7',
ink: { DEFAULT: '#1f1717', muted: '#6b6262' },
```

### 1.3 Semantic

```js
success: { DEFAULT: '#047857', soft: '#ecfdf5' },
warning: { DEFAULT: '#b45309', soft: '#fffbeb' },
danger:  { DEFAULT: '#be123c', soft: '#fff1f2' },  // rose, so it stays distinguishable from brand red
info:    { DEFAULT: '#1d4ed8', soft: '#eff6ff' },
```

Important: because the brand is red, **danger must look different from accent**. Use the rose shade above, and always pair danger with an icon or the word (e.g. "Delete", alert icon), never color alone.

### 1.4 Data / dashboard palette

Add a categorical palette as a Tailwind color group and export the same hex list from a TS module for Recharts.

```js
data: {
  red:     '#dc2626',
  indigo:  '#4f46e5',
  teal:    '#0d9488',
  amber:   '#f59e0b',
  violet:  '#7c3aed',
  sky:     '#0ea5e9',
  emerald: '#10b981',
  pink:    '#ec4899',
  slate:   '#64748b',
},
```

Create `apps/web/src/lib/chartColors.ts`:

```ts
export const CHART_COLORS = [
  '#dc2626', '#4f46e5', '#0d9488', '#f59e0b',
  '#7c3aed', '#0ea5e9', '#10b981', '#ec4899', '#64748b',
];
```

Use it in `ChartCard.tsx` instead of the hardcoded `COLORS` array. Order matters: red first, then colors that contrast strongly with it (indigo, teal), so adjacent slices are always distinguishable.

Priority colors (Low / Medium / High) keep their meaning: green / amber / red-rose. Stage badges: On Progress = amber, Finish = green.

### 1.5 Section tints (grid and modal)

Keep the existing meaning, since users rely on it:
- Project Info = brand red
- Customer Section = emerald
- Vendor Section = indigo

Only polish the shades (see section 5.2).

---

## 2. Gradients and patterns

Define reusable ones in `tailwind.config.js`:

```js
extend: {
  backgroundImage: {
    'brand-gradient': 'linear-gradient(135deg, #dc2626 0%, #b91c1c 55%, #991b1b 100%)',
    'brand-soft':     'linear-gradient(180deg, #fef2f2 0%, #ffffff 100%)',
    'page-glow':      'radial-gradient(900px 400px at 100% -10%, rgba(220,38,38,0.07), transparent 60%)',
    'dot-pattern':    'radial-gradient(rgba(127,29,29,0.10) 1px, transparent 1px)',
  },
  backgroundSize: { dots: '18px 18px' },
  boxShadow: {
    card:    '0 1px 2px 0 rgba(127,29,29,0.05), 0 1px 3px 0 rgba(31,23,23,0.04)',
    overlay: '0 12px 32px -12px rgba(127,29,29,0.30)',
    glow:    '0 6px 18px -6px rgba(220,38,38,0.45)',
  },
}
```

Where to use them:

| Where | What |
|---|---|
| App page background (`AppLayout` root) | `bg-canvas` plus `bg-page-glow` (faint red glow, top-right) |
| Login page | Full-screen: `bg-canvas` + `bg-dot-pattern bg-dots` pattern, with a large blurred red radial behind the card; card has a `brand-gradient` logo tile |
| Primary `Button` | `bg-brand-gradient` is optional; a flat `bg-accent` with `shadow-glow` on hover is the safer default. Pick one and use it everywhere |
| Page headers (`PageHeader`) | Optional thin 3px `brand-gradient` bar under the title, or none. Keep it consistent |
| Dashboard KPI/chart cards | Card header strip using `bg-brand-soft`; chart card top border 2px in `brand-500` |
| Empty states | `bg-dot-pattern` behind the icon at low opacity |
| Grid toolbar (filter bar in `GridPage`) | Replace solid `bg-accent` with `bg-brand-gradient` (text stays white) |

Do **not** put gradients on table cells, inputs, or text areas. Never use a pattern behind dense data.

---

## 3. Typography and spacing

- Inter Variable stays. Enable `font-feature-settings: 'cv11', 'ss01'` and `tabular-nums` on numeric cells (amounts, aging days, counts) so columns align.
- Scale: page title `text-xl font-semibold tracking-tight`; card/section title `text-sm font-semibold`; table body `text-sm`; helper text `text-xs text-ink-muted`; table header `text-[11px] font-semibold uppercase tracking-wider`.
- Radii: cards and modals `rounded-xl`, inputs and buttons `rounded-lg`, badges `rounded-full`.
- Spacing: 4px grid. Cards `p-4` or `p-5`. Keep the grid row height (virtualizer `estimateSize` is 44).

---

## 4. Shared primitives (`components/ui/`)

Update these once and the whole app follows.

- **Button.tsx**: primary = accent bg, white text, `hover:bg-accent-hover`, `shadow-sm`, `hover:shadow-glow`, `active:translate-y-px`. Secondary = white bg, `border-border`, `hover:bg-brand-50 hover:border-brand-200`. Ghost = transparent, `hover:bg-brand-50`. Danger = rose (`danger`) fill. Focus ring `ring-accent/40`. Keep all existing props and `aria-*` passthrough.
- **Input.tsx** (`controlClass`): white bg, `border-border`, `rounded-lg`, `focus:border-accent focus:ring-2 focus:ring-accent/25`. Placeholder `ink-muted/70`.
- **Card.tsx**: `rounded-xl border border-border bg-surface shadow-card`; header gets `bg-brand-soft` and a bottom border.
- **Badge.tsx**: keep variants. Add `brand` variant (`bg-brand-50 text-brand-700 ring-1 ring-brand-200`). Soften others with `ring-1 ring-inset` at 20% of their color.
- **Modal.tsx**: overlay `bg-ink/40 backdrop-blur-[2px]`; panel `rounded-xl shadow-overlay`; header with a 2px `brand-gradient` line along the top edge; footer `bg-canvas`. Keep `role="dialog"`, `aria-label`, Escape handling.
- **PageHeader.tsx**: title plus optional description; actions on the right. Optional short accent bar (`h-1 w-8 rounded-full bg-brand-gradient`) above the title.
- **EmptyState.tsx**: icon in a `h-12 w-12 rounded-full bg-brand-50 text-brand-600` circle; dot pattern behind.
- **Toast.tsx**: keep the left border colors, make them white cards with `shadow-overlay`.
- **Spinner.tsx**: accent colored.

---

## 5. Screens

### 5.1 App shell (`AppLayout.tsx`)

- Header: white, `border-b border-border`, subtle `shadow-sm`. Logo + "Project Tracker" on the left.
- Nav links: inactive `text-ink-muted`; hover `text-ink`; active `text-accent` with the existing 2px underline, now using `bg-brand-gradient`.
- Role badge and avatar: avatar circle `bg-brand-gradient text-white`; role text stays `data-testid="user-role-badge"`.
- Notification bell badge: `bg-brand-600` (not danger).
- Page container: `max-w` stays as is; add `bg-page-glow` on the root.

### 5.2 Grid (`GridPage`, `ProjectTable`, `ColumnGroupHeader`, `columns.tsx`)

- Filter/toolbar bar: `bg-brand-gradient`, `rounded-xl`, white labels; the `Select` controls stay white.
- Table container: `rounded-xl border border-border shadow-card`.
- Group header tints (`GROUP_HEADER_TINT`): project_info = `bg-brand-600 text-white`; customer = `bg-emerald-600 text-white`; vendor = `bg-indigo-600 text-white` (stronger than the current pastel, so the sections read clearly).
- Leaf header tints (`LEAF_HEADER_TINT`): project_info = `bg-brand-50 text-brand-800`; customer = `bg-emerald-50 text-emerald-800`; vendor = `bg-indigo-50 text-indigo-800`.
- Row striping: **keep odd rows `#ffffff` and hover `#DBDBDB`** (tests assert these exact values). Even rows may change from `#fef2f2` to a slightly lighter `#fff7f7`.
- Cells: numbers use `tabular-nums`. Muted dashes stay `text-ink-muted/50`.
- Unread-update dot: stays amber.
- Pencil/edit button on hover: `hover:bg-brand-50 hover:text-brand-700`.
- Pagination bar: white, top border, buttons use the secondary Button style.

### 5.3 Edit / Add project (modal and `Card`)

- Section fieldsets: Project info = `border-brand-200 bg-brand-50/50`; Customer = `border-emerald-300 bg-emerald-50/70` (lighter than the current `emerald-100/80`); Vendor lines = `border-indigo-300 bg-indigo-50/70`.
- Keep the white inputs inside tinted fieldsets (the existing `[&_input...]:bg-white` selectors).
- Vendor line cards keep the `border-gray-200` class (see section 9).
- Update Progress fieldset stays amber (`warning-soft`).

### 5.4 Dashboard (`DashboardPage`, `ChartCard`, `AddViewForm`, `DrillDownPanel`)

- Page: add a row of KPI summary tiles **only if** it needs no new API; otherwise skip. (Optional stretch: use data already available from existing hooks.)
- `ChartCard`: `rounded-xl border-gray-200 bg-surface shadow-card`, hover `shadow-overlay` transition; title row with a small colored dot matching the first chart color. Keep the `border-gray-200` class.
- Charts: use `CHART_COLORS`. Pie `innerRadius` ~45 (donut), `paddingAngle` 2, white 2px stroke between slices. Bars `radius={[6,6,0,0]}`. Light grid lines (`#ece7e7`), axis text `#6b6262` at 11px. Tooltip: white, `rounded-lg`, `shadow-overlay`.
- Filter selects in the card: small pills, `bg-canvas`.
- Drill-down panel: `bg-brand-50/60 rounded-lg`, list hover `bg-brand-100`.

### 5.5 Settings (`SettingsPage`)

- Each panel = the new `Card` style with a titled header. Table headers `text-[11px] uppercase tracking-wider text-ink-muted`, row hover `bg-brand-50/50`.
- Buttons use shared classes. `btnPrimary` = accent; `btnDanger` = rose; `btnDangerGhost` stays outline.
- Active/Inactive text becomes a `Badge` (green / neutral).

### 5.6 Login (`LoginPage`)

- Centered card on the patterned background (section 2). Logo tile uses `bg-brand-gradient` with `shadow-glow`. Primary button full width.
- Error box uses `danger-soft` with the alert icon.

### 5.7 Other

- `ImportCsvModal`, `ColumnMappingStep`, `FieldSelect`: use shared Modal/Button/Input; "suggested" chip = emerald, "saved" chip = brand.
- `IssuesModal`, `UpdateHistoryModal`: issue and history cards get `rounded-xl`, `border-border`, hover `bg-brand-50/40`; the Update Progress box stays amber.
- `ColumnsMenu`, `StickyColumnsMenu`, `NotificationBell` popovers: `rounded-xl shadow-overlay`; checked checkbox/accent uses `accent-accent`.
- `AccountPage`: Card style; heading + subtitle.

---

## 6. Motion

- Transitions: `transition-colors duration-150` on interactive elements; `transition-shadow` on cards.
- Keep the existing `row-flash`, `row-flash-sticky`, `toast-in` keyframes in `index.css`. If you change the flash color from `#fef08a`, keep it clearly not-white.
- Respect `prefers-reduced-motion`: wrap new animations in `motion-safe:`.

---

## 7. Accessibility

- Visible focus ring on every interactive element (`focus-visible:ring-2 ring-accent`).
- Do not rely on color alone: priority and stage badges keep text labels; danger actions keep icon/text.
- Minimum click target ~32px for buttons.
- Keep all existing `aria-label`, `role`, `title` attributes.

---

## 8. Suggested order of work

1. `tailwind.config.js` tokens, shadows, gradients, patterns (sections 1 and 2) and `index.css` (font features, `page-glow`).
2. `components/ui/*` primitives (section 4).
3. `AppLayout` and `LoginPage`.
4. Grid: toolbar, headers, tints, modal fieldsets.
5. Dashboard and charts (`chartColors.ts`).
6. Settings, Account, remaining modals.
7. Search for leftovers: `rg "gray-|slate-|#881337|wine"` under `apps/web/src` and replace with tokens (except the allowed `border-gray-200` locators below).
8. Run `npm run typecheck` and `npm run build`.

---

## 9. Must NOT change (tests depend on these)

- **Class hooks:** `border-gray-200` on the `ChartCard` root and on each vendor line box in `EditProjectModal` (`VendorLineRow`). Playwright locates them by this class.
- **Test ids and labels:** all `data-testid` values (`notification-bell`, `notification-badge`, `columns-button`, `sticky-columns-button`, `highlighted-row`, `drill-down-panel`, `unread-update-dot`, `export-csv`, `open-import-csv`, `user-role-badge`, `delete-project`, etc.), all `aria-label`s, button text ("Add view", "Save changes", "Next: Preview", etc.), dialog names, and field labels.
- **Grid row colors:** odd/white stripe must stay exactly `rgb(255,255,255)` and project hover exactly `rgb(219,219,219)` (`#DBDBDB`). Sticky cells keep `background: var(--row-bg)` so they tint with the row.
- **Row flash:** `--stripe-bg` fade and the sticky-cell flash must still show a non-white color during the animation.
- **Layout structure:** the grid's `role="table" / "row" / "cell" / "columnheader"` structure, the column order, and virtualization stay as is. Do not wrap rows in extra elements.
- Don't rename or reorder anything in `columns.tsx` ids, and don't change `FIELD_LABELS` text.

---

## 10. Definition of done

- [ ] App uses only tokens from section 1 (no stray hex except chart palette and the two fixed row colors).
- [ ] White + red look across login, grid, dashboard, settings, account, and all modals.
- [ ] Dashboard charts use the multi-color palette; red is not the only chart color.
- [ ] Gradients/patterns appear in the places listed in section 2 and nowhere on dense data.
- [ ] `npm run typecheck` and `npm run build` pass.
- [ ] `npx playwright test` still passes (spot check at least `grid`, `dashboard`, `dashboard-drilldown`, `sticky-columns`, `edit-modal`, `priority`).
