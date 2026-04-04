# Story 2.4: ModeCard Component with Controls

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As theRoad,
I want the ModeCard component on the dashboard so I can see Volume Max status, allocate funds, select pairs, configure slippage, and toggle the mode on/off,
so that I can control and monitor the trading mode from a single card.

## Acceptance Criteria (BDD)

**AC1: ModeCard renders with all required elements**
Given the dashboard layout from Epic 1 with three card slots
When the dashboard renders
Then a ModeCard for Volume Max displays with: mode name (purple accent), status badge, toggle switch, 2x2 stats grid (PnL, Trades, Volume, Allocated), fund allocation bar, pair selector, and slippage input

**AC2: Toggle switch controls mode start/stop via API**
Given the ModeCard is rendered
When the user clicks the toggle switch
Then it calls POST `/api/mode/volume-max/start` (toggle on) or POST `/api/mode/volume-max/stop` (toggle off)
And the toggle uses optimistic UI — badge changes immediately, reverts after 2s if server rejects

**AC3: Fund allocation input**
Given the ModeCard is rendered
When the user interacts with the fund allocation input
Then the input is monospace, right-aligned, `$` prefix, numeric-only
And it calls PUT `/api/mode/volume-max/config` with `{ allocation: number }` on blur/Enter
And it is read-only when mode is running

**AC4: Pair selector**
Given the ModeCard is rendered
When the user opens the pair selector
Then it shows a multi-select dropdown with available pairs
And boosted pairs show a flame icon and sort to top
And it is disabled when mode is running
And pair changes call PUT `/api/mode/:mode/config` with `{ pairs: string[] }`

**AC5: Slippage input**
Given the ModeCard is rendered
When the user edits the slippage field
Then it accepts values from 0.1% to 5.0% with one decimal place
And invalid values revert to previous
And changes call PUT `/api/mode/:mode/config` with `{ slippage: number }`

**AC6: Status badge states and transitions**
Given the ModeCard is rendered
When the mode status changes
Then the badge shows: gray "Stopped" (off), green "Starting..." (transitional), green "Running" (on), gray "Stopping..." (while positions close), red "Error" with error detail text below stats, red "Kill Switch" with kill-switch details (positions closed, prices, loss amount)
And transitions use 200ms ease timing via Tailwind `transition-colors duration-200`
And error state preserves last known stats in muted color

**AC7: Stats grid empty state**
Given the mode is stopped and has no stats
When the ModeCard renders
Then stats show $0.00 / 0 in muted color

**AC8: FundAllocationBar states**
Given the ModeCard is rendered
Then the bar shows remaining/total ratio with mode identity color fill
And transitions to amber at >80% used
And transitions to red at >90% used
And shows gray "Not allocated" when allocation is zero

**AC9: All three mode cards render**
Given the dashboard renders
Then Volume Max (purple), Profit Hunter (green), and Arbitrage (cyan) ModeCards all render
And non-active modes show in stopped state with identical structure

## Tasks / Subtasks

- [x] **Task 0** — Extract shared formatting helpers (prerequisite for Tasks 2, 3)
  - [x] 0.1 Create `src/client/lib/format.ts` — extract from `src/client/components/top-bar.tsx`:
    - `formatCurrency(value: number, showSign = false): string` — currently inline in top-bar.tsx (lines 6-16). Accepts display-unit numbers, formats as `$1,247.83` or `+$1,247.83` / `-$42.10`. Note: top-bar.tsx passes smallest-unit values and divides by 1e6 internally — ModeCard stats arrive in display units from the store, so the extracted helper should accept display units directly. Refactor top-bar.tsx to convert before calling.
    - `formatInteger(value: number): string` — currently inline in top-bar.tsx (lines 18-20). Uses `Intl.NumberFormat("en-US")`.
  - [x] 0.2 Update `src/client/components/top-bar.tsx` — replace inline `formatCurrency()` and `formatInteger()` with imports from `../lib/format`
  - [x] 0.3 Verify top-bar still renders correctly after extraction

