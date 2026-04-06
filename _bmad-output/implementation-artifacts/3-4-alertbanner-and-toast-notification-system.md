# Story 3.4: AlertBanner & Toast Notification System

Status: done

## Story

As theRoad,
I want critical errors to show as persistent banners and non-critical alerts as toast notifications with severity-appropriate styling,
So that I can immediately see what's wrong and know exactly what to do about it.

## Acceptance Criteria

1. **Given** the dashboard is loaded, **when** a critical `alert.triggered` event is received (kill switch, session expired, RPC failed after retries), **then** a red AlertBanner renders above the entire dashboard (above the SummaryBar/TopBar), includes: warning icon, primary message, expandable details section, and resolution instruction. Critical banners cannot be dismissed until the underlying issue is resolved.
2. **Given** a kill switch alert is received, **then** the banner shows expandable details: positions closed, closing prices, total loss amount.
3. **Given** a warning `alert.triggered` event is received (RPC retry in progress, approaching kill-switch threshold), **then** an amber persistent toast appears in the top-right corner with: severity icon, message, timestamp, and dismiss button.
4. **Given** an info alert is received (reconnection success, trade confirmation), **then** a green toast appears in the top-right corner and auto-dismisses after 5 seconds.
5. Toasts stack vertically from top-right, maximum 3 visible, older toasts collapse.
6. Toasts slide in from right (200ms ease-out) and fade out on dismiss (150ms).
7. Every error displayed includes a resolution path — never a dead end (FR31).

## Tasks / Subtasks

