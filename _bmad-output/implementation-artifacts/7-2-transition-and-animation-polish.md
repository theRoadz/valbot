# Story 7.2: Transition & Animation Polish

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As theRoad,
I want smooth, consistent transitions on all state changes so the dashboard feels responsive and professional,
So that I can perceive state changes clearly without jarring visual jumps.

## Acceptance Criteria

1. **Given** a mode toggle is switched ON, **When** the mode transitions from stopped to running, **Then** the status badge changes from gray "Stopped" → green "Starting..." (displayed for 1-2s while engine starts) → green "Running" with a 200ms ease color transition, **And** the transition between badge states is smooth (no flash or jump).

2. **Given** a mode toggle is switched OFF, **When** the mode transitions from running to stopped, **Then** the status badge shows gray "Stopping..." while positions close → gray "Stopped" with a 200ms ease color transition, **And** the transition between badge states is smooth.

3. **Given** a kill switch is triggered, **When** the mode enters kill-switch state, **Then** the status badge immediately shows red "Kill Switch" with NO intermediate "Stopping..." state — the change is instant (no transition delay).

4. **Given** a position is being closed, **When** the position row is about to be removed from the table, **Then** the row highlights with a yellow background (200ms fade-in) before removal.

5. **Given** a toast notification appears, **When** it enters the screen, **Then** it slides in from the right (200ms ease-out), **And** when dismissed it fades out (150ms).

6. **Given** the FundAllocationBar, **When** allocated funds change (mode start/stop or reallocation), **Then** the remaining balance bar width animates smoothly (200ms ease).

7. **Given** the connection status shows "Reconnecting...", **When** the yellow dot is displayed, **Then** the dot pulses with a CSS animation (not JS-driven interval).

8. **Given** any element with animation or transition, **When** it is rendered, **Then** it uses `will-change: transform` (or `will-change: opacity` where appropriate) for GPU compositing.

9. **Given** any transition in the dashboard, **When** its duration is not explicitly specified in AC above, **Then** it defaults to 200ms ease.

## Tasks / Subtasks