- [x] **Task 1** — Create REST API client module (AC: #2, #3, #4, #5)
  - [x] 1.1 Create `src/client/lib/api.ts` exporting typed API functions:
    - `startMode(mode: ModeType): Promise<void>` — POST `/api/mode/${modeSlug}/start`
    - `stopMode(mode: ModeType): Promise<void>` — POST `/api/mode/${modeSlug}/stop`
    - `updateModeConfig(mode: ModeType, config: { allocation?: number; pairs?: string[]; slippage?: number }): Promise<void>` — PUT `/api/mode/${modeSlug}/config`
    - `fetchStatus(): Promise<StatusResponse>` — GET `/api/status`
    - Helper: `modeTypeToSlug(mode: ModeType): string` — maps `"volumeMax"` → `"volume-max"`, `"profitHunter"` → `"profit-hunter"`, `"arbitrage"` → `"arbitrage"`
  - [x] 1.2 Define `StatusResponse` type in `src/shared/types.ts` (shared types must be defined before use per architecture):
    ```typescript
    export interface StatusResponse {
      modes: Record<ModeType, ModeConfig>;
      positions: Position[];
      trades: Trade[];
      connection: ConnectionState;
    }
    ```
  - [x] 1.3 Error handling: parse JSON error response `{ error: { severity, code, message, details, resolution } }`. Create an `ApiError` class (or plain object) carrying these fields so the UI can display severity-appropriate feedback. On network failure, throw generic error with `resolution: "Check your network connection"`.

- [x] **Task 2** — Rewrite ModeCard component with full interactivity (AC: #1, #2, #3, #4, #5, #6, #7, #8, #9)
  - [x] 2.1 Update `src/client/components/mode-card.tsx` — replace current static shell with interactive component
  - [x] 2.2 Define new `ModeCardProps` interface:
    ```typescript
    interface ModeCardProps {
      mode: ModeType;
      name: string;
      color: string;          // Tailwind text class e.g. "text-mode-volume"
      barColor: string;       // CSS hex for allocation bar e.g. "#8b5cf6"
    }
    ```
  - [x] 2.3 **Header section**: Mode name (colored by `color` prop), StatusBadge, Toggle Switch
    - StatusBadge: map `ModeStatus` to badge appearance (use `cn()` from `../lib/utils` for conditional classes, add `transition-colors duration-200` for animated transitions):
      - `"stopped"` → gray bg, "Stopped" text
      - `"starting"` → green bg, "Starting..." text
      - `"running"` → green bg, "Running" text
      - `"stopping"` → gray bg, "Stopping..." text (while positions close — brief transitional state)
      - `"error"` → red bg, "Error" text
      - `"kill-switch"` → red bg pulsing, "Kill Switch" text
    - Toggle Switch: `<Switch>` component
      - `checked` = mode status is `"running"` or `"starting"`
      - `disabled` when: allocation is 0, or status is `"error"`, `"kill-switch"`, or `"stopping"`
      - `onCheckedChange` calls `handleToggle()`
      - `aria-label="Toggle {name} mode"`
  - [x] 2.4 **Toggle handler with optimistic UI** (AC: #2):
    - On toggle on: dispatch `store.setModeStatus(mode, "starting")` for optimistic update, call `api.startMode(mode)`. If API rejects, revert via `store.setModeStatus(mode, "stopped")`. Use a 2s safety timeout — if no WebSocket `mode.started` event arrives, revert. Clear timeout on unmount or when real event arrives.
    - On toggle off: dispatch `store.setModeStatus(mode, "stopping")` for optimistic update, call `api.stopMode(mode)`. If API rejects, revert via `store.setModeStatus(mode, "running")`. Same 2s safety timeout.
    - Use `useRef` for the timeout handle. Clear on unmount.
    - On API error: revert status AND show error detail from the `ApiError` fields (code, message, resolution). Log to console in dev mode.
  - [x] 2.5 **Stats grid** (AC: #7): 2x2 grid with StatCell subcomponent
    - PnL: `formatCurrency(stats.pnl, true)` with `showSign=true`, colored: positive → `text-profit`, negative → `text-loss`, zero → `text-text-muted`
    - Trades: `formatInteger(stats.trades)` in `text-text-primary`
    - Volume: `formatCurrency(stats.volume)` in `text-text-primary`
    - Allocated: `formatCurrency(stats.allocated)` in `text-text-primary`
    - Use `formatCurrency` and `formatInteger` from `../lib/format` (extracted in Task 0)
    - Empty state: `$0.00` / `0` in `text-text-muted` when values are zero
    - Each StatCell value element gets `aria-live="polite"` for screen reader updates
    - Error/kill-switch state: stats preserve last known values in `text-text-muted`
  - [x] 2.5a **Error detail section** (AC: #6): Rendered below stats when status is `"error"`
    - Show error message text from store (set via MODE_ERROR event payload: `{ code, message, details }`)
    - Text in `text-loss` color, small font
    - `aria-live="assertive"` for screen reader announcement
  - [x] 2.5b **Kill-switch detail section** (AC: #6): Rendered below stats when status is `"kill-switch"`
    - Show kill-switch details: positions closed, loss amount
    - Text in `text-loss` color
    - `aria-live="assertive"` for screen reader announcement
  - [x] 2.6 **Fund allocation bar** (AC: #8): FundAllocationBar subcomponent
    - Props: `allocated: number`, `remaining: number`, `modeColor: string`
    - Calculate `usedPercent = allocated > 0 ? ((allocated - remaining) / allocated) * 100 : 0`
    - Bar fill color: `modeColor` (default), amber `#f59e0b` when usedPercent > 80, red `#ef4444` when usedPercent > 90
    - Apply `transition: width 200ms ease, background-color 200ms ease` on the fill div for animated updates
    - Label: `"$X,XXX / $X,XXX remaining"` when allocated > 0, `"Not allocated"` when allocated is 0
    - Gray empty bar when not allocated
  - [x] 2.7 **Fund allocation input** (AC: #3):
    - Monospace, right-aligned, `$` prefix positioned outside input
    - Numeric-only validation (strip non-numeric on input, allow decimal)
    - On blur or Enter: if value changed, call `api.updateModeConfig(mode, { allocation: numericValue })`
    - Read-only (disabled) when mode status is `"running"` or `"starting"`
    - `aria-label="Fund allocation for {name}"`
  - [x] 2.8 **Pair selector — multi-select** (AC: #4):
    - IMPORTANT: shadcn `<Select>` is single-select only. Implement a custom multi-select dropdown using a button trigger + popover/dropdown with checkboxes for each pair. Use shadcn `<Badge>` to show selected pairs as tags, or comma-separated text in collapsed state.
    - Available pairs: hardcode initial set `["SOL/USDC", "ETH/USDC", "BTC/USDC"]` (will be dynamic later). Must select at least 1 pair.
    - Boosted pairs: show lucide `Flame` icon (16px, amber color) next to pair name, sort boosted pairs to top of list (stubbed — no boosted data source yet, all pairs treated as non-boosted). Flame icon: `role="img" aria-label="Boosted pair"`.
    - `aria-label="Select trading pairs for {name}"`
    - Disabled when mode is running/starting/stopping
    - On change: call `api.updateModeConfig(mode, { pairs: selectedPairs })`
  - [x] 2.9 **Slippage input** (AC: #5):
    - Small inline input showing percentage (e.g., "0.5%"), monospace
    - Validation: 0.1 to 5.0, one decimal place. Invalid values revert.
    - On blur/Enter: call `api.updateModeConfig(mode, { slippage: numericValue })`
    - Disabled when running

- [x] **Task 3** — Update App.tsx to pass new ModeCard props (AC: #9)
  - [x] 3.1 Update `MODES` constant to include `ModeType` and bar color:
    ```typescript
    const MODES = [
      { mode: "volumeMax" as ModeType, name: "Volume Max", color: "text-mode-volume", barColor: "#8b5cf6" },
      { mode: "profitHunter" as ModeType, name: "Profit Hunter", color: "text-mode-profit", barColor: "#22c55e" },
      { mode: "arbitrage" as ModeType, name: "Arbitrage", color: "text-mode-arb", barColor: "#06b6d4" },
    ] as const;
    ```
  - [x] 3.2 Update ModeCard rendering to pass new props: `<ModeCard key={m.mode} mode={m.mode} name={m.name} color={m.color} barColor={m.barColor} />`

- [x] **Task 4** — Add mode state to Zustand store (AC: #1, #6)
  - [x] 4.1 Extend `ValBotStore` interface with mode state. Each mode stores `ModeConfig` plus UI-specific fields:
    ```typescript
    interface ModeStoreEntry extends ModeConfig {
      errorDetail: { code: string; message: string; details: string | null } | null;
      killSwitchDetail: { positionsClosed: number; lossAmount: number } | null;
    }
    modes: {
      volumeMax: ModeStoreEntry;
      profitHunter: ModeStoreEntry;
      arbitrage: ModeStoreEntry;
    };
    ```
  - [x] 4.2 Initialize each mode with defaults: `{ mode, status: "stopped", allocation: 0, pairs: ["SOL/USDC"], slippage: 0.5, stats: { pnl: 0, trades: 0, volume: 0, allocated: 0, remaining: 0 }, errorDetail: null, killSwitchDetail: null }`
  - [x] 4.3 Add store actions:
    - `setModeStatus(mode: ModeType, status: ModeStatus): void` — used by optimistic UI and WebSocket events. Clears `errorDetail`/`killSwitchDetail` when transitioning away from error/kill-switch states.
    - `updateModeStats(mode: ModeType, stats: ModeStats): void`
    - `setModeConfig(mode: ModeType, config: Partial<ModeConfig>): void`
    - `loadInitialStatus(data: StatusResponse): void` — populate modes, positions, connection from GET /api/status. Handles case where some modes may already have events queued.
  - [x] 4.4 Extend `handleWsMessage` to handle mode events (validate `data.mode` exists in modes before updating — guards against events arriving before initial hydration):
    - `EVENTS.MODE_STARTED`: set mode status to `"running"`, clear errorDetail
    - `EVENTS.MODE_STOPPED`: set mode status to `"stopped"`, update stats from `finalStats`, clear errorDetail
    - `EVENTS.MODE_ERROR`: set mode status to `"error"`, store `errorDetail` from payload `{ code, message, details }`
    - `EVENTS.STATS_UPDATED`: update mode stats (pnl, trades, volume, allocated, remaining) — only update if mode exists in store
    - `EVENTS.ALERT_TRIGGERED` with code `KILL_SWITCH_TRIGGERED`: set relevant mode status to `"kill-switch"`, store `killSwitchDetail` from alert details
  - [x] 4.5 **Note on scope overlap with Story 2.5**: This task adds the `modes` slice and basic event handlers needed for ModeCard to function. Story 2.5 will extend this further with aggregated SummaryBar stats, trade log buffer, and position tracking. The store shape established here MUST match the architecture spec's Zustand store shape.

- [x] **Task 5** — Initial status load on dashboard mount (AC: #1)
  - [x] 5.1 In `App.tsx` (or a new `useInitialStatus` hook), call `api.fetchStatus()` on mount
  - [x] 5.2 Call `store.loadInitialStatus(response)` to hydrate modes, positions, connection state
  - [x] 5.3 This runs once before WebSocket takes over for live updates
  - [x] 5.4 **Race condition guard**: WebSocket may connect and deliver events before `fetchStatus()` resolves. The `handleWsMessage` handlers (Task 4.4) must gracefully handle events for modes that haven't been hydrated yet — either queue them or apply to default state. Simplest approach: `handleWsMessage` checks if `modes[data.mode]` exists before updating; if not, the event is silently ignored (initial hydration will set correct state shortly after).

- [x] **Task 6** — Update shared types (AC: #2, #6)
  - [x] 6.1 Add `"stopping"` to `ModeStatus` type in `src/shared/types.ts`:
    ```typescript
    export type ModeStatus = "stopped" | "starting" | "running" | "stopping" | "error" | "kill-switch";
    ```
    This is a client-only transitional state (optimistic UI during stop). The server only returns `"stopped"` or `"running"` — `"stopping"` is set by the client toggle handler and cleared when `mode.stopped` WebSocket event arrives.
  - [x] 6.2 Add `modeTypeToSlug` to `src/shared/types.ts`:
    ```typescript
    const MODE_SLUG_MAP: Record<ModeType, string> = {
      volumeMax: "volume-max",
      profitHunter: "profit-hunter",
      arbitrage: "arbitrage",
    };
    export function modeTypeToSlug(mode: ModeType): string {
      return MODE_SLUG_MAP[mode];
    }
    ```
    This is the inverse of the existing `urlModeToModeType`.
  - [x] 6.3 Add `StatusResponse` interface to `src/shared/types.ts` (see Task 1.2)

- [x] **Task 7** — Write tests (AC: all)
  - [x] 7.0 `src/client/lib/format.test.ts`:
    - Test formatCurrency with positive, negative, zero values
    - Test formatCurrency with showSign flag
    - Test formatInteger with comma formatting
  - [x] 7.1 `src/client/lib/api.test.ts`:
    - Test startMode sends POST to correct URL with correct slug
    - Test stopMode sends POST to correct URL
    - Test updateModeConfig sends PUT with body
    - Test fetchStatus returns parsed response
    - Test error response parsing — ApiError carries severity, code, message, details, resolution
    - Test network failure throws generic error
    - Mock `fetch` globally for all tests
  - [x] 7.2 `src/client/components/mode-card.test.tsx`:
    - Test renders mode name, badge, toggle, stats, allocation bar, pair selector, slippage
    - Test toggle calls startMode API on check, stopMode on uncheck
    - Test optimistic badge update: badge changes to "Starting..."/"Stopping..." before API resolves
    - Test optimistic revert: badge reverts on API error
    - Test fund allocation input: numeric only, calls updateModeConfig on blur
    - Test fund allocation read-only when running
    - Test pair selector: multi-select shows pairs, disabled when running
    - Test slippage input: validates range 0.1-5.0, reverts invalid
    - Test FundAllocationBar color states (normal, amber >80%, red >90%, gray empty)
    - Test status badge renders correct text/color for ALL 7 ModeStatus values (stopped, starting, running, stopping, error, kill-switch)
    - Test toggle disabled when no allocation
    - Test toggle disabled when kill-switch, error, or stopping
    - Test error detail section renders when status is error
    - Test kill-switch detail section renders when status is kill-switch
    - Test stats preserved in muted color during error state
    - Test accessibility: aria-labels on toggle, fund input, pair selector; aria-live on stats and error sections
  - [x] 7.3 `src/client/store/index.test.ts` (extend existing):
    - Test modes initial state matches defaults
    - Test setModeStatus updates correct mode and clears errorDetail on non-error transition
    - Test updateModeStats updates correct mode stats
    - Test handleWsMessage MODE_STARTED sets status to running, clears errorDetail
    - Test handleWsMessage MODE_STOPPED sets status to stopped and updates stats
    - Test handleWsMessage MODE_ERROR sets status to error and stores errorDetail
    - Test handleWsMessage STATS_UPDATED updates mode stats
    - Test handleWsMessage ignores events for unknown modes (race condition guard)
    - Test loadInitialStatus hydrates all mode configs
    - Test ALERT_TRIGGERED with KILL_SWITCH_TRIGGERED sets mode to kill-switch
  - [x] 7.4 `src/shared/types.test.ts` (extend or create):
    - Test modeTypeToSlug maps all three modes correctly
    - Test ModeStatus type includes "stopping"

## Dev Notes

### Existing Code to Extend (DO NOT Recreate)

| File | What Exists | What to Add/Change |
|------|-------------|---------------------|
| `src/client/components/mode-card.tsx` | Static shell: Card with hardcoded "Stopped" badge, disabled Switch, static $0.00 stats, static allocation bar | REWRITE: Add toggle handler with optimistic UI, wire to store + API, add fund input, pair selector, slippage input, all status badge states |
| `src/client/store/index.ts` | Zustand store with connection, stats, alerts, and handlers for CONNECTION_STATUS and ALERT_TRIGGERED events | ADD: `modes` state slice with per-mode ModeConfig, actions (setModeStatus, updateModeStats, setModeConfig, loadInitialStatus), extend handleWsMessage for MODE_STARTED/STOPPED/ERROR/STATS_UPDATED |
| `src/client/App.tsx` | Renders MODES array as `{ name, color }`, passes to ModeCard | UPDATE: MODES array to include `mode: ModeType`, `barColor`. Update ModeCard props. Add initial status fetch on mount |
| `src/shared/types.ts` | ModeType, ModeStatus, ModeConfig, ModeStats, urlModeToModeType, fromSmallestUnit | ADD: `modeTypeToSlug()` — inverse of urlModeToModeType for client API calls |
| `src/shared/events.ts` | All 9 EVENTS, typed payloads including ModeStartedPayload, ModeStoppedPayload, ModeErrorPayload, StatsUpdatedPayload | No changes — import and use existing types |
| `src/server/api/mode.ts` | POST /start, POST /stop, PUT /config routes — already wired to engine | No changes — consumed by client API module |
| `src/server/api/status.ts` | GET /api/status returns `{ modes, positions, trades, connection }` with ModeConfig per mode | No changes — consumed by client fetchStatus |
| shadcn/ui components | Card, Badge, Switch, Input, Select, ScrollArea, Alert, Table all installed in `src/client/components/ui/` | No new installations needed. Use existing Badge (custom variants), Switch, Input, Select |
| `src/client/components/top-bar.tsx` | Inline `formatCurrency()` (lines 6-16) and `formatInteger()` (lines 18-20), connection status display, summary stats | MODIFY: Remove inline formatCurrency/formatInteger, import from `../lib/format`. Note: top-bar passes smallest-unit values and divides by 1e6 — refactor to convert before calling shared helper |
| `src/client/lib/utils.ts` | `cn()` utility for Tailwind class merging | No changes — import as needed. Use `cn()` for ALL conditional class merging in ModeCard (badge colors, stat colors, disabled states) |
| `src/client/hooks/use-websocket.ts` | WebSocket hook with reconnection, dispatches to store handleWsMessage | No changes — already dispatches all events to store |

### Architecture Compliance

- **Client never imports from server**: ModeCard uses `src/client/lib/api.ts` for REST calls, receives live data via WebSocket → Zustand store. Never imports server modules.
- **Zustand slice selectors**: ModeCard subscribes via `useStore(s => s.modes.volumeMax)` — NEVER `useStore(s => s)`. Each card subscribes only to its own mode slice.
- **REST for commands, WebSocket for events**: Toggle start/stop and config changes go through REST API. Status updates arrive via WebSocket. Initial hydration from GET /api/status.
- **Flat component structure**: `mode-card.tsx` is a single flat file in `src/client/components/`. Internal subcomponents (StatCell, FundAllocationBar) are defined in the same file — NOT in separate files.
- **Import rules**:
  - `mode-card.tsx` imports from: `./ui/card`, `./ui/badge`, `./ui/switch`, `./ui/input`, `../store`, `../lib/api`, `../lib/format`, `../lib/utils` (cn), `@shared/types`, `lucide-react` (Flame icon)
  - `api.ts` imports from: `@shared/types`
  - `format.ts` imports from: nothing (pure utility functions)
  - `top-bar.tsx` imports from: `../lib/format` (replaces inline helpers), `@shared/types` (fromSmallestUnit)
  - Store imports from: `@shared/types`, `@shared/events`

### Naming Conventions (Match Established Patterns)

- Files: `kebab-case` — `mode-card.tsx`, `api.ts`, `mode-card.test.tsx`
- React components: `PascalCase` — `ModeCard`, `StatCell`, `FundAllocationBar`
- Functions: `camelCase` — `startMode()`, `handleToggle()`, `formatCurrency()`
- CSS classes: Tailwind utilities + custom tokens — `text-mode-volume`, `bg-surface-elevated`, `font-mono`
- Types: `PascalCase` — `ModeCardProps`, `StatusResponse`

### Data Format Rules (CRITICAL)

- **API sends display units**: The GET `/api/status` response already returns `allocation` and stats in display units (the server calls `fromSmallestUnit()`). The client does NOT need to convert.
- **API config endpoint expects display units**: PUT `/api/mode/:mode/config` with `{ allocation: 100 }` means $100 USDC. The server calls `toSmallestUnit()` internally.
- **Financial formatting**: Use `formatCurrency()` helper — `Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })`. PnL shows sign prefix: `+$1,247.83` or `-$42.10`. Zero: `$0.00` in muted.
- **Dates**: `Date.now()` timestamps. Format for display with `Intl.DateTimeFormat`.

### UX Design Compliance (CRITICAL)

- **Dark theme only**: All custom tokens from `index.css` — `--mode-volume`, `--mode-profit`, `--mode-arb`, `--profit`, `--loss`, `--warning`, `--neutral`
- **Font**: JetBrains Mono (`font-mono`) for ALL financial numbers in stats grid and inputs. Inter for labels and UI text.
- **Mode identity colors**: Volume Max = `#8b5cf6` (purple), Profit Hunter = `#22c55e` (green), Arbitrage = `#06b6d4` (cyan)
- **Status badge colors**: green = running/starting, red = error/kill-switch, gray = stopped
- **Toggle switch**: Blue when on (`--accent-blue`), gray when off. Disabled = grayed out, no pointer.
- **Optimistic UI**: Badge changes immediately on toggle. Reverts if server rejects within 2s.
- **Transitions**: 200ms ease on badge state changes.
- **Fund allocation bar**: thin horizontal bar, mode-colored fill, amber >80% used, red >90% used, gray when empty.
- **Pair selector disabled when running**: can't change pairs mid-operation.
- **Fund input read-only when running**: can't change allocation mid-operation.
- **Slippage input disabled when running**: can't change slippage mid-operation.

### ModeCard Component Design

**Layout (top to bottom):**
1. **Header**: `[Mode Name (colored)]  [Badge]  [Toggle Switch]` — flex row, justify-between
2. **Stats Grid**: 2×2 grid — PnL (top-left), Trades (top-right), Volume (bottom-left), Allocated (bottom-right). Each cell: small label + large monospace value
3. **Error/Kill-switch Detail** (conditional): Rendered below stats only when status is `"error"` or `"kill-switch"`. Shows relevant detail text.
4. **Fund Allocation Section**: Label row (`"Fund Allocation"` + `"$X / $X remaining"`), progress bar below
5. **Fund Input**: `$` prefix + numeric input for allocation amount
6. **Pair Selector**: Custom multi-select checkbox dropdown (NOT shadcn Select — it's single-select only)
7. **Slippage**: Small inline input `"0.5%"`

**Dynamic store selector pattern**: ModeCard receives `mode: ModeType` as prop and subscribes via `useStore(s => s.modes[mode])`. This allows a single component definition to render all three modes.

### Previous Story Intelligence

**From Story 2.3 (Mode Runner & Volume Max Strategy):**
- API routes are fully wired: POST `/api/mode/:mode/start` calls `startMode()`, POST `/api/mode/:mode/stop` calls `stopMode()`
- PUT `/api/mode/:mode/config` handles `allocation`, `pairs`, `slippage` — allocation is persisted via `fundAllocator.setAllocation(mode, toSmallestUnit(amount))`
- `getModeStatus()` in engine returns `"running"` or `"stopped"`. Position manager returns `"kill-switch"`. Status route merges them.
- GET `/api/status` returns complete `{ modes: { volumeMax: ModeConfig, ... }, positions: [], trades: [], connection: { status, walletBalance } }` — this is the initial hydration source
- Error factories return `AppError` with `{ severity, code, message, resolution }` — the API returns these as `{ error: { severity, code, message, details, resolution } }`
- Review finding: concurrent startMode calls are now guarded by per-mode lock

**From Story 1.4 (SummaryBar & WebSocket):**
- WebSocket hook dispatches to `store.handleWsMessage()`. Currently handles CONNECTION_STATUS and ALERT_TRIGGERED. Unhandled events log in dev mode. Extend `handleWsMessage` to handle MODE_STARTED, MODE_STOPPED, MODE_ERROR, STATS_UPDATED.
- TopBar `formatCurrency()` is **inline** (not exported) at lines 6-16 of `top-bar.tsx`. It accepts smallest-unit values and divides by 1e6 internally. `formatInteger()` is also inline at lines 18-20. **Task 0 extracts these** to `src/client/lib/format.ts`. Important: the extracted `formatCurrency` should accept display-unit numbers (not smallest-unit), since ModeCard stats from the store are already in display units. Refactor top-bar.tsx to call `fromSmallestUnit()` before passing to the extracted helper.

**From Story 1.3 (Design System):**
- Custom CSS variables for colors defined in `index.css` — `--mode-volume`, `--mode-profit`, `--mode-arb`, `--profit`, `--loss`, etc.
- Tailwind classes map: `text-mode-volume` → `var(--mode-volume)`, `bg-profit` → `var(--profit)`, etc.
- `font-mono` maps to JetBrains Mono.

### Git Intelligence

Recent commits (Stories 2-1 through 2-3) show:
- 224 tests passing as of last commit — ensure no regressions (especially top-bar.tsx after format extraction)
- Pattern: co-located tests next to source files
- Pattern: each story creates new files + modifies existing files as needed
- Pattern: `@shared/types` and `@shared/events` are the canonical type sources
- Pattern: no `src/client/lib/api.ts` or `format.ts` exists yet — this story creates both
- `formatCurrency()` and `formatInteger()` are inline in `top-bar.tsx` (confirmed) — Task 0 extracts them
- Path aliases: `@shared/*` and `@client/*` are configured in tsconfig — use `@shared/types` for shared imports, relative paths (`../lib/format`) for client-internal imports

### Testing Approach

- Co-located test files: `mode-card.test.tsx` next to `mode-card.tsx`, `api.test.ts` next to `api.ts`
- Use Vitest + React Testing Library (`@testing-library/react`, `@testing-library/user-event`)
- `// @vitest-environment jsdom` directive at top of component test files
- Mock `fetch` globally for API tests: `vi.stubGlobal("fetch", vi.fn())`
- Mock Zustand store in component tests: `vi.mock("../store", ...)` or use the real store with controlled state
- Test user interactions with `userEvent.click()`, `userEvent.type()`, `userEvent.clear()`
- Test optimistic UI: verify badge changes immediately, then verify revert on rejection
- Property-based assertions for errors (avoid `instanceof`)

### Project Structure Notes

New files to create:
```
src/client/lib/
├── format.ts                    # Extracted formatCurrency(), formatInteger() shared helpers
├── format.test.ts
├── api.ts                       # REST API client: startMode(), stopMode(), updateModeConfig(), fetchStatus()
├── api.test.ts
src/client/components/
├── mode-card.test.tsx           # Comprehensive ModeCard component tests
```

Modified files:
```
src/client/components/mode-card.tsx    # REWRITE: full interactive ModeCard with toggle, fund input, pair selector, slippage, error/kill-switch details
src/client/components/top-bar.tsx      # REFACTOR: remove inline formatCurrency/formatInteger, import from ../lib/format
src/client/store/index.ts              # ADD: modes state slice (ModeStoreEntry), mode actions, extend handleWsMessage for 5 new events
src/client/store/index.test.ts         # EXTEND: tests for modes state and new event handlers
src/client/App.tsx                     # UPDATE: MODES array, ModeCard props, initial status fetch hook
src/shared/types.ts                    # ADD: "stopping" to ModeStatus, modeTypeToSlug(), StatusResponse interface
src/shared/types.test.ts              # EXTEND: test modeTypeToSlug, ModeStatus includes stopping
```

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Epic 2, Story 2.4 acceptance criteria]
- [Source: _bmad-output/planning-artifacts/architecture.md — Component Architecture (flat files), Zustand Store Shape, API Endpoints, WebSocket Event Catalog, Loading States]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — ModeCard anatomy (header, stats grid, fund bar, pair selector, slippage), five states (stopped/starting/running/error/kill-switch), toggle behavior, optimistic UI, badge colors, fund allocation bar states, pair selector disabled-when-running, mode identity colors, financial number formatting, accessibility requirements]
- [Source: _bmad-output/planning-artifacts/prd.md — FR1 (start/stop), FR7-FR8 (pair selection, boosted pairs), FR9-FR11 (fund allocation), FR25 (slippage), FR26 (mode toggle)]
- [Source: src/client/components/mode-card.tsx — Current static shell to rewrite]
- [Source: src/client/store/index.ts — Current store with connection + alerts, extend with modes]
- [Source: src/client/App.tsx — Current MODES array and layout]
- [Source: src/shared/types.ts — ModeType, ModeStatus, ModeConfig, ModeStats, urlModeToModeType]
- [Source: src/shared/events.ts — EVENTS constants, ModeStartedPayload, ModeStoppedPayload, ModeErrorPayload, StatsUpdatedPayload]
- [Source: src/server/api/mode.ts — POST start/stop, PUT config routes (already wired)]
- [Source: src/server/api/status.ts — GET /api/status response shape]
- [Source: _bmad-output/implementation-artifacts/2-3-mode-runner-and-volume-max-strategy.md — Previous story: engine wiring, API routes, review findings]
- [Source: _bmad-output/project-context.md — Tailwind v4 rules, shadcn/ui install path, Zustand selector rules, font rules, error handling]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

None — clean implementation.

### Completion Notes List

- Task 0: Extracted `formatCurrency()` and `formatInteger()` to `src/client/lib/format.ts`. Refactored `top-bar.tsx` to use `fromSmallestUnit()` before calling the shared helpers (format now accepts display units).
- Task 1: Created `src/client/lib/api.ts` with `startMode`, `stopMode`, `updateModeConfig`, `fetchStatus` functions. Created `ApiError` class with severity, code, message, details, resolution fields. Network errors throw generic ApiError with "Check your network connection" resolution.
- Task 2: Rewrote `mode-card.tsx` with full interactivity: StatusBadge for all 6 states with transition-colors, toggle with optimistic UI and 2s safety timeout, StatCell with aria-live, error/kill-switch detail sections, FundAllocationBar with color thresholds (amber >80%, red >90%), fund allocation input (monospace, numeric-only, read-only when running), custom multi-select pair dropdown with checkboxes, slippage input with 0.1-5.0 validation.
- Task 3: Updated `App.tsx` MODES array with `mode: ModeType` and `barColor`. Updated ModeCard rendering to pass new props.
- Task 4: Extended Zustand store with `modes` slice (`ModeStoreEntry` extends `ModeConfig` + `errorDetail`/`killSwitchDetail`). Added `setModeStatus`, `updateModeStats`, `setModeConfig`, `loadInitialStatus` actions. Extended `handleWsMessage` for MODE_STARTED, MODE_STOPPED, MODE_ERROR, STATS_UPDATED, and KILL_SWITCH_TRIGGERED alert.
- Task 5: Added `useEffect` in `App.tsx` to call `fetchStatus()` on mount and hydrate store via `loadInitialStatus`. Race condition guard: handleWsMessage checks `modes[mode]` exists before updating.
- Task 6: Added `"stopping"` to `ModeStatus` type, `modeTypeToSlug()` function, and `StatusResponse` interface to shared types.
- Task 7: 60 new tests across 4 test files. All 284 tests passing (was 224).

### Review Findings

- [x] [Review][Patch] Missing useEffect cleanup for safety timeout on unmount — fixed
- [x] [Review][Patch] Negative/Infinity allocation values pass validation — fixed
- [x] [Review][Patch] Allocation/slippage/pair API calls fire-and-forget with no error handling — fixed
- [x] [Review][Patch] loadInitialStatus preserves stale errorDetail/killSwitchDetail — fixed
- [x] [Review][Patch] fetchStatus catch block silently swallows errors — fixed
- [x] [Review][Patch] Kill-switch to running transition possible via MODE_STARTED — fixed
- [x] [Review][Defer→Fixed] Safety timeout + API in-flight split-brain — added AbortController + timeout/fetch coordination
- [x] [Review][Defer→Fixed] Rapid toggles cause concurrent API calls — added togglingRef lock
- [x] [Review][Defer→Fixed] fetchStatus JSON response not runtime-validated — added isValidStatusResponse shape validator

### Change Log

- 2026-04-04: Implemented Story 2-4 — ModeCard Component with Controls. All 7 tasks complete, 60 new tests, 284 total passing.

### File List

New files:
- src/client/lib/format.ts
- src/client/lib/format.test.ts
- src/client/lib/api.ts
- src/client/lib/api.test.ts

Modified files:
- src/client/components/mode-card.tsx (rewritten: full interactive ModeCard)
- src/client/components/mode-card.test.tsx (rewritten: comprehensive tests)
- src/client/components/top-bar.tsx (refactored: import shared format helpers)
- src/client/store/index.ts (extended: modes state slice, mode actions, WS event handlers)
- src/client/store/index.test.ts (extended: mode state tests)
- src/client/App.tsx (updated: MODES array, ModeCard props, initial status fetch)
- src/shared/types.ts (added: stopping status, modeTypeToSlug, StatusResponse)
- src/shared/types.test.ts (extended: modeTypeToSlug tests, stopping type test)
