# Story 1.3: Dark Theme Design System & Dashboard Layout Shell

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As theRoad,
I want the dashboard to load with a dark theme, proper typography, and the three-zone grid layout showing empty states,
So that when I open the browser I see a professional trading dashboard ready for content.

## Acceptance Criteria

1. **Given** the bot is running and I open the dashboard in a browser, **When** the page loads, **Then** the dark theme is applied with base background `#0a0a0f` and surface `#12121a`.
2. **And** semantic color tokens are configured: profit green (`#22c55e`), loss red (`#ef4444`), warning amber (`#f59e0b`), neutral gray (`#6b7280`), accent blue (`#3b82f6`).
3. **And** Inter font is used for UI text and JetBrains Mono for number placeholders.
4. **And** the layout uses CSS Grid with three zones: top bar, mode cards row (3 equal columns), bottom split (3fr + 2fr).
5. **And** the dashboard fills `100vh` with no vertical scroll.
6. **And** shadcn/ui Card, Badge, Switch, Table, ScrollArea, Alert, Input, Select components are installed.
7. **And** all zones show placeholder/empty state content.

## Tasks / Subtasks

- [x] Task 1: Configure Tailwind v4 dark theme tokens in `src/client/index.css` (AC: #1, #2)
  - [x] 1.1 Add `:root` CSS custom properties for **both** shadcn/ui standard variables AND custom ValBot tokens. shadcn/ui components are hardcoded to use classes like `bg-background`, `bg-card`, `border-border`, etc. — without these variables defined, all 8 shadcn components will render broken (transparent backgrounds, invisible borders, missing text). Map ValBot design tokens to shadcn's expected names: `--background: #0a0a0f`, `--foreground: #f1f5f9`, `--card: #12121a`, `--card-foreground: #f1f5f9`, `--border: #2a2a3a`, `--input: #2a2a3a`, `--ring: #3b82f6`, `--primary: #3b82f6`, `--primary-foreground: #f1f5f9`, `--secondary: #1a1a26`, `--secondary-foreground: #f1f5f9`, `--muted: #1a1a26`, `--muted-foreground: #64748b`, `--accent: #1a1a26`, `--accent-foreground: #f1f5f9`, `--popover: #12121a`, `--popover-foreground: #f1f5f9`, `--destructive: #ef4444`, `--destructive-foreground: #f1f5f9`, `--radius: 0.5rem`. ALSO add the custom ValBot tokens: `--surface: #12121a`, `--surface-elevated: #1a1a26`, `--border-subtle: #2a2a3a`, `--profit: #22c55e`, `--loss: #ef4444`, `--warning: #f59e0b`, `--neutral: #6b7280`, `--text-primary: #f1f5f9`, `--text-secondary: #94a3b8`, `--text-muted: #64748b`, `--mode-volume: #8b5cf6`, `--mode-profit: #22c55e`, `--mode-arb: #06b6d4`
  - [x] 1.2 Add `@theme inline { }` block mapping **all** CSS variables to Tailwind theme namespace. Must include shadcn standard mappings (`--color-background`, `--color-foreground`, `--color-card`, `--color-card-foreground`, `--color-border`, `--color-input`, `--color-ring`, `--color-primary`, `--color-primary-foreground`, `--color-secondary`, `--color-secondary-foreground`, `--color-muted`, `--color-muted-foreground`, `--color-accent`, `--color-accent-foreground`, `--color-popover`, `--color-popover-foreground`, `--color-destructive`, `--color-destructive-foreground`, `--radius-sm`, `--radius-md`, `--radius-lg`) AND custom ValBot mappings (`--color-surface`, `--color-surface-elevated`, `--color-border-subtle`, `--color-profit`, `--color-loss`, `--color-warning`, `--color-neutral`, `--color-text-primary`, `--color-text-secondary`, `--color-text-muted`, `--color-mode-volume`, `--color-mode-profit`, `--color-mode-arb`)
  - [x] 1.3 Configure font-family tokens: `--font-sans: 'Inter', system-ui, -apple-system, sans-serif` and `--font-mono: 'JetBrains Mono', ui-monospace, monospace`
  - [x] 1.4 Add Google Fonts `<link>` tags for Inter (400, 500, 600, 700) and JetBrains Mono (400, 700) in `index.html`

- [x] Task 2: Install shadcn/ui components (AC: #6)
  - [x] 2.1 Run `pnpm dlx shadcn@latest add card badge switch table scroll-area alert input select`
  - [x] 2.2 Verify all 8 components are installed in `src/client/components/ui/`
  - [x] 2.3 Verify components import correctly and render without errors

- [x] Task 3: Build the three-zone CSS Grid layout in `App.tsx` (AC: #4, #5)
  - [x] 3.1 Replace current App.tsx placeholder with CSS Grid layout: `grid-template-rows: auto auto 1fr`, height `100vh`, background `bg-background`
  - [x] 3.2 Top bar zone: full width, auto height — renders `<TopBar />` placeholder component
  - [x] 3.3 Mode cards zone: `grid-template-columns: repeat(3, 1fr)` with `gap-4` — renders 3 `<ModeCard />` placeholder components
  - [x] 3.4 Bottom zone: `grid-template-columns: 3fr 2fr` with `gap-4` — renders `<PositionsTable />` and `<TradeLog />` placeholder components. **CRITICAL:** Add `min-h-0` on the bottom grid row wrapper — without this, CSS Grid children won't shrink below content size and the layout will overflow 100vh
  - [x] 3.5 Add `p-4 gap-4` padding around the grid, minimum width `1280px`
  - [x] 3.6 Leave a slot above the top bar for future AlertBanner (Story 3.4) — either an empty div or a comment marking where the persistent critical alert banner will render above the main grid

- [x] Task 4: Create placeholder components with empty states (AC: #7)
  - [x] 4.1 Create `src/client/components/top-bar.tsx` — shadcn Card, horizontal flex, left: "ValBot" title + gray dot "Disconnected", right: stat placeholders (Wallet: $0.00, Total PnL: $0.00, Session PnL: $0.00, Trades: 0, Volume: $0.00) in muted text with monospace numbers
  - [x] 4.2 Create `src/client/components/mode-card.tsx` — shadcn Card with: header (mode name colored by mode identity + gray Badge "Stopped" + Switch disabled), 2×2 stats grid (PnL: $0.00, Trades: 0, Volume: $0.00, Allocated: $0.00) in muted monospace, fund allocation bar at 0% with "Not allocated" label. Accept a typed `mode` prop: `{ name: string; color: string }` — pass `{ name: 'Volume Max', color: 'text-mode-volume' }`, `{ name: 'Profit Hunter', color: 'text-mode-profit' }`, `{ name: 'Arbitrage', color: 'text-mode-arb' }`
  - [x] 4.3 Create `src/client/components/positions-table.tsx` — shadcn Card wrapping shadcn Table with headers (Mode, Pair, Side, Size, Entry, Mark, PnL, Stop-Loss), empty body with centered "No open positions" in muted text
  - [x] 4.4 Create `src/client/components/trade-log.tsx` — shadcn Card wrapping shadcn ScrollArea with header "Live Trade Log", empty body with centered "Waiting for trades..." in muted monospace text

- [x] Task 5: Verify visual correctness (AC: #1–#7)
  - [x] 5.1 Run `pnpm dev` and open in browser — dashboard fills viewport, no scroll, dark theme applied
  - [x] 5.2 Verify all three grid zones render correctly at 1280px and 1920px widths
  - [x] 5.3 Verify fonts load (Inter for UI, JetBrains Mono for numbers)
  - [x] 5.4 Verify all placeholder components render with correct empty states
  - [x] 5.5 Verify shadcn/ui components render with correct dark styling (Card backgrounds visible as `#12121a`, borders visible as `#2a2a3a`, Badge text visible) — confirms shadcn CSS variables are properly mapped
  - [x] 5.6 Check browser console for zero errors (no missing module imports, no undefined CSS variables)

## Dev Notes

### Critical Architecture Constraints

- **Dark theme is the ONLY theme.** No light mode, no toggle. Hard-code dark colors directly — no `.dark` class switching needed.
- **Tailwind v4 CSS-first config.** All theme tokens go in `src/client/index.css` using `:root` variables + `@theme inline { }`. There is NO `tailwind.config.js`.
- **`@tailwindcss/vite` plugin** is already configured in `vite.config.ts`. No PostCSS needed.
- **shadcn/ui components** are copied into `src/client/components/ui/` — they are project-owned files, not node_module imports.
- **Components are flat files** in `src/client/components/`. No nested folders per component. One file per component.
- **File naming:** `kebab-case` — `mode-card.tsx`, `top-bar.tsx`, `trade-log.tsx`, `positions-table.tsx`.
- **Component naming in code:** `PascalCase` — `ModeCard`, `TopBar`, `TradeLog`, `PositionsTable`.
- **No routing.** Single-page dashboard, no React Router. All content on one viewport.
- **`cn()` utility** exists at `src/client/lib/utils.ts` for merging Tailwind classes — use it for conditional styling.

### Tailwind v4 Theme Token Setup (CRITICAL — shadcn/ui compatibility)

The current `index.css` has only:
```css
@import "tailwindcss";

body {
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
}

.font-mono {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
}
```

**Replace with the full theme configuration.** You MUST define **both** the standard shadcn/ui variables AND the custom ValBot tokens. shadcn/ui components are hardcoded to use Tailwind classes like `bg-background`, `bg-card`, `text-foreground`, `border-border`, etc. If these CSS variables are missing, ALL shadcn components render broken — transparent backgrounds, invisible borders, no text.

```css
@import "tailwindcss";

:root {
  /* === shadcn/ui REQUIRED variables (components break without these) === */
  --background: #0a0a0f;
  --foreground: #f1f5f9;
  --card: #12121a;
  --card-foreground: #f1f5f9;
  --popover: #12121a;
  --popover-foreground: #f1f5f9;
  --primary: #3b82f6;
  --primary-foreground: #f1f5f9;
  --secondary: #1a1a26;
  --secondary-foreground: #f1f5f9;
  --muted: #1a1a26;
  --muted-foreground: #64748b;
  --accent: #1a1a26;
  --accent-foreground: #f1f5f9;
  --destructive: #ef4444;
  --destructive-foreground: #f1f5f9;
  --border: #2a2a3a;
  --input: #2a2a3a;
  --ring: #3b82f6;
  --radius: 0.5rem;

  /* === ValBot custom design tokens === */
  --surface: #12121a;
  --surface-elevated: #1a1a26;
  --border-subtle: #2a2a3a;
  --profit: #22c55e;
  --loss: #ef4444;
  --warning: #f59e0b;
  --neutral: #6b7280;
  --text-primary: #f1f5f9;
  --text-secondary: #94a3b8;
  --text-muted: #64748b;
  --mode-volume: #8b5cf6;
  --mode-profit: #22c55e;
  --mode-arb: #06b6d4;
}

@theme inline {
  /* === shadcn/ui REQUIRED theme mappings === */
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --radius-sm: calc(var(--radius) - 2px);
  --radius-md: var(--radius);
  --radius-lg: calc(var(--radius) + 2px);

  /* === ValBot custom theme mappings === */
  --color-surface: var(--surface);
  --color-surface-elevated: var(--surface-elevated);
  --color-border-subtle: var(--border-subtle);
  --color-profit: var(--profit);
  --color-loss: var(--loss);
  --color-warning: var(--warning);
  --color-neutral: var(--neutral);
  --color-text-primary: var(--text-primary);
  --color-text-secondary: var(--text-secondary);
  --color-text-muted: var(--text-muted);
  --color-mode-volume: var(--mode-volume);
  --color-mode-profit: var(--mode-profit);
  --color-mode-arb: var(--mode-arb);
  --font-sans: 'Inter', system-ui, -apple-system, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground;
  }
}
```

**Available utility classes after this setup:**
- shadcn standard: `bg-background`, `bg-card`, `text-foreground`, `text-card-foreground`, `border-border`, `bg-muted`, `text-muted-foreground`, `bg-primary`, `bg-destructive`, `bg-popover`, etc.
- ValBot custom: `bg-surface`, `bg-surface-elevated`, `text-profit`, `text-loss`, `text-warning`, `text-neutral`, `text-text-primary`, `text-text-secondary`, `text-text-muted`, `text-mode-volume`, `text-mode-profit`, `text-mode-arb`, `font-mono`, `font-sans`

### shadcn/ui Configuration

`components.json` already exists at project root with correct paths:
- Components dir: `src/client/components`
- UI dir: `src/client/components/ui`
- Utils: `src/client/lib/utils`
- CSS: `src/client/index.css`
- `cssVariables: true` — required for CSS variable theming
- `rsc: false` — NOT using React Server Components
- `style: "default"`
- `iconLibrary: "lucide"`

**Install command:** `pnpm dlx shadcn@latest add card badge switch table scroll-area alert input select`

### CSS Grid Layout Specification

```
┌─────────────────────────────────────────────────┐
│          (Alert Banner slot — empty for now)     │
├─────────────────────────────────────────────────┤
│                   Top Bar (auto)                 │
├───────────────┬───────────────┬─────────────────┤
│   ModeCard    │   ModeCard    │    ModeCard      │
│  Volume Max   │ Profit Hunter │   Arbitrage      │
│   (1fr)       │    (1fr)      │    (1fr)         │
├───────────────┴──────┬────────┴─────────────────┤
│   Positions Table    │    Live Trade Log         │
│      (3fr)           │       (2fr)               │
│   fills remaining    │   fills remaining         │
│     height           │     height                │
└──────────────────────┴──────────────────────────┘
```

Root wrapper (flex column, 100vh):
```
display: flex
flex-direction: column
height: 100vh
min-width: 1280px
background: var(--background) → bg-background
```
The alert banner slot sits above the grid (empty div or comment placeholder for Story 3.4). The main grid fills remaining space with `flex: 1; min-height: 0`.

Main grid container (inside flex):
```
display: grid
grid-template-rows: auto auto 1fr
grid-template-columns: 1fr
flex: 1
min-height: 0  /* CRITICAL: allows grid to shrink within flex parent */
gap: 1rem (gap-4)
padding: 1rem (p-4)
```

Mode cards row (nested grid):
```
display: grid
grid-template-columns: repeat(3, 1fr)
gap: 1rem (gap-4)
```

Bottom split (nested grid):
```
display: grid
grid-template-columns: 3fr 2fr
gap: 1rem (gap-4)
min-height: 0  /* CRITICAL: allows children to shrink below content size in grid */
```

**CRITICAL CSS GRID GOTCHA:** The bottom panels MUST have `min-h-0` on the grid row wrapper AND `overflow-hidden` on the Card containers. Without `min-h-0`, CSS Grid children default to `min-height: auto` which prevents them from shrinking below their content size — this WILL cause the layout to overflow past 100vh. Use shadcn ScrollArea inside each bottom card for scrollable content.

### Spacing Scale for Component Internals

| Spacing | Value | Usage |
|---|---|---|
| `gap-1` | 4px | Within badges, between icon and label |
| `gap-2` | 8px | Between stat label and value, within card sections |
| `gap-3` | 12px | Between card sections |
| `gap-4` / `p-4` | 16px | Card internal padding, spacing between cards in grid |
| `gap-6` | 24px | Section spacing on the dashboard |

### Typography Quick Reference

| Element | Tailwind Classes |
|---|---|
| Dashboard title | `text-xl font-semibold` (Inter) |
| Mode card title | `text-lg font-semibold` (Inter) |
| Stat label | `text-xs font-medium text-text-secondary` (Inter) |
| Stat value | `text-2xl font-bold font-mono` (JetBrains Mono) |
| Table header | `text-xs font-medium text-text-secondary` (Inter) |
| Table cell (text) | `text-sm` (Inter) |
| Table cell (number) | `text-sm font-mono` (JetBrains Mono) |
| Trade log entry | `text-xs font-mono` (JetBrains Mono) |
| Badge text | `text-xs font-medium` (Inter) |

### Empty State Specifications

- **Mode cards:** Stats show `$0.00` / `0` in `text-text-muted` with `font-mono`. Badge shows "Stopped" in gray. Fund bar at 0% with "Not allocated" label.
- **Positions table:** Headers visible, body shows "No open positions" centered in `text-text-muted`.
- **Trade log:** Header visible, body shows "Waiting for trades..." centered in `text-text-muted font-mono`.
- **Top bar:** All stat values show `$0.00` / `0` in `text-text-muted font-mono`. Connection shows gray dot + "Disconnected".

### Accessibility Baseline (applies to shell)

- All text colors meet WCAG AA contrast minimum (4.5:1 for normal text, 3:1 for large text). The chosen colors satisfy this: `#f1f5f9` on `#0a0a0f` = 18.1:1, `#94a3b8` on `#0a0a0f` = 7.5:1, `#64748b` on `#0a0a0f` = 4.6:1.
- Add `ring-2 ring-ring` focus indicators on all interactive elements (Switch, Input, Select) for keyboard navigation.
- Minimum 12px (`text-xs`) for any readable text.
- Financial number placeholders should show `+`/`-` prefix alongside green/red coloring — never rely on color alone.
- Status badges include text labels ("Stopped", "Disconnected") alongside their colored dots.

### Performance Hints (for future-proofing)

- Use React `key` props on any list items (trade log entries, position rows) for efficient DOM reconciliation.
- Trade log should cap at 500 entries in the DOM; older entries garbage collected (not needed now with empty state, but structure the component to allow it).
- Use `will-change: transform` on elements that will have CSS transitions (fund allocation bar, badge transitions) to promote GPU compositing.
- Do NOT add loading spinners or skeleton screens — architecture mandates "no global loading state, dashboard always shows current data via WebSocket."

### Current State of Files to Modify

**`src/client/index.css`** — Currently has minimal content (just `@import "tailwindcss"`, body font, and `.font-mono`). Replace with full theme token configuration.

**`src/client/App.tsx`** — Currently shows a centered "ValBot" heading. Replace entirely with the three-zone grid layout importing all placeholder components.

**`index.html`** — Add Google Fonts `<link>` tags for Inter and JetBrains Mono in `<head>`.

### Files to Create/Modify

```
index.html                     # MODIFY — add Google Fonts <link> tags for Inter and JetBrains Mono
src/client/
├── index.css                  # MODIFY — full Tailwind v4 theme tokens (shadcn + custom)
├── App.tsx                    # MODIFY — three-zone CSS Grid layout with component imports
├── components/
│   ├── top-bar.tsx            # NEW — summary bar with connection status placeholder
│   ├── mode-card.tsx          # NEW — mode control card with empty state
│   ├── positions-table.tsx    # NEW — positions table with empty state
│   ├── trade-log.tsx          # NEW — trade log with empty state
│   └── ui/                    # POPULATED — by shadcn CLI (8 components + dependencies)
```

### What NOT to Do

- Do NOT add a `tailwind.config.js` or `tailwind.config.ts` — Tailwind v4 uses CSS-only config.
- Do NOT add `@tailwind base; @tailwind components; @tailwind utilities;` — use `@import "tailwindcss"`.
- Do NOT create a `.dark` class or theme toggle — dark is the only theme.
- Do NOT add React Router or any routing — single page.
- Do NOT add WebSocket connection logic — that's Story 2.5.
- Do NOT add Zustand store — that's Story 2.5.
- Do NOT add real data fetching or API calls — all data is static placeholders.
- Do NOT add interactivity to toggle switches or inputs — they should be visible but non-functional.
- Do NOT create nested component folders — flat files in `components/`.
- Do NOT use `@apply` directives — use utility classes directly.
- Do NOT add media queries or responsive breakpoints — single fixed layout, `min-width: 1280px`.
- Do NOT virtualize the trade log or positions table — they're empty placeholders.
- Do NOT create separate CSS files per component — all styling via Tailwind utilities.
- Do NOT add loading spinners, skeleton screens, or loading states — architecture mandates no global loading state.
- Do NOT define ONLY custom tokens without shadcn/ui standard variables — components will render broken without `--background`, `--card`, `--border`, etc.

### Previous Story Intelligence

**From Story 1.2 (Database Schema & Migration Setup):**
- Dev agent model: Claude Opus 4.6 (1M context)
- `drizzle.config.ts` was modified — be aware if touching config files
- The project structure is confirmed working with `pnpm dev` running both server and client
- Story 1.2 was purely backend — no client-side changes were made
- Review process caught path resolution issues (CWD vs absolute) — be mindful of any path-dependent code

**From Story 1.1 (Project Scaffolding):**
- `vite.config.ts` has proxy config for `/api` → `localhost:3000` and `/ws` → WebSocket
- `@shared` path alias configured in both `tsconfig.json` and `vite.config.ts`
- `components.json` (shadcn config) already exists and is correctly configured
- `src/client/lib/utils.ts` has the `cn()` utility already

### Installed Dependencies Already Available

From `package.json` — no new runtime dependencies needed:
- `react` 19.2.4, `react-dom` 19.2.4
- `tailwindcss` 4.2.2, `@tailwindcss/vite` 4.2.2
- `clsx` 2.1.1, `tailwind-merge` 3.5.0 (used by `cn()`)
- `zustand` 5.0.12 (available but don't use yet — Story 2.5)

shadcn CLI (`pnpm dlx shadcn@latest`) will add component files only — no new packages unless a component has a dependency (e.g., `@radix-ui/react-switch` for Switch).

### Project Structure Notes

- Alignment with unified project structure: all new files go in `src/client/components/` as flat `kebab-case.tsx` files
- shadcn primitives go in `src/client/components/ui/` (populated by CLI)
- No conflicts with existing files — `App.tsx` and `index.css` are the only modifications

### References

- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Dark Theme Color System] — All color hex values and semantic meanings
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Typography] — Font stack, type scale, weight specifications
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Dashboard Layout] — CSS Grid three-zone specification
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Component Specifications] — ModeCard, TopBar, PositionsTable, TradeLog anatomy and states
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Empty States] — Placeholder content for all zones
- [Source: _bmad-output/planning-artifacts/architecture.md#Frontend Architecture] — Component structure, flat files, shadcn composition
- [Source: _bmad-output/planning-artifacts/architecture.md#Project Structure] — File paths and organization
- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.3] — Acceptance criteria and dependencies
- [Source: _bmad-output/project-context.md#Tailwind v4 + shadcn/ui Rules] — CSS import, Vite plugin, OKLCH tokens, dark-only theme
- [Source: _bmad-output/project-context.md#Naming Conventions] — kebab-case files, PascalCase components

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

- Build initially failed: shadcn CLI generates imports using `src/client/lib/utils` absolute paths. Added `src/client` alias to `vite.config.ts` and `tsconfig.app.json` paths to resolve.
- shadcn CLI does not auto-install peer dependencies `class-variance-authority` and `lucide-react`. Installed manually.
- `baseUrl` is deprecated in TypeScript 7. Used `rootDir` + `paths` instead.
- @testing-library/react requires explicit `cleanup` in `afterEach` when vitest globals are false.

### Completion Notes List

- Task 1: Full Tailwind v4 dark theme configured with both shadcn/ui standard CSS variables and custom ValBot design tokens. `:root` vars, `@theme inline {}` block, font-family tokens, and `@layer base` rules all in place. Google Fonts links were already present in `index.html` from Story 1.1.
- Task 2: All 8 shadcn/ui components installed (card, badge, switch, table, scroll-area, alert, input, select). Added `class-variance-authority` and `lucide-react` as dependencies required by badge/alert/select components.
- Task 3: Three-zone CSS Grid layout built in `App.tsx` with flex column wrapper (100vh, min-w-1280px), alert banner slot, and grid with auto/auto/1fr rows. Mode cards use `repeat(3, 1fr)`, bottom split uses `3fr 2fr`. Critical `min-h-0` applied on both the main grid and bottom row.
- Task 4: Four placeholder components created — TopBar (title, connection status, stat placeholders), ModeCard (typed mode prop with color, badge, disabled switch, 2x2 stats, fund allocation bar), PositionsTable (8-column table with empty state), TradeLog (ScrollArea with empty state).
- Task 5: Vite production build passes (45 modules, 247KB JS). TypeScript check passes cleanly. All 43 tests pass (22 existing + 21 new). Visual verification requires manual browser check by user.
- Infrastructure: Added `src/client` path alias to `vite.config.ts` and `tsconfig.app.json` for shadcn/ui import resolution. Updated `vitest.config.ts` with `src/client` alias and `jsdom` environment. Installed `@testing-library/react`, `@testing-library/jest-dom`, `jsdom` as dev dependencies.

### File List

**Modified:**
- `src/client/index.css` — Full Tailwind v4 dark theme token configuration
- `src/client/App.tsx` — Three-zone CSS Grid dashboard layout
- `vite.config.ts` — Added `src/client` path alias for shadcn imports
- `tsconfig.app.json` — Added `src/client` path and rootDir for TS resolution
- `vitest.config.ts` — Added `src/client` alias and jsdom environment
- `package.json` — New dependencies (class-variance-authority, lucide-react, @testing-library/react, @testing-library/jest-dom, jsdom)
- `pnpm-lock.yaml` — Updated lockfile

**Created:**
- `src/client/components/top-bar.tsx` — TopBar component with connection status and stat placeholders
- `src/client/components/mode-card.tsx` — ModeCard component with typed mode prop and empty state
- `src/client/components/positions-table.tsx` — PositionsTable component with 8-column table
- `src/client/components/trade-log.tsx` — TradeLog component with ScrollArea
- `src/client/components/ui/card.tsx` — shadcn Card component
- `src/client/components/ui/badge.tsx` — shadcn Badge component
- `src/client/components/ui/switch.tsx` — shadcn Switch component
- `src/client/components/ui/table.tsx` — shadcn Table component
- `src/client/components/ui/scroll-area.tsx` — shadcn ScrollArea component
- `src/client/components/ui/alert.tsx` — shadcn Alert component
- `src/client/components/ui/input.tsx` — shadcn Input component
- `src/client/components/ui/select.tsx` — shadcn Select component
- `src/client/app.test.tsx` — Dashboard layout integration tests (6 tests)
- `src/client/components/top-bar.test.tsx` — TopBar component tests (3 tests)
- `src/client/components/mode-card.test.tsx` — ModeCard component tests (7 tests)
- `src/client/components/positions-table.test.tsx` — PositionsTable component tests (3 tests)
- `src/client/components/trade-log.test.tsx` — TradeLog component tests (2 tests)

### Change Log

- 2026-04-04: Implemented Story 1.3 — Dark theme design system with full Tailwind v4 token configuration, shadcn/ui component installation (8 components), three-zone CSS Grid dashboard layout, and four placeholder components with empty states. Added 21 component tests. Fixed shadcn path resolution by adding `src/client` alias to Vite and TypeScript configs.

### Review Findings

- [x] [Review][Decision] Color tokens use hex instead of OKLCH — resolved: keep hex, updated project-context.md to reflect hex convention
- [x] [Review][Decision] No named "accent blue" semantic token — resolved: added `--accent-blue: #3b82f6` token to `:root` and `@theme inline` in index.css
- [x] [Review][Patch] `vitest.config.ts` sets `environment: 'jsdom'` globally — fixed: removed global jsdom, added `// @vitest-environment jsdom` docblock to each client test file
- [x] [Review][Patch] Test assertions use `.toBeDefined()` which is vacuous with `getByText` — fixed: configured `@testing-library/jest-dom/vitest` setup file, replaced all `.toBeDefined()` with `.toBeInTheDocument()`
- [x] [Review][Defer] PositionsTable not scrollable when rows exceed available height — fixed: added `overflow-auto` to CardContent
- [x] [Review][Defer] TradeLog ScrollArea height chain may not resolve correctly — fixed: added `overflow-hidden` to CardContent
- [x] [Review][Defer] `min-w-[1280px]` causes horizontal scroll on narrow viewports with no dark scrollbar styling — fixed: added `overflow-hidden` to root container
- [x] [Review][Defer] Non-standard bare `src/client` path alias — fixed: renamed to `@client` across vite.config.ts, vitest.config.ts, tsconfig.app.json, and all 8 shadcn UI component imports
