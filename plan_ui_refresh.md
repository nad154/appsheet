# Plan: Modern, Formal UI Refresh

## 1. Goal

Make the app look polished and presentable for an internal business tool: modern, calm, and formal, without changing behaviour. Pages in scope: Login, App shell (header and nav), Grid, Modals, Dashboard, Settings, Drive Browser, Toasts.

Principles:
- **Formal**: neutral slate palette, one restrained accent, no loud colours.
- **Modern**: consistent spacing, soft borders, subtle elevation, rounded-lg corners, clear type hierarchy.
- **Data-first**: the grid is the product; density and readability win over decoration.
- **Low risk**: restyle via shared tokens and primitives, with no new dependencies and no behaviour changes.

## 2. Current state

- Tailwind 3 with an empty `theme.extend`. Colours are hard-coded gray/blue utility classes throughout.
- Buttons, inputs, cards and modals are re-declared inline in each file (`bg-blue-600 px-3 py-1.5 …` appears dozens of times).
- Grid header groups use saturated `green-200` and `purple-200` bands. Rows alternate `#f3f4f6` / `#ffffff` with a `#DBDBDB` hover.
- Nav uses blue filled pills; header is plain white with a bottom border.
- Settings uses native `alert()` for errors, and the commented-out `useToast` shows the intent to switch.
- The app runs on a **LAN**, possibly without internet, so fonts must be bundled locally (no Google Fonts CDN).

## 3. Design tokens

Define once in `tailwind.config.js` (extend) plus CSS variables in `index.css`, then use semantic names.

**Colour**
| Token | Value (Tailwind equivalent) | Use |
|---|---|---|
| `surface` | white | cards, modals, table body |
| `canvas` | slate-50 `#f8fafc` | page background |
| `border` | slate-200 `#e2e8f0` | all dividers and outlines |
| `ink` | slate-900 `#0f172a` | primary text |
| `ink-muted` | slate-500 `#64748b` | secondary text, labels |
| `accent` | `#1e40af` (blue-800), hover `#1e3a8a` | primary buttons, active nav, focus ring |
| `accent-soft` | blue-50 | selected states, highlights |
| `success` / `warning` / `danger` | emerald-700 / amber-700 / red-700, with 50-level backgrounds | badges, alerts |

Section identity in the grid stays but is muted: Customer = emerald-tinted, Vendor = indigo-tinted (50/100 backgrounds, 700 text, 2 px coloured top border on the group header). Project Info and Update Progress stay slate.

**Typography**: Inter, bundled locally via `@fontsource-variable/inter` (the only new package; no network at runtime). Scale: page title 20/28 semibold, section title 14/20 semibold, body 14/20, table 13/18, caption 12/16. Tabular numbers (`tabular-nums`) for all currency, aging and counts.

**Shape and elevation**: radius `md` (6 px) for controls, `lg` (8 px) for cards and modals. Shadows: `shadow-card` (very subtle, 1 px) for cards; `shadow-overlay` for modals and popovers. No heavy shadows.

**Spacing**: 4 px grid. Page padding 24 px, card padding 16–20 px, form gaps 12–16 px.

**Focus**: a consistent 2 px `accent` ring with offset on every interactive element (accessibility).

## 4. Shared primitives

Create `apps/web/src/components/ui/` and migrate usages gradually:

- `Button` (variants: primary, secondary, ghost, danger; sizes: sm, md)
- `Input`, `Select`, `Textarea`, `FormField` (label + hint + error)
- `Card` (with optional header and actions)
- `Badge` (variants: neutral, info, success, warning, danger). Replace the separate stage, priority and flag styles in `columns.tsx` and `StatusFlagCell.tsx`.
- `Modal` (portal, overlay, header, body, footer). Replace the duplicated shell in `EditProjectModal`, `IssuesModal`, `UpdateHistoryModal`, `LinkDriveModal` and `StageConfirmModal`.
- `PageHeader` (title and right-aligned actions)
- `EmptyState` and `Spinner` / skeleton for loading text

All primitives must preserve current `aria-label`s, `role`s, `title`s and `data-testid`s (see section 8).

## 5. Page-by-page changes

### App shell (`AppLayout.tsx`)
- Header: white, 56 px tall, subtle bottom border. Left: small brand mark and "Project Tracker" wordmark. Nav: text tabs with a 2 px accent underline on the active route (replace filled blue pills).
- Right side: notification bell, user chip (initials avatar, name, role in small muted text), "Log out" as a ghost button. The dev role-switcher stays but is visually de-emphasised (dashed border, "DEV" label).
- Page background `canvas`; content max width unconstrained for the grid, constrained (about 1280 px) for Settings and Dashboard.

### Login (`LoginPage.tsx`)
- Centred card on `canvas`, brand mark above the title, larger inputs (40 px), full-width primary button, inline error in a danger-soft alert box.