- [x] Task 1: Add `will-change` utilities to all animated elements (AC: #8)
  - [x] Add `will-change-transform` class to: status badge in mode-card, toast container, fund allocation bar, position table rows with closing animation
  - [x] Add `will-change-[opacity]` to: toast fade-out elements, reconnecting dot pulse
  - [x] Add a CSS utility in `index.css` if Tailwind v4 doesn't support `will-change-[opacity]` natively: `.will-change-opacity { will-change: opacity; }`
  - [x] Verify `animate-pulse` on kill-switch badge and reconnecting dot already uses GPU compositing (Tailwind's `animate-pulse` uses `opacity` which benefits from `will-change-opacity`)
  - [x] NOTE: alert-banner expand/collapse uses conditional rendering (no CSS transition) — do NOT add `will-change` to it

- [x] Task 2: Verify mode toggle ON transition — "Starting..." intermediate state (AC: #1)
  - [x] VERIFY-ONLY: `STATUS_BADGE` map already has `"starting"` entry at mode-card.tsx:26 with `{ className: "bg-profit text-white", label: "Starting..." }` — confirmed
  - [x] VERIFY-ONLY: The `handleToggle` function (mode-card.tsx:153-197) already sets optimistic status at line 160-162: `targetStatus = checked ? "starting" : "stopping"` then `setModeStatus(mode, targetStatus)` — confirmed
  - [x] VERIFY-ONLY: Badge element at line 380 already applies `cn("transition-colors duration-200", badge.className)` — confirmed (now conditional)
  - [x] Add `will-change-transform` to the badge for GPU compositing — done
  - [x] Ensure the badge text transitions smoothly — added `min-w-[80px] text-center` to prevent layout shift

- [x] Task 3: Verify mode toggle OFF transition — "Stopping..." intermediate state (AC: #2)
  - [x] VERIFY-ONLY: `STATUS_BADGE` map already has `"stopping"` entry at mode-card.tsx:28 with `{ className: "bg-neutral text-text-muted", label: "Stopping..." }` — confirmed
  - [x] VERIFY-ONLY: `handleToggle` at line 160 already sets `targetStatus = "stopping"` when `checked` is false — confirmed
  - [x] VERIFY-ONLY: WebSocket `MODE_STOPPED` event (store/index.ts:401) sets status to `"stopped"` — confirmed
  - [x] The existing `transition-colors duration-200` from Task 2 handles this transition — no new classes needed
  - [x] Verify kill-switch override: if status is `"kill-switch"`, badge must NOT show "Stopping..." — confirmed (kill-switch priority handled by store)

- [x] Task 4: FIX — Kill switch badge must be instant — NO transition (AC: #3)
  - [x] CURRENT BUG: Badge at line 380 applied `cn("transition-colors duration-200", badge.className)` unconditionally — fixed
  - [x] FIX: Used `transition-none` to override badge.tsx base `transition-colors` when kill-switch (tailwind-merge resolves correctly)
  - [x] Implementation: `cn(badge.className, status === "kill-switch" ? "transition-none" : "transition-colors duration-200", "will-change-transform min-w-[80px] text-center")`
  - [x] The existing `animate-pulse` on kill-switch badge preserved

- [x] Task 5: Verify position closing row highlight animation (AC: #4)
  - [x] VERIFY-ONLY: `positions-table.tsx` line 21 already applies `bg-warning/20 transition-colors duration-200` for closing rows — confirmed
  - [x] VERIFY-ONLY: Store already has a 300ms delay before removing positions — confirmed, sufficient
  - [x] Add `will-change-transform` to closing rows — done

- [x] Task 6: Toast notification slide-in and fade-out (AC: #5)
  - [x] VERIFY-ONLY: Sonner toast timing already configured in `src/client/index.css` — confirmed (200ms enter, 150ms exit, ease-out)
  - [x] VERIFY-ONLY: Sonner component at `sonner.tsx:16` already has `position="top-right"` — confirmed
  - [x] Add `will-change: transform, opacity` to toast container CSS in index.css — done
  - [x] Toast slides in from right (200ms ease-out) and fades out on dismiss (150ms) — verified by existing CSS config

- [x] Task 7: FundAllocationBar smooth animation (AC: #6)
  - [x] Fund allocation bar already has inline `transition: "width 200ms ease, background-color 200ms ease"` — confirmed
  - [x] Verified transition works for allocation changes
  - [x] Add `will-change-transform` class to the allocation bar element — done
  - [x] Bar uses CSS percentage width from state — no initial render jump

- [x] Task 8: Connection status "Reconnecting..." pulse animation (AC: #7)
  - [x] Reconnecting state uses `animate-pulse` on dot — confirmed (CSS-only via Tailwind @keyframes)
  - [x] Added `will-change-[opacity]` to the dot element for GPU compositing — done (Tailwind v4 arbitrary value syntax works)
  - [x] Pulse animation is CSS-only (no JS-driven interval) — confirmed

- [x] Task 9: Ensure consistent 200ms default timing across all transitions (AC: #9)
  - [x] Add `duration-200` to `badge.tsx:7` base `cva` — done
  - [x] Add `duration-200` to `table.tsx:61` TableRow — done
  - [x] Audited and fixed: trade-history-table.tsx (2 pagination buttons), trade-log.tsx (indicator button), switch.tsx (root), scroll-area.tsx (scrollbar)
  - [x] alert-banner.tsx uses `transition-opacity` (not `transition-colors`) — left as-is (different property)
  - [x] mode-card.tsx and positions-table.tsx already had `duration-200` — verified
  - [x] Timing function is `ease` (Tailwind default) — confirmed

- [x] Task 10: Add transition and animation tests (AC: #1-9)
  - [x] mode-card.test.tsx: test badge has `transition-colors` when NOT kill-switch, `transition-none` when IS kill-switch
  - [x] mode-card.test.tsx: test `will-change-transform` on badge, `min-w-[80px]` for layout shift prevention, `will-change-transform` on fund bar
  - [x] positions-table.test.tsx: test closing row has `transition-colors duration-200`, `bg-warning/20`, and `will-change-transform`; non-closing row has no `will-change-transform`
  - [x] top-bar.test.tsx: updated existing reconnecting dot test to also assert `will-change-[opacity]`
  - [x] All 245 client tests pass (238 existing + 7 new), full suite 712 tests pass

## Dev Notes

### What's Already In Place (DO NOT recreate)

Much of the transition infrastructure already exists. This story is primarily about:
1. Ensuring consistency (200ms ease everywhere)
2. Adding GPU compositing hints (`will-change`)
3. Polishing intermediate states (Starting.../Stopping...)
4. Verifying existing animations meet the spec

| Feature | Location | Current State | Action Needed |
|---------|----------|---------------|---------------|
| Badge `transition-colors duration-200` | mode-card.tsx:380 | Exists (unconditional) | **FIX**: Make conditional — exclude for kill-switch |
| Optimistic starting/stopping status | mode-card.tsx:160-162 | Exists in `handleToggle` | Verify-only |
| Fund bar `transition: width 200ms ease` | mode-card.tsx:100-104 (inline style) | Exists | Add `will-change-transform` |
| Position closing `bg-warning/20 transition-colors duration-200` | positions-table.tsx:21 | Exists | Add `will-change-transform` |
| Position closing 300ms delay | store/index.ts:570-577 | Exists (300ms setTimeout) | Verify-only, do NOT add new delay |
| Toast enter/exit timing | index.css:96-103 | Exists (200ms/150ms) | Add `will-change` to toast CSS |
| Toast position `top-right` | sonner.tsx:16 | Exists | Verify-only |
| Reconnecting dot `animate-pulse` | top-bar.tsx:18 | Exists (CSS-only) | Add `will-change-opacity` |
| Kill switch `animate-pulse` | mode-card.tsx:30 | Exists | Preserve, ensure no transition delay |
| `transition-colors` without duration | badge.tsx:7, table.tsx:61 | Missing `duration-200` | **FIX**: Add `duration-200` |
| Top-bar test file | top-bar.test.tsx (18 tests, 216 lines) | Exists, line 54 tests `animate-pulse` | Add `will-change` assertion |

### STATUS_BADGE Map Reference

Actual `STATUS_BADGE` map in `mode-card.tsx` (lines 24-31) — already complete, DO NOT recreate:
```tsx
const STATUS_BADGE: Record<string, { className: string; label: string }> = {
  stopped: { className: "bg-neutral text-white", label: "Stopped" },
  starting: { className: "bg-profit text-white", label: "Starting..." },
  running: { className: "bg-profit text-white", label: "Running" },
  stopping: { className: "bg-neutral text-text-muted", label: "Stopping..." },
  error: { className: "bg-loss text-white", label: "Error" },
  "kill-switch": { className: "bg-loss text-white animate-pulse", label: "Kill Switch" },
};
```
All 6 entries exist. The `starting`/`stopping` entries are already present. Note `stopping` uses `text-text-muted`, not `text-white`.

### Kill Switch Transition Override Pattern

The kill-switch badge must appear INSTANTLY (no 200ms color transition). Current code at mode-card.tsx:380 applies `cn("transition-colors duration-200", badge.className)` unconditionally — this must be changed:
```tsx
// BEFORE (line 380 — broken for kill-switch):
cn("transition-colors duration-200", badge.className)

// AFTER (conditional transition + will-change):
cn(
  badge.className,
  status !== "kill-switch" && "transition-colors duration-200",
  "will-change-transform"
)
```
This is the PRIMARY code change in this story.

### Toast CSS Enhancement

Add to `src/client/index.css` inside the existing Sonner overrides section (near lines 96-103):
```css
[data-sonner-toast] {
  will-change: transform, opacity;
}
```
This is the only CSS addition needed in index.css for this story.

### Actual Code Changes Summary

Most transition infrastructure already exists. Here are the ACTUAL code changes needed (not verify-only):

| Change | File | What to Do |
|--------|------|-----------|
| Kill-switch conditional transition | mode-card.tsx:380 | Make `transition-colors duration-200` conditional on `status !== "kill-switch"` |
| `will-change-transform` on badge | mode-card.tsx:380 | Add to badge classes |
| `will-change-transform` on fund bar | mode-card.tsx:100-104 | Add class to allocation bar div |
| `will-change-transform` on closing rows | positions-table.tsx:21 | Add class to closing row |
| `will-change-opacity` on reconnecting dot | top-bar.tsx:18 | Add class to dot element |
| `will-change: transform, opacity` on toasts | index.css | Add `[data-sonner-toast]` rule |
| `duration-200` on Badge base | badge.tsx:7 | Add to `cva` base string |
| `duration-200` on TableRow base | table.tsx:61 | Add to className |
| Badge min-width | mode-card.tsx | Add `min-w-[80px]` to prevent layout shift on text change |
| Tests | mode-card.test.tsx, positions-table.test.tsx, top-bar.test.tsx | Add transition/will-change assertions |

### What NOT to Implement

- **DO NOT** add `prefers-reduced-motion` media queries — UX spec explicitly excludes for single-user localhost
- **DO NOT** add JS-driven animations (requestAnimationFrame, setInterval) — all animations must be CSS-only
- **DO NOT** modify backend files — this story is frontend-only
- **DO NOT** add new animation libraries (framer-motion, react-spring, etc.) — use Tailwind utilities and CSS only
- **DO NOT** change existing transition durations that already match spec (200ms)
- **DO NOT** add transition effects to data updates (PnL ticking, volume counting) — only state change transitions per ACs

### Tailwind v4 will-change Support

Tailwind v4 includes `will-change-transform`, `will-change-scroll`, `will-change-contents`, and `will-change-auto` utilities. For `will-change: opacity`, use the arbitrary value syntax: `will-change-[opacity]`. If this doesn't work in Tailwind v4, add a custom utility in `index.css`:
```css
.will-change-opacity {
  will-change: opacity;
}
```

### Previous Story Intelligence (Story 7-1)

Key learnings from Story 7-1 that apply here:
- **87 client tests** currently passing across 5 test files — do not break these
- **`outline-ring/50` → `outline-ring`** change was made in index.css — don't revert
- **`--text-muted` changed to `#8b95a5`** — don't revert
- **CardTitle renders as `<h2>`** — don't revert
- **Mode colors use inline `style={{ color }}`** from strategy registry (Story 6-2) — don't override with Tailwind classes
- **ModeCards render dynamically** from `strategies` array — grid uses inline `style={{ gridTemplateColumns }}`
- **`modes` is `Record<ModeType, ModeStoreEntry>`** (dynamic from Story 6-2)
- Click-outside handler was added to pair dropdown — preserve it

### Git Intelligence

Recent commits follow pattern: `feat: <description> with code review fixes (Story X-Y)`. All tests use Vitest `describe/it` pattern. React components use functional style with hooks. Store uses Zustand with `create()`.

### Architecture Compliance

- **Testing:** Vitest 4.1.x, tests co-located with source files, no separate `__tests__/` directory
- **Styling:** Tailwind CSS v4 utilities only + inline styles where needed. No external CSS-in-JS libraries.
- **Components:** `src/client/components/` (flat structure), `src/client/components/ui/` for shadcn primitives
- **State:** Zustand store at `src/client/store/`
- **File naming:** kebab-case for files, PascalCase for components

### Project Structure Notes

- All changes are modifications to existing files — no new files needed
- CSS changes go in `src/client/index.css`
- Component changes are in `src/client/components/` (mode-card.tsx, positions-table.tsx, top-bar.tsx, trade-log.tsx, alert-banner.tsx)
- UI primitive changes in `src/client/components/ui/` (badge.tsx, table.tsx)
- Test changes are co-located with their source files

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Epic 7, Story 7.2]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — Transitions section]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — UX Consistency Patterns, Transition timing]
- [Source: _bmad-output/planning-artifacts/architecture.md — Component Architecture, Testing Standards]
- [Source: _bmad-output/project-context.md — Tailwind v4 + shadcn/ui Rules, Testing Rules]
- [Source: _bmad-output/implementation-artifacts/7-1-accessibility-baseline-audit-and-fixes.md — Previous story learnings]
- [Source: src/client/components/mode-card.tsx — STATUS_BADGE, fund allocation bar, badge transitions]
- [Source: src/client/components/positions-table.tsx — Position closing animation]
- [Source: src/client/components/top-bar.tsx — Reconnecting pulse animation]
- [Source: src/client/index.css — Toast timing overrides, CSS custom properties]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References
- All 245 client tests pass (12 test files)
- Full suite: 712 tests passed across 35 test files, 0 failures

### Completion Notes List
- Task 1: Added `will-change-transform` to mode-card badge, fund allocation bar, closing position rows. Added `will-change-[opacity]` to reconnecting dot. Added `will-change: transform, opacity` to toast CSS. Tailwind v4 arbitrary value syntax `will-change-[opacity]` works natively — no custom CSS utility needed.
- Task 2: Verified all Starting... infrastructure exists (STATUS_BADGE entry, optimistic handleToggle, transition classes). Added `will-change-transform` and `min-w-[80px] text-center` to badge.
- Task 3: Verified all Stopping... infrastructure exists. Kill-switch override confirmed working.
- Task 4: Fixed kill-switch badge transition — used `transition-none` to override badge.tsx base `transition-colors duration-200` via tailwind-merge. Kill switch now appears instantly.
- Task 5: Verified position closing highlight and 300ms store delay. Added `will-change-transform` to closing rows.
- Task 6: Verified toast timing (200ms/150ms) and position. Added `will-change: transform, opacity` CSS rule.
- Task 7: Verified fund bar transition. Added `will-change-transform` class.
- Task 8: Verified CSS-only pulse animation. Added `will-change-[opacity]` to dot.
- Task 9: Added `duration-200` to: badge.tsx base cva, table.tsx TableRow, trade-history-table.tsx (2 pagination buttons), trade-log.tsx indicator button, switch.tsx root, scroll-area.tsx scrollbar. Alert-banner uses `transition-opacity` (different property) — left as-is.
- Task 10: Added 7 new tests: 5 in mode-card.test.tsx (badge transition conditional, transition-none for kill-switch, will-change-transform, min-w-[80px], fund bar will-change), 2 in positions-table.test.tsx (closing row classes, non-closing row no will-change). Updated 1 existing test in top-bar.test.tsx (added will-change assertion).

### Review Findings

- [x] [Review][Decision] Kill-switch `animate-pulse` may contradict AC #3 — dismissed: pulse is intentional UX signal for emergency state, "instant" means no transition delay, not no animation
- [x] [Review][Patch] `will-change-transform` on fund allocation bar but animated property is `width` — fixed: removed mismatched will-change [mode-card.tsx:99]
- [x] [Review][Patch] `will-change-transform` on status badge but animated property is `color` — fixed: removed mismatched will-change [mode-card.tsx:382]
- [x] [Review][Patch] `will-change-[opacity]` applied to ALL connection dots unconditionally — fixed: now conditional on animate-pulse presence [top-bar.tsx:77]
- [x] [Review][Patch] `will-change-transform` on closing position row but animated property is `background-color` — fixed: removed mismatched will-change [positions-table.tsx:21]
- [x] [Review][Patch] Redundant `transition-colors duration-200` on PositionRow — fixed: removed, base TableRow provides these [positions-table.tsx:21]
- [x] [Review][Patch] Toast slide direction was vertical (Sonner default), not horizontal "from right" per AC #5 — fixed: added CSS `translate` override for `[data-x-position="right"]` toasts

### Change Log
- Story 7-2 implementation complete (Date: 2026-04-07)

### File List
- src/client/components/mode-card.tsx (modified — badge transition conditional for kill-switch, will-change-transform, min-w-[80px], fund bar will-change-transform)
- src/client/components/positions-table.tsx (modified — will-change-transform on closing rows)
- src/client/components/top-bar.tsx (modified — will-change-[opacity] on connection dot)
- src/client/index.css (modified — added [data-sonner-toast] will-change rule)
- src/client/components/ui/badge.tsx (modified — added duration-200 to base cva)
- src/client/components/ui/table.tsx (modified — added duration-200 to TableRow)
- src/client/components/ui/switch.tsx (modified — added duration-200 to root)
- src/client/components/ui/scroll-area.tsx (modified — added duration-200 to scrollbar)
- src/client/components/trade-history-table.tsx (modified — added duration-200 to pagination buttons)
- src/client/components/trade-log.tsx (modified — added duration-200 to indicator button)
- src/client/components/mode-card.test.tsx (modified — added 5 transition/animation tests)
- src/client/components/positions-table.test.tsx (modified — added 2 closing row transition tests)
- src/client/components/top-bar.test.tsx (modified — updated reconnecting dot test with will-change assertion)