- [x] Task 1: Install sonner and add shadcn/ui Toaster component (AC: #3, #4, #5, #6)
  - [x] 1.1 Add sonner via `npx shadcn@latest add sonner` (project uses pnpm — the shadcn CLI handles this correctly via npx)
  - [x] 1.2 Create `src/client/components/ui/sonner.tsx` wrapper with ValBot dark theme config. **Important:** The generated file may import from `next-themes` — remove that import and hardcode `theme="dark"` since ValBot is dark-only (per project-context.md).
  - [x] 1.3 Configure Toaster: `position="top-right"`, `theme="dark"`, `visibleToasts={3}`, `expand={false}` (collapsed by default, expands on hover — better for trading dashboard). Do NOT use `richColors` — use custom `classNames` only to match ValBot's existing color tokens.
  - [x] 1.4 Mount `<Toaster />` in App.tsx

- [x] Task 2: Enhance AlertBanner for critical alerts (AC: #1, #2, #7)
  - [x] 2.1 Add Lucide `AlertTriangle` icon before message text (`cn()` already imported in alert-banner.tsx)
  - [x] 2.2 Add expandable/collapsible details section (toggle via chevron button, collapsed by default)
  - [x] 2.3 Ensure resolution text always present for critical alerts
  - [x] 2.4 Kill switch banner: display positions closed and loss amount. **Data source:** Kill switch details are NOT on the `Alert` object — they are stored in `store.modes[mode].killSwitchDetail` (set by the store's `KILL_SWITCH_TRIGGERED` handler). Pass `killSwitchDetail` as a new optional prop to AlertBanner, or read it from the store directly using `useStore`. The `Alert.details` string contains a text summary; `killSwitchDetail` has structured `positionsClosed: number` and `lossAmount: number` fields. "Closing prices" are embedded in the `Alert.details` string from the server, not a separate structured field.
  - [x] 2.5 Remove dismiss button for critical severity (already done — verify)

- [x] Task 3: Route alerts to banner vs toast by severity (AC: #1, #3, #4)
  - [x] 3.1 Add `lastToast` state field and `clearLastToast` action to store. In the `ALERT_TRIGGERED` handler: critical alerts → `addAlert()` (banner as before); warning/info alerts → set `lastToast` instead of `addAlert()`. **Keep all special handling** (`API_CONNECTION_FAILED` → connection status, `KILL_SWITCH_TRIGGERED` → mode status/killSwitchDetail) running BEFORE the severity routing — these must not break.
  - [x] 3.2 Create `src/client/hooks/use-alert-toast.ts` hook: subscribes to `store.lastToast`, calls `toast.warning()` or `toast.success()` from sonner, then calls `clearLastToast()`. Warning: `toast.warning(message, { id: alert.code, duration: Infinity, description: details })` — persistent, deduplicatable by code. Info: `toast.success(message, { id: alert.code, duration: autoDismissMs ?? 5000 })` — auto-dismiss.
  - [x] 3.3 Call `useAlertToast()` in App.tsx
  - [x] 3.4 Update `bannerAlerts` filter in App.tsx to critical-only (remove warning from filter)
  - [x] 3.5 The existing `setTimeout` auto-dismiss in the store (for `autoDismissMs`) can remain for critical alerts. For warning/info, `autoDismissMs` is passed as `duration` to the sonner toast call instead.

- [x] Task 4: Toast styling and animations (AC: #5, #6)
  - [x] 4.1 Add sonner animation CSS overrides to `src/client/index.css`: slide-in from right (200ms ease-out), fade-out on dismiss (150ms)
  - [x] 4.2 Warning toasts: custom `classNames.warning` using `border-warning bg-warning/10 text-warning` tokens
  - [x] 4.3 Info/success toasts: custom `classNames.success` using `border-profit bg-profit/10 text-profit` tokens
  - [x] 4.4 Toast text: include severity icon (Lucide), message, timestamp (formatted), dismiss button
  - [x] 4.5 Verify max 3 visible with collapse behavior

- [x] Task 5: Tests (AC: all)
  - [x] 5.1 `alert-banner.test.tsx` (**Modified** — 5 existing tests: empty state, critical render, critical non-dismissable, warning dismissable, details rendering. Add new tests for: icon renders, expandable details toggle, kill switch detail formatting)
  - [x] 5.2 `store/index.test.ts` (**Modified** — add tests for severity routing: critical → addAlert, warning/info → lastToast, autoDismissMs passthrough, special handlers still run for warning/info)
  - [x] 5.3 `app.test.tsx` (**Modified** — 6 existing tests. Add: Toaster mounts, useAlertToast hook called, bannerAlerts only contains critical)
  - [x] 5.4 Run `pnpm test` to verify zero regressions against baseline of 415 tests (27 files)

## Dev Notes

### What Already Exists (DO NOT recreate)

- **`alert-banner.tsx`** — Renders critical/warning alerts as banners with color-coded styling, dismiss button for warnings. Currently handles both critical AND warning; after this story, warnings move to toasts.
- **Zustand store `alerts` state** — `addAlert()`, `dismissAlert()`, `handleWsMessage()` ALERT_TRIGGERED handler with code-based deduplication and `autoDismissMs` support.
- **`AlertTriggeredPayload`** in `shared/events.ts` — Already has `severity`, `code`, `message`, `details`, `resolution`, `positionsClosed`, `lossAmount`, `autoDismissMs` fields.
- **`Alert` type** in `shared/types.ts` — Has `id`, `severity`, `code`, `message`, `details`, `resolution`, `timestamp`, `autoDismissMs`. Does **NOT** have `positionsClosed` or `lossAmount` — those are on `AlertTriggeredPayload` only and extracted into `store.modes[mode].killSwitchDetail` by the store handler.
- **`broadcast()` + `cacheAlert()`** in `broadcaster.ts` — Server broadcasts alerts; caches last alert for late-connecting clients.
- **`AppError` class** in `lib/errors.ts` — All errors already include `resolution` field (FR31).
- **`ui/alert.tsx`** shadcn primitive — Exists but unused. Not needed for this story.
- **Color tokens** — `loss` (red/critical), `warning` (amber), `profit` (green/info) already defined in Tailwind config.
- **`API_CONNECTION_FAILED` alert flow** — Story 3-3 already broadcasts warning/info/critical alerts with this code. The warning ("retrying 1/3...") and info ("Reconnected") alerts are the primary consumers of the new toast system.
- **`KILL_SWITCH_TRIGGERED` alert flow** — Story 3-1 broadcasts critical alert with `positionsClosed` and `lossAmount` in payload. Store extracts these into `modes[mode].killSwitchDetail` (not into the `Alert` object).
- **`AlertTriggeredPayload.mode`** — Optional `mode?: ModeType` field on the payload. Used by store to target the correct mode entry for kill switch detail. Relevant for AlertBanner if it needs to show which mode triggered the kill switch.

### Architecture: Alert Routing (After This Story)

```
Server broadcasts ALERT_TRIGGERED
  → WebSocket delivers to client
  → Store handleWsMessage() receives payload
  → Route by severity:
      critical → addAlert() → AlertBanner (persistent red banner above TopBar)
      warning  → toast.warning() via sonner (persistent amber toast, top-right)
      info     → toast.success() via sonner (auto-dismiss 5s green toast, top-right)
```

### Key Design Decision: Sonner Over Custom Toast

Use the `sonner` library (shadcn/ui's recommended toast solution) rather than building a custom toast system. The architecture document lists `src/client/components/alert-toast.tsx` as a planned component — we replace that plan with sonner + a `useAlertToast` hook, which provides the same functionality with less custom code.

Reasons:
- Already has stacking, animation, auto-dismiss, and positioning built in
- shadcn/ui provides a themed wrapper component
- Supports persistent toasts (`duration: Infinity`) for warnings
- Handles max visible count and collapse natively
- Reduces custom code and test surface
- Warning toasts that are dismissed by the user will re-appear if the underlying condition persists, because the server re-broadcasts the alert (satisfying UX spec requirement for warning re-appearance)

### Sonner Configuration for ValBot

```tsx
// src/client/components/ui/sonner.tsx
// NOTE: Do NOT import from next-themes. Hardcode theme="dark" (ValBot is dark-only).
<Toaster
  position="top-right"
  theme="dark"
  visibleToasts={3}
  expand={false}
  gap={8}
  offset={16}
  toastOptions={{
    duration: 5000,
    classNames: {
      warning: "border-warning bg-warning/10 text-warning",
      success: "border-profit bg-profit/10 text-profit",
      error: "border-loss bg-loss/10 text-loss",
    },
  }}
/>
```

**Why no `richColors`:** The `richColors` prop applies sonner's built-in color scheme, which overrides custom `classNames`. Since ValBot has its own color tokens (`loss`, `warning`, `profit`), use `classNames` only for consistent theming.

### AlertBanner Enhancement: Expandable Details

The current AlertBanner shows details inline. Enhance to:
1. Add `AlertTriangle` icon (from `lucide-react`, already installed) before `[code] message`
2. Wrap details + resolution in a collapsible section
3. Add chevron toggle button (collapsed by default for cleaner look)
4. Kill switch details: format as "Positions closed: X | Loss: $Y.YY" using data from `store.modes[mode].killSwitchDetail` (NOT from the `Alert` object — see Task 2.4). "Closing prices" come from the `Alert.details` string, formatted by the server.
5. Keep `resolution` as monospace pre-formatted text within the expandable section

### Store Change: Toast Integration via `lastToast` Pattern

The store's `ALERT_TRIGGERED` handler currently adds ALL alerts to the `alerts[]` array. Change:

```
Before: all severities → addAlert() → AlertBanner
After:  critical → addAlert() → AlertBanner (unchanged)
        warning  → set lastToast → useAlertToast hook → toast.warning() via sonner
        info     → set lastToast → useAlertToast hook → toast.success() via sonner
```

**Implementation pattern** (store cannot directly import `toast` from sonner — store is pure state):

1. Add `lastToast: Alert | null` state and `clearLastToast()` action to the store
2. In `ALERT_TRIGGERED` handler: after running all special handlers (connection status, kill switch), route by severity — critical → `addAlert()`, warning/info → `set({ lastToast: alertObj })`
3. `useAlertToast` hook (new file `src/client/hooks/use-alert-toast.ts`): subscribes to `lastToast` via `useEffect`, calls `toast.warning()` or `toast.success()` with `{ id: alert.code }` for deduplication, then calls `clearLastToast()`
4. Call `useAlertToast()` in App.tsx

**The existing `setTimeout` auto-dismiss in the store** (lines 259-266) can remain for any critical alerts that have `autoDismissMs`. For warning/info alerts, `autoDismissMs` is passed as `duration` to the sonner toast call instead.

### File Changes

| File | Change |
|------|--------|
| `src/client/components/ui/sonner.tsx` | **New** — shadcn/ui Toaster wrapper. Hardcode `theme="dark"`, remove any `next-themes` import |
| `src/client/components/alert-banner.tsx` | **Modified** — Add AlertTriangle icon, expandable details, kill switch detail formatting via store |
| `src/client/store/index.ts` | **Modified** — Add `lastToast` state + `clearLastToast` action; route warning/info to `lastToast` instead of `addAlert()` |
| `src/client/hooks/use-alert-toast.ts` | **New** — Hook subscribes to `lastToast`, fires `toast()` from sonner, clears `lastToast` |
| `src/client/App.tsx` | **Modified** — Mount `<Toaster />`, call `useAlertToast()`, update bannerAlerts filter to critical-only |
| `src/client/index.css` | **Modified** — Add sonner animation CSS overrides (200ms enter, 150ms exit) |
| `src/client/components/alert-banner.test.tsx` | **Modified** — 5 existing tests. Add: icon rendering, expandable details toggle, kill switch detail formatting |
| `src/client/store/index.test.ts` | **Modified** — Add tests for severity routing (critical→alert, warning/info→lastToast), special handlers preserved |
| `src/client/app.test.tsx` | **Modified** — 6 existing tests. Add: Toaster mounts, useAlertToast called, bannerAlerts critical-only |

### Existing Patterns to Follow

- **Lucide icons:** Already used in `top-bar.tsx` — import from `lucide-react`
- **cn() utility:** Use for conditional classNames (`src/client/lib/utils.ts`)
- **Zustand selectors:** Subscribe via `useStore((s) => s.field)` — never subscribe to entire store
- **Co-located tests:** Place `.test.tsx` next to component files
- **Tailwind v4 syntax:** Use `@import` not `@tailwind`; custom color tokens defined in CSS variables
- **Test patterns:** Vitest + Testing Library; `vi.fn()` for mocks; see `store/index.test.ts` for store testing patterns

### Animation CSS for Sonner

Sonner has built-in animations. To match AC requirements (200ms slide-in, 150ms fade-out), add CSS overrides:

```css
/* In index.css or a dedicated toast stylesheet */
[data-sonner-toaster] [data-sonner-toast] {
  --toast-enter-duration: 200ms;
  transition-timing-function: ease-out;
}
[data-sonner-toaster] [data-sonner-toast][data-removed="true"] {
  --toast-exit-duration: 150ms;
}
```

### Previous Story Intelligence (3-3)

Key learnings from Story 3-3 that apply:
- **`API_CONNECTION_FAILED` alerts already broadcast with `autoDismissMs: 5000` on info severity** — the toast system should respect this field
- **Code-based deduplication in store** — warning toasts with same code should replace previous toast (use sonner's `id` parameter: `toast.warning(msg, { id: alert.code })`)
- **Connection status integration** — `API_CONNECTION_FAILED` warning/info alerts update connection status in store. This must continue working even though warnings/info now route to toasts instead of `alerts[]`
- **Test baseline:** 415 tests (27 files). Run `pnpm test` before starting to confirm baseline. Maintain zero regressions.

### Git Intelligence

Recent commits:
- `47aa1e8`: Story 3-3 — API resilience with retry, health monitoring. Added `autoDismissMs` field to alert payloads.
- `c069634`: Story 3-2 — Graceful shutdown. Established broadcast pattern for safety events.
- `e29b1fc`: Story 3-1 — Kill switch. `KILL_SWITCH_TRIGGERED` alert includes `positionsClosed` and `lossAmount`.

Pattern: Each story adds tests alongside implementation. All test files use Vitest + vi.fn() mocks.

### Critical Warnings

1. **Do NOT break `API_CONNECTION_FAILED` → connection status mapping.** The store handler that sets `reconnecting`/`disconnected`/`connected` based on this alert code must continue working regardless of routing change. The special handling code runs BEFORE the banner/toast routing.
2. **Do NOT break `KILL_SWITCH_TRIGGERED` → mode status mapping.** Same concern — store handler updates `killSwitchDetail` and mode status before routing.
3. **Do NOT remove `autoDismissMs` support from store.** Even though sonner handles duration natively, the store should pass `autoDismissMs` as `duration` to the toast call.
4. **`cacheAlert` replays last alert to late clients.** After routing change, replayed critical alerts still go to banner. Replayed warning/info alerts fire toast on reconnect — this is acceptable behavior.
5. **Warning toasts must be deduplicatable.** Use `toast.warning(msg, { id: alert.code })` so a new alert with the same code replaces the existing toast (e.g., retry count updates "retrying 1/3" → "retrying 2/3").

### Project Structure Notes

- Architecture document lists `src/client/components/alert-toast.tsx` as a planned file — this is replaced by the sonner approach (`ui/sonner.tsx` wrapper + `hooks/use-alert-toast.ts` hook). Do NOT create `alert-toast.tsx`.
- New files follow flat component structure: `src/client/components/ui/sonner.tsx`, `src/client/hooks/use-alert-toast.ts`
- Tests co-located: `src/client/components/alert-banner.test.tsx`
- Package install: `sonner` added to dependencies via shadcn CLI. If it also installs `next-themes`, that's fine — just don't import from it (ValBot is dark-only, hardcode theme).
- UX spec defines AlertBanner with individual props (`severity`, `message`, `details`, `action`, `dismissable`). Existing implementation uses `Alert[]` array prop instead. Keep the existing pattern — `resolution` maps to the spec's `action` prop.

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Epic 3, Story 3.4]
- [Source: _bmad-output/planning-artifacts/architecture.md — Error Handling FR30-FR33, Dashboard FR16-FR24]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — Component Strategy: AlertBanner, Toast patterns]
- [Source: _bmad-output/planning-artifacts/prd.md — FR31: resolution path for every error, FR32: alert payload details]
- [Source: _bmad-output/project-context.md — Error Handling rules, Tailwind v4 + shadcn/ui rules]
- [Source: src/client/components/alert-banner.tsx — Current implementation]
- [Source: src/client/store/index.ts — ALERT_TRIGGERED handler]
- [Source: src/shared/events.ts — AlertTriggeredPayload interface]
- [Source: _bmad-output/implementation-artifacts/3-3-rpc-connection-resilience.md — Alert codes, autoDismissMs pattern]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
- Existing alert-banner tests failed after making details collapsible — updated tests to click expand button before asserting on details content
- Two store tests for API_CONNECTION_FAILED info alerts needed updating since warning/info now route to lastToast instead of alerts[]
- Sonner `[data-sonner-toaster]` attribute not available in jsdom — adjusted Toaster mount test

### Completion Notes List
- Installed sonner via shadcn CLI, customized wrapper to remove next-themes dependency, hardcode dark theme
- Enhanced AlertBanner with AlertTriangle icon, expandable/collapsible details section, kill switch detail formatting from store
- Implemented severity-based routing: critical → alerts[] (banner), warning/info → lastToast (toast via sonner)
- Special handlers (API_CONNECTION_FAILED → connection status, KILL_SWITCH_TRIGGERED → mode status) preserved and run before routing
- Created useAlertToast hook with timestamp formatting and code-based deduplication
- Added CSS overrides for 200ms slide-in and 150ms fade-out animations
- 428 total tests passing (13 new, 0 regressions from 415 baseline)

### Change Log
- 2026-04-06: Story 3-4 implementation complete — AlertBanner enhanced, toast notification system via sonner, severity routing in store

### Review Findings
- [x] [Review][Decision] Critical alerts with `autoDismissMs` are auto-dismissed, violating AC #1 — **Fixed:** removed auto-dismiss setTimeout for critical severity; critical banners now persist until resolved
- [x] [Review][Decision] Kill switch detail lookup grabs first mode, may show wrong mode's data — **Fixed:** added `mode` field to Alert type, correlate kill switch detail to specific mode from payload
- [x] [Review][Patch] `lastToast` single-slot drops rapid consecutive alerts — **Fixed:** replaced with `toastQueue` array + `clearToastQueue`; all alerts queued reliably
- [x] [Review][Patch] `next-themes` added as unused dependency — **Fixed:** removed from package.json and lockfile
- [x] [Review][Patch] Toast description omits `resolution` field (FR31 violation) — **Fixed:** resolution now included in toast description
- [x] [Review][Patch] Warning dismiss button in AlertBanner is dead code — **Fixed:** removed warning dismiss button and warning styling from AlertBanner (only critical alerts reach it)
- [x] [Review][Patch] Critical alert setTimeout auto-dismiss timer never cleaned up — **Fixed:** removed entirely (critical alerts no longer auto-dismiss)
- [x] [Review][Patch] `lossAmount / 1e6` magic number — **Fixed:** extracted to `USDC_DECIMALS` named constant
- [x] [Review][Patch] Warning toasts with `duration: Infinity` have no explicit dismiss button — **Fixed:** added `cancel` button option to warning toasts for explicit dismissal
- [x] [Review][Patch] Kill switch mode extraction regex fragility — **Fixed:** reuse validated `alertMode` from payload, validate regex-extracted mode against VALID_MODES set

### File List
- `src/client/components/ui/sonner.tsx` — New: shadcn/ui Toaster wrapper, dark theme, ValBot color tokens
- `src/client/components/alert-banner.tsx` — Modified: AlertTriangle icon, expandable details, kill switch detail from store
- `src/client/store/index.ts` — Modified: lastToast state, clearLastToast action, severity-based routing in ALERT_TRIGGERED handler
- `src/client/hooks/use-alert-toast.ts` — New: Hook subscribing to lastToast, fires sonner toast with deduplication
- `src/client/App.tsx` — Modified: Toaster mount, useAlertToast hook, bannerAlerts filter critical-only
- `src/client/index.css` — Modified: Sonner animation CSS overrides
- `src/client/components/alert-banner.test.tsx` — Modified: Updated for expandable details, added icon/toggle/kill-switch tests
- `src/client/store/index.test.ts` — Modified: Updated routing tests, added severity routing test suite
- `src/client/app.test.tsx` — Modified: Added Toaster mount and critical-only banner tests
- `package.json` — Modified: sonner dependency added
- `pnpm-lock.yaml` — Modified: lock file updated