### Grid (`GridPage.tsx`, `ProjectTable.tsx`, `columns.tsx`)
- Toolbar: one tidy row. Title on the left; Year, Stage and the **Columns** control (see `plan_column_visibility.md`) as compact selects/buttons; "Add project" primary on the right. Group them in a bordered toolbar bar rather than loose elements.
- Table container: `rounded-lg border shadow-card`, white background.
- Header: group row 32 px with muted tints per section; leaf row 36 px, uppercase 11 px tracking-wide `ink-muted` text, slate-50 background.
- Rows: keep project-level striping (it communicates vendor-line grouping) but quieter: odd rows white, even rows slate-50 (`#f8fafc`); hover slate-100 (`#f1f5f9`). Cell padding `px-3 py-2`; text 13 px; numbers right-aligned with `tabular-nums`.
- Sticky columns: keep opaque backgrounds via `--row-bg`; refine the divider shadow to a 1 px border plus a soft shadow.
- Badges (stage, priority, flags) use the shared `Badge`: pill, 11–12 px, soft background, no heavy border.
- Empty and loading states use `EmptyState` and a skeleton instead of plain text.
- Pagination footer: sticky, left "Rows per page" and totals, right Prev/Next as secondary buttons.
- Add-project form: render in a `Card` with grouped sections (Project, Customer, Assignment, Vendor lines) instead of one loose grid.

### Modals
- Shared `Modal`: 8 px radius, header with title and subtitle (kept as is), body scroll with a sticky footer so Save/Cancel are always visible in the long Edit modal.
- Edit modal sections get card-like grouping with section titles; vendor line boxes get a light slate background and a clear "Vendor N" header with the priority badge.
- Required "Update Progress" block uses a warning-soft callout.

### Dashboard (`DashboardPage.tsx`, `ChartCard.tsx`, `AddViewForm.tsx`)
- Page header with "Add view" primary. Add-view form in a `Card`.
- Chart cards: consistent header, filters as a compact row, charts use a refined palette (blue-800, slate-500, emerald-600, amber-500, rose-600, indigo-500, teal-600) instead of the current bright set; thin axes, light gridlines, readable tooltips.
- Drill-down panel: visually attached to the card with a top divider.

### Settings (`SettingsPage.tsx`)
- Each panel becomes a `Card` with header, description and consistent tables (sticky header, zebra off, row hover).
- Replace `alert()` calls with `useToast`. Re-enable the `showToast` code already commented in the file.
- Forms use `FormField` with consistent widths.

### Notifications, Toast, Drive Browser
- Notification panel: same popover style as other overlays; unread items use `accent-soft` with a left accent bar.
- Toasts: white card with a coloured left border and icon (success/error/info) instead of solid coloured blocks; keep the existing 4 s duration and `role="status"`.
- Drive Browser: tree inside a `Card`, folder/file icons from a small inline SVG set (replace emoji for a more formal look).

## 6. Icons

Use a small set of inline SVG icons (pencil, chevron, close, bell, folder, check, alert) in `components/ui/icons.tsx`. No icon library dependency, and emoji removed from the UI.

## 7. Implementation phases

1. **Foundations**: tokens in `tailwind.config.js`, `index.css`, Inter font, base `body` styles.
2. **Primitives**: `Button`, `Input`/`Select`/`FormField`, `Card`, `Badge`, `Modal`, `PageHeader`, icons.
3. **Shell and Login**: `AppLayout`, `LoginPage`, `Toast`, `NotificationBell`.
4. **Grid**: toolbar, header tints, striping/hover, badges, footer, add-project form.
5. **Modals**: migrate the five modals onto `Modal`.
6. **Dashboard, Settings, Drive Browser**.
7. **Polish pass**: focus rings, empty/loading states, responsive check at 1280/1440/1920 widths, final consistency sweep.

Ship phase by phase so each step is reviewable and reversible.

## 8. Constraints and test impact

The Playwright suite locks several visual and semantic details. Changing them requires updating the specs in the same change.

- **Row colours**: `sticky-columns.spec.ts` asserts `rgb(255,255,255)` (white stripe) and `rgb(219,219,219)` (hover). If stripe or hover colours change (section 5 proposes slate-50 and slate-100), update those expected values, ideally by reading shared constants rather than hard-coding.
- **Sticky cells** must stay opaque (rows scroll underneath) and keep `position: sticky`.
- **Row flash** (`row-flash`, `row-flash-sticky` keyframes) fades to `--stripe-bg`; keep that variable contract. `dashboard-drilldown.spec.ts` expects a non-white flash on the sticky cell.
- **Keep** all `aria-label`, `title`, `role`, `data-testid`, button text and link names that specs query (e.g. `Edit project`, `View issues`, `Save changes`, `Add vendor`, `notification-bell`, dialog names like `Edit <project>`).
- **Virtualizer**: `estimateSize` is 44 px and the highlight scroll uses it. If row height changes, update both.
- **Grid column sizes** in `columns.tsx` feed the sticky width cap; adjust only deliberately.
- **No new runtime network dependencies**; fonts are bundled.

## 9. Acceptance criteria

- One consistent look across all pages, driven by tokens (no new ad-hoc hex colours in components, except the documented grid stripe constants).
- Duplicated button, input and modal markup replaced by shared primitives.
- No `alert()` left in the UI.
- Keyboard focus is visible everywhere; text contrast meets WCAG AA.
- The Playwright suite passes after the planned expected-value updates.
- The grid remains as dense and fast as today (virtualization unchanged).

## 10. Open decisions

1. Accent colour: deep blue (proposed) versus teal or slate-only?
2. Dark mode? Tailwind `darkMode: ['class']` is already set, but v1 is light only.
3. Do you have a company logo or brand colours to use in the header and login page?
4. Keep the green/purple section identity (muted, as proposed) or go fully neutral?
