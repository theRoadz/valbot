---
stepsCompleted:
  - step-01-validate-prerequisites
  - step-02-design-epics
  - step-03-create-stories
  - step-04-final-validation
status: complete
completedAt: '2026-04-03'
inputDocuments:
  - _bmad-output/planning-artifacts/prd.md
  - _bmad-output/planning-artifacts/architecture.md
  - _bmad-output/planning-artifacts/ux-design-specification.md
---

# ValBot - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for ValBot, decomposing the requirements from the PRD, UX Design if it exists, and Architecture requirements into implementable stories.

## Requirements Inventory

### Functional Requirements

FR1: User can start and stop the trading bot from the dashboard
FR2: User can activate Volume Max mode to execute delta-neutral long/short cycling
FR3: User can activate Profit Hunter mode to execute trades based on Pyth oracle price deviation from 5-minute moving average
FR4: User can activate Arbitrage mode to exploit cross-market price differences
FR5: User can run multiple trading modes simultaneously and independently
FR6: User can stop individual modes without affecting other running modes
FR7: User can select which trading pairs each mode targets
FR8: User can target specific boosted pairs for extra Flames rewards
FR9: User can allocate a specific fund amount to each trading mode from the dashboard
FR10: Each mode trades only within its allocated fund amount
FR11: User can view remaining allocated funds per mode on the dashboard
FR12: System applies stop-loss protection to every opened position
FR13: System auto-closes all positions for a specific mode when that mode's allocated collateral drops by 10% (per-mode kill switch)
FR14: User can view all currently open positions on the dashboard
FR15: System handles failed transactions gracefully without leaving orphaned positions
FR16: User can view total number of trades executed
FR17: User can view total trading volume generated
FR18: User can view current bot status (running/stopped, active modes)
FR19: User can view session PnL
FR20: User can view total profit across all sessions
FR21: User can view complete trade history
FR22: User can view per-mode statistics (trades, volume, PnL) separately
FR23: User can view combined statistics across all modes
FR24: User can view a live trade log streaming trades in real-time
FR25: User can configure slippage percentage from the dashboard
FR26: User can toggle trading modes on/off from the dashboard
FR27: System authenticates using session keys extracted from browser console
FR28: System stores session keys locally in `.env` file
FR29: System detects expired session keys and alerts the user with resolution steps
FR30: System displays clear error messages with details when issues occur
FR31: System provides resolution steps for every error type
FR32: System alerts user when per-mode kill switch is triggered with full details (positions closed, prices, loss amount)
FR33: System handles RPC connection failures with retry logic and dashboard alerts
FR34: System supports a pluggable strategy architecture allowing new trading strategies to be added in the future
FR35: User can view and manage all available trading strategies from the dashboard

### NonFunctional Requirements

NFR1: Trade execution completes within 1 second of signal trigger
NFR2: Dashboard updates real-time via WebSocket (no polling/refresh)
NFR3: Live trade log streams trades as they happen with zero noticeable delay
NFR4: Pyth oracle price feed updates continuously for Profit Hunter mode
NFR5: Bot never leaves orphaned open positions on crash or error
NFR6: Per-mode kill switch triggers independently even if other modes crash
NFR7: Automatic retry on RPC connection failures (max 3 retries before alerting user)
NFR8: All position-opening transactions confirm stop-loss is set before proceeding
NFR9: On unexpected shutdown, bot closes all open positions gracefully
NFR10: Stable connection to FOGOChain public RPC endpoints
NFR11: Reliable Pyth Network oracle price feed for Profit Hunter mode
NFR12: Valiant Perps smart contract interaction for all position management

### Additional Requirements

- Architecture specifies a starter template: Vite + React (react-ts) scaffolded via `pnpm create vite@latest`, with Fastify backend, Tailwind CSS v4 + shadcn/ui, Drizzle ORM + better-sqlite3, Vitest, and ws (native WebSocket). This defines Epic 1 Story 1.
- Database schema: 4 tables (trades, positions, sessions, config) via Drizzle ORM with drizzle-kit migrations
- State management: Zustand single global store updated by WebSocket event handlers
- API pattern: REST (Fastify routes) for user commands + WebSocket for server-pushed real-time events
- Error handling: AppError class with severity/code/message/details/resolution; three severity levels (info, warning, critical) mapped to UX toast/banner treatments
- Graceful shutdown sequence: stop modes → close positions → flush DB buffer → close WebSocket → close DB → exit
- In-memory caching: hot data maps for positions, live stats, fund balances; async-batched SQLite writes for trade history
- Logging: Fastify pino logger, structured JSON in production, pretty-printed in dev
- Project structure: single project (no monorepo), server organized by domain, client organized by type, flat component files
- Blockchain client with RPC retry logic (exponential backoff 1s/2s/4s, max 3 retries)
- WebSocket event catalog: 9 defined events (trade.executed, stats.updated, mode.started, mode.stopped, mode.error, position.opened, position.closed, alert.triggered, connection.status)
- Co-located tests: `*.test.ts` / `*.test.tsx` next to source files, Vitest auto-discovery
- `.env.example` with SESSION_KEY, RPC_URL, PORT=3000

### UX Design Requirements

UX-DR1: Implement dark theme color system with custom design tokens — base backgrounds (#0a0a0f, #12121a, #1a1a26), semantic colors (profit green #22c55e, loss red #ef4444, warning amber #f59e0b, neutral gray #6b7280, accent blue #3b82f6), mode identity colors (Volume Max purple #8b5cf6, Profit Hunter green #22c55e, Arbitrage cyan #06b6d4), and text color hierarchy (primary #f1f5f9, secondary #94a3b8, muted #64748b)
UX-DR2: Implement typography system with dual font stack — Inter (system fallback) for UI text and JetBrains Mono for financial numbers and trade log. Type scale from 12px (badges, log entries) to 24px (stat values) with defined weights per element.
UX-DR3: Implement single-viewport CSS Grid dashboard layout — three zones: top bar (auto height, full width), mode cards row (grid-cols-3, equal thirds), bottom split (3fr positions table + 2fr trade log filling remaining height). Minimum 1280px width, 100vh height, no scroll.
UX-DR4: Build ModeCard component — self-contained card with header (mode name + status badge + toggle switch), 2x2 stats grid (PnL, Trades, Volume, Allocated in monospace), fund allocation bar with remaining balance, inline pair selector, slippage display. Five states: stopped, running, error, kill-switch, starting.
UX-DR5: Build SummaryBar component — top-level bar with ValBot name + connection status indicator (green dot connected, yellow pulsing reconnecting, red disconnected) + horizontal stat groups (Wallet Balance, Total PnL, Session PnL, Total Trades, Total Volume)
UX-DR6: Build TradeLog component — real-time streaming log with ScrollArea, auto-scroll to newest entries, pause-on-hover, resume on scroll-to-bottom. Entry format: `HH:mm:ss [MODE] Action Side Pair Details`. Mode tags color-coded: [VOL] purple, [PRO] green, [ARB] cyan. Max 500 entries in DOM.
UX-DR7: Build PositionsTable component — live-updating table with columns: Mode (colored), Pair, Side (green Long/red Short), Size, Entry, Mark (live), PnL (colored), Stop-Loss. All monospace number columns. Row highlight yellow (200ms) on position close before removal. Empty state: "No open positions"
UX-DR8: Build AlertBanner component — persistent critical alert above entire dashboard for kill-switch and session expiry events. Red (critical, non-dismissable) and amber (warning, dismissable) variants. Includes icon, message, expandable details, and resolution action.
UX-DR9: Build FundAllocationBar component — thin horizontal progress bar showing used/total fund ratio per mode. States: normal (mode color fill), warning (>80% amber), critical (>90% red), empty (gray, "Not allocated"). Label: "$X,XXX / $X,XXX remaining"
UX-DR10: Implement three-tier error feedback system — info (green auto-dismiss toast, 5s), warning (amber persistent toast), critical (red persistent banner above top bar). Toast stacking from top-right, max 3 visible, slide-in 200ms, fade-out 150ms.
UX-DR11: Implement inline control patterns — toggle switch (single-click, no confirmation, optimistic UI with 2s revert), fund allocation input (monospace, right-aligned, $ prefix, numeric-only, read-only when running), pair selector (multi-select dropdown with flame icon for boosted pairs, disabled when running), slippage input (0.1%-5.0%, one decimal)
UX-DR12: Implement financial number display patterns — JetBrains Mono font, always show sign prefix (+$1,247.83 / -$42.10), green positive / red negative / gray zero, comma separators, always 2 decimal places for USD, proper alignment in tables (right-aligned monospace columns)
UX-DR13: Implement status indicator patterns — colored dot (6px) + text label always paired, consistent color mapping everywhere (green=running/profit/connected, red=error/loss/critical, amber=warning/approaching, gray=stopped/inactive/zero). Never use color alone.
UX-DR14: Implement empty state patterns for all components — mode cards show $0.00/0 in muted color with "Not allocated"; positions table shows "No open positions" centered; trade log shows "Waiting for trades..." centered; top bar shows $0.00/0 values, never blank
UX-DR15: Implement transition patterns — mode starting badge "Starting..." (1-2s) → "Running"; mode stopping badge "Stopping..." (while positions close) → "Stopped"; kill switch immediate red badge. All transitions 200ms ease timing. Position close row yellow highlight 200ms fade before removal.
UX-DR16: Implement accessibility baseline — color never sole indicator (use +/- prefix, text labels), semantic HTML (thead/tbody, heading hierarchy, form labels), keyboard navigable (native HTML form elements), blue focus rings (ring-2 ring-blue-500), WCAG AA contrast ratios, minimum 12px font size

### FR Coverage Map

FR1: Epic 2 — Start/stop bot from dashboard
FR2: Epic 2 — Volume Max mode activation
FR3: Epic 4 — Profit Hunter mode activation
FR4: Epic 4 — Arbitrage mode activation
FR5: Epic 4 — Multiple modes simultaneously
FR6: Epic 4 — Stop individual modes independently
FR7: Epic 2 — Per-mode pair selection
FR8: Epic 2 — Boosted pair targeting
FR9: Epic 2 — Per-mode fund allocation
FR10: Epic 2 — Mode trades within allocation
FR11: Epic 2 — View remaining funds per mode
FR12: Epic 2 — Stop-loss on every position
FR13: Epic 3 — Per-mode kill switch (10% drop)
FR14: Epic 2 — View open positions
FR15: Epic 3 — Graceful failed transaction handling
FR16: Epic 2 — View total trades
FR17: Epic 2 — View total volume
FR18: Epic 2 — View bot status
FR19: Epic 2 — View session PnL
FR20: Epic 5 — View total profit across sessions
FR21: Epic 5 — View trade history
FR22: Epic 2 — Per-mode stats
FR23: Epic 5 — Combined stats across modes
FR24: Epic 2 — Live trade log
FR25: Epic 2 — Configure slippage
FR26: Epic 2 — Toggle modes from dashboard
FR27: Epic 1 — Session key authentication
FR28: Epic 1 — Session key storage in .env
FR29: Epic 1 — Expired session key detection
FR30: Epic 3 — Clear error messages
FR31: Epic 3 — Resolution steps for errors
FR32: Epic 3 — Kill switch alert details
FR33: Epic 3 — RPC retry + dashboard alerts
FR34: Epic 6 — Pluggable strategy architecture
FR35: Epic 6 — View/manage strategies

## Epic List

### Epic 1: Project Foundation & First Boot
theRoad can run the bot, see the dashboard open in the browser with an empty state, and confirm the system connects to FOGOChain with a valid session key.
**FRs covered:** FR27, FR28, FR29

### Epic 2: Single-Mode Trading — Volume Max
theRoad can allocate funds to Volume Max, toggle it on, and watch it execute delta-neutral trades with live feedback on the dashboard — including stats, trade log, and open positions with stop-loss protection.
**FRs covered:** FR1, FR2, FR7, FR8, FR9, FR10, FR11, FR12, FR14, FR16, FR17, FR18, FR19, FR22, FR24, FR25, FR26

### Epic 3: Safety Systems — Kill Switch & Graceful Shutdown
theRoad's capital is protected — the per-mode kill switch auto-closes positions when collateral drops 10%, graceful shutdown closes all positions on stop/crash, and every safety event is clearly communicated with full details and resolution steps.
**FRs covered:** FR13, FR15, FR30, FR31, FR32, FR33

### Epic 4: Multi-Mode Operation — Profit Hunter & Arbitrage
theRoad can enable Profit Hunter and Arbitrage modes alongside Volume Max, each with independent fund allocation, pair selection, and stats — all running in parallel without interfering with each other.
**FRs covered:** FR3, FR4, FR5, FR6

### Epic 5: Performance Dashboard & Session History
theRoad can review total profit across all sessions, see combined stats across all modes, and browse complete trade history.
**FRs covered:** FR20, FR21, FR23

### Epic 6: Extensibility — Pluggable Strategy Architecture
New trading strategies can be added by dropping in a new strategy file, and all available strategies can be viewed and managed from the dashboard.
**FRs covered:** FR34, FR35

### Epic 7: Accessibility & UX Polish
The dashboard meets accessibility baseline and all transition/animation patterns are polished for a professional trading experience.
**FRs covered:** None (UX-DR coverage: UX-DR15, UX-DR16)

---

## Epic 1: Project Foundation & First Boot

theRoad can run the bot, see the dashboard open in the browser with an empty state, and confirm the system connects to FOGOChain with a valid session key.

### Story 1.1: Project Scaffolding & Dev Environment

As a developer,
I want the project scaffolded with Vite + React, Fastify backend, Tailwind v4 + shadcn/ui, Drizzle ORM + better-sqlite3, and Vitest configured in a single project,
So that I have a working dev environment where `pnpm dev` runs both frontend and backend with hot reload.

**Acceptance Criteria:**

**Given** a fresh clone of the repository
**When** I run `pnpm install && pnpm dev`
**Then** the Fastify server starts on port 3000 and serves the React app
**And** Vite HMR works for frontend changes
**And** tsx watch reloads the backend on server file changes
**And** the project structure matches the Architecture spec (src/server/, src/client/, src/shared/)
**And** TypeScript strict mode is enabled with path aliases for shared types
**And** `.env.example` exists with SESSION_KEY, RPC_URL, PORT=3000
**And** `.gitignore` excludes .env, node_modules, dist/, and valbot.db

### Story 1.2: Database Schema & Migration Setup

As a developer,
I want the SQLite database with Drizzle ORM schema for trades, positions, sessions, and config tables,
So that the persistence layer is ready for trade and session data storage.

**Acceptance Criteria:**

**Given** the project is scaffolded (Story 1.1)
**When** I run `pnpm drizzle-kit generate` and `pnpm drizzle-kit migrate`
**Then** the SQLite database file is created with all four tables
**And** the `trades` table has columns: id, mode, pair, side, size, price, pnl, fees, timestamp
**And** the `positions` table has columns: id, mode, pair, side, size, entryPrice, stopLoss, timestamp
**And** the `sessions` table has columns: id, startTime, endTime, mode, trades, volume, pnl
**And** the `config` table has columns: key, value
**And** all monetary/financial columns use `integer()` storing smallest-unit values (ADR-001)
**And** the DB connection uses lazy `getDb()` initialization, not module-level side effect (ADR-002)
**And** all column names use camelCase per Architecture naming conventions
**And** Drizzle schema TypeScript types are exported from src/server/db/schema.ts

### Story 1.3: Dark Theme Design System & Dashboard Layout Shell

As theRoad,
I want the dashboard to load with a dark theme, proper typography, and the three-zone grid layout showing empty states,
So that when I open the browser I see a professional trading dashboard ready for content.

**Acceptance Criteria:**

**Given** the bot is running and I open the dashboard in a browser
**When** the page loads
**Then** the dark theme is applied with base background #0a0a0f and surface #12121a
**And** semantic color tokens are configured (profit green, loss red, warning amber, neutral gray, accent blue)
**And** Inter font is used for UI text and JetBrains Mono for number placeholders
**And** the layout uses CSS Grid with three zones: top bar, mode cards row (3 equal columns), bottom split (3fr + 2fr)
**And** the dashboard fills 100vh with no vertical scroll
**And** shadcn/ui Card, Badge, Switch, Table, ScrollArea, Alert, Input, Select components are installed
**And** all zones show placeholder/empty state content

### Story 1.4: SummaryBar & Connection Status

As theRoad,
I want the top bar to show the ValBot name, connection status, and summary stat placeholders (wallet balance, PnL, trades, volume),
So that I can see at a glance whether the system is connected and ready.

**Acceptance Criteria:**

**Given** the dashboard layout shell exists (Story 1.3)
**When** the dashboard loads
**Then** the SummaryBar shows "ValBot" with a connection status indicator
**And** connection status shows green dot + "Connected" when WebSocket is active
**And** connection status shows yellow pulsing dot + "Reconnecting..." during reconnection
**And** connection status shows red dot + "Disconnected" when WebSocket is down
**And** stat groups display: Wallet Balance, Total PnL, Session PnL, Total Trades, Total Volume — all showing $0.00 / 0 in muted color
**And** financial numbers use JetBrains Mono font
**And** the WebSocket hook (use-websocket.ts) connects to the backend and dispatches to Zustand store

### Story 1.5: FOGOChain Connection & Session Key Authentication

As theRoad,
I want the bot to authenticate using my session key from `.env` and connect to FOGOChain RPC,
So that I can confirm my wallet is connected and see my balance on the dashboard.

**Acceptance Criteria:**

**Given** a valid SESSION_KEY and RPC_URL are set in `.env`
**When** the bot starts
**Then** the blockchain client connects to FOGOChain RPC
**And** the session key is loaded from `.env` via dotenv
**And** the wallet balance is fetched and displayed in the SummaryBar
**And** connection.status WebSocket event broadcasts the connected state
**And** the dashboard shows green "Connected" status

**Given** the SESSION_KEY in `.env` is expired or invalid
**When** the bot attempts to authenticate
**Then** the system detects the invalid key
**And** an alert.triggered WebSocket event is broadcast with severity "critical"
**And** the dashboard shows the message: "Session key expired — re-extract from browser console and update .env"
**And** the resolution steps are displayed to the user

**Given** the RPC_URL is unreachable
**When** the bot attempts to connect
**Then** the system retries with exponential backoff (1s, 2s, 4s) up to 3 times
**And** if all retries fail, an alert is broadcast with severity "critical" and resolution steps

---

## Epic 2: Single-Mode Trading — Volume Max

theRoad can allocate funds to Volume Max, toggle it on, and watch it execute delta-neutral trades with live feedback on the dashboard — including stats, trade log, and open positions with stop-loss protection.

### Story 2.1: Shared Types, WebSocket Event System & REST API Skeleton

As a developer,
I want shared TypeScript types for trades, positions, mode status, and alerts, plus the WebSocket broadcaster and REST API route stubs,
So that the communication layer between trading engine and dashboard is defined and ready.

**Acceptance Criteria:**

**Given** the project from Epic 1
**When** I inspect the shared types
**Then** src/shared/types.ts defines: Trade, Position, ModeConfig, ModeStats, Alert, ModeType, TradeSide, ModeStatus
**And** src/shared/events.ts defines WebSocket event name constants and payload types for all 9 events (trade.executed, stats.updated, mode.started, mode.stopped, mode.error, position.opened, position.closed, alert.triggered, connection.status)
**And** src/server/ws/broadcaster.ts creates the WebSocket server on Fastify upgrade, manages client connections, and exposes a typed `broadcast(event, data)` function
**And** src/server/api/mode.ts stubs POST /api/mode/:mode/start, POST /api/mode/:mode/stop, PUT /api/mode/:mode/config
**And** src/server/api/status.ts stubs GET /api/status returning current bot state
**And** src/server/api/trades.ts stubs GET /api/trades returning paginated trade history
**And** src/server/lib/errors.ts defines the AppError class with severity, code, message, details, resolution fields
**And** all API error responses use the `{ error: { severity, code, message, details, resolution } }` format

### Story 2.2: Fund Allocator & Position Manager Core

As a developer,
I want the fund allocator to track per-mode fund isolation and the position manager to handle opening/closing positions with stop-loss enforcement,
So that the trading engine has its safety and fund management foundation.

**Acceptance Criteria:**

**Given** the shared types and API skeleton exist (Story 2.1)
**When** a mode requests to open a position
**Then** the fund allocator checks the mode has sufficient remaining allocation before allowing the trade
**And** the fund allocator prevents cross-mode fund access — each mode can only use its own allocated funds
**And** the fund allocator tracks remaining balance per mode in memory, updated on every position open/close
**And** the position manager opens positions through src/server/blockchain/contracts.ts interface
**And** every position-opening transaction confirms stop-loss is set before proceeding (NFR8)
**And** the position manager tracks all open positions in memory and syncs to the positions DB table
**And** the position manager can close positions and updates fund allocator on close
**And** failed transactions do not leave orphaned positions — if open succeeds but stop-loss fails, position is immediately closed

### Story 2.3: Mode Runner & Volume Max Strategy

As theRoad,
I want the Volume Max trading strategy to execute delta-neutral long/short cycling for Flames rewards,
So that I can farm Flames by generating trading volume automatically.

**Acceptance Criteria:**

**Given** the fund allocator and position manager exist (Story 2.2)
**When** the Volume Max mode is started via API
**Then** the mode-runner base class manages the execution loop lifecycle (start, stop, iteration)
**And** the Volume Max strategy opens paired long/short positions to maintain delta neutrality
**And** positions cycle — close existing and open new at configured intervals
**And** only the trading pairs selected for this mode are used
**And** boosted pairs are supported when configured (FR8)
**And** the strategy respects the mode's fund allocation limit
**And** the strategy emits trade.executed, position.opened, position.closed, stats.updated, mode.started, and mode.stopped WebSocket events via the broadcaster
**And** stopping the mode closes all its open positions before emitting mode.stopped
**And** the strategy implements the pluggable interface defined by mode-runner.ts (FR34 foundation)

### Story 2.4: ModeCard Component with Controls

As theRoad,
I want the ModeCard component on the dashboard so I can see Volume Max status, allocate funds, select pairs, configure slippage, and toggle the mode on/off,
So that I can control and monitor the trading mode from a single card.

**Acceptance Criteria:**

**Given** the dashboard layout from Epic 1 with three card slots
**When** the dashboard renders
**Then** a ModeCard for Volume Max displays with: mode name (purple accent), status badge, toggle switch, 2x2 stats grid (PnL, Trades, Volume, Allocated), fund allocation bar, pair selector, and slippage input
**And** the toggle switch activates/deactivates the mode via POST /api/mode/volume-max/start and /stop
**And** the toggle uses optimistic UI — badge changes immediately, reverts after 2s if server rejects
**And** the fund allocation input is monospace, right-aligned, $ prefix, numeric-only, and read-only when mode is running
**And** the pair selector is a multi-select dropdown showing available pairs, with flame icon on boosted pairs, disabled when running
**And** the slippage input accepts 0.1%-5.0% with one decimal place
**And** the status badge shows: gray "Stopped" (off), green "Starting..." → "Running" (on), with 200ms transition
**And** the stats grid shows $0.00 / 0 in muted color when stopped (empty state)
**And** the FundAllocationBar shows remaining/total ratio with mode purple fill, amber at >80%, red at >90%, gray "Not allocated" when empty
**And** Profit Hunter and Arbitrage ModeCards render in stopped state with identical structure (different accent colors: green, cyan)

### Story 2.5: Zustand Store & Real-Time Dashboard Updates

As theRoad,
I want the dashboard to update in real-time as Volume Max trades,
So that I see live stats, PnL, trade counts, and volume updating on the ModeCard and SummaryBar without refreshing.

**Acceptance Criteria:**

**Given** the WebSocket hook from Story 1.4 and the Zustand store
**When** Volume Max is running and executing trades
**Then** the Zustand store shape matches Architecture spec: modes (per-mode status/stats/config), positions[], trades[], alerts[], connection state, and actions
**And** WebSocket onmessage handler dispatches events directly to store actions
**And** stats.updated events update the Volume Max ModeCard stats (PnL, trades, volume, allocated, remaining) in real-time
**And** mode.started and mode.stopped events update the mode status badge
**And** connection.status events update the SummaryBar connection indicator and wallet balance
**And** the SummaryBar total stats (Total PnL, Session PnL, Total Trades, Total Volume) aggregate from all mode stats
**And** components subscribe to store slices via selectors — never the whole store
**And** financial numbers display with JetBrains Mono, +/- prefix, green/red/gray coloring, comma separators, 2 decimal places (UX-DR12)
**And** GET /api/status populates the initial store state on dashboard load before WebSocket takes over

### Story 2.6: Live Trade Log

As theRoad,
I want a live streaming trade log on the dashboard showing every trade as it happens,
So that I can see the bot is alive and verify what it's doing in real-time.

**Acceptance Criteria:**

**Given** the bottom-right panel of the dashboard layout
**When** Volume Max is executing trades
**Then** the TradeLog component renders inside a ScrollArea filling the available height
**And** each entry shows: timestamp (HH:mm:ss, 24hr, muted), mode tag ([VOL] in purple), action, side, pair, and details
**And** trade.executed WebSocket events append entries to the log in real-time
**And** position close entries include inline PnL: "Closed Long SOL-PERP +$14.20"
**And** the log auto-scrolls to the newest entry
**And** auto-scroll pauses when the user hovers or manually scrolls up
**And** a "New trades below" indicator appears when paused with new entries
**And** auto-scroll resumes when the user scrolls to bottom or moves mouse away
**And** maximum 500 entries are retained in DOM; older entries are garbage collected
**And** when no trades exist, "Waiting for trades..." placeholder shows centered in muted text
**And** all text uses JetBrains Mono font

### Story 2.7: Open Positions Table

As theRoad,
I want to see all currently open positions in a live-updating table,
So that I can monitor my exposure and verify stop-losses are set.

**Acceptance Criteria:**

**Given** the bottom-left panel of the dashboard layout
**When** Volume Max has open positions
**Then** the PositionsTable renders with columns: Mode (purple "VOL"), Pair, Side (green "Long" / red "Short"), Size, Entry, Mark (live-updating), PnL (colored), Stop-Loss
**And** all number columns are right-aligned JetBrains Mono
**And** PnL shows +/- prefix with green positive, red negative, gray zero
**And** position.opened WebSocket events add rows to the table
**And** position.closed WebSocket events trigger a yellow highlight (200ms fade) on the row before removal
**And** mark price and PnL update in real-time via stats or position update events
**And** the table uses semantic HTML (thead/tbody) with proper structure
**And** when no positions exist, "No open positions" shows centered in muted text
**And** row hover shows subtle background elevation

---

## Epic 3: Safety Systems — Kill Switch & Graceful Shutdown

theRoad's capital is protected — the per-mode kill switch auto-closes positions when collateral drops 10%, graceful shutdown closes all positions on stop/crash, and every safety event is clearly communicated with full details and resolution steps.

### Story 3.1: Per-Mode Kill Switch

As theRoad,
I want the system to automatically close all positions for a specific mode when that mode's allocated collateral drops by 10%,
So that my losses are capped and other modes continue running unaffected.

**Acceptance Criteria:**

**Given** a trading mode is running with allocated funds
**When** the mode's remaining collateral drops to 90% or less of its original allocation
**Then** the kill switch triggers for that mode only
**And** all open positions for that mode are closed immediately
**And** the mode stops trading and its status transitions to "Kill Switch"
**And** other running modes continue operating unaffected (NFR6)
**And** an alert.triggered WebSocket event is broadcast with severity "critical"
**And** the alert payload includes: which positions were closed, at what prices, and the total loss amount (FR32)
**And** the ModeCard badge changes to red "Kill Switch" immediately
**And** the kill switch details (positions closed, prices, loss) are visible on the ModeCard
**And** the trade log shows the closing trades from the kill switch event
**And** the fund allocator marks the mode as killed, preventing re-enable until user re-allocates

### Story 3.2: Graceful Shutdown & Crash Recovery

As theRoad,
I want the bot to close all open positions gracefully on stop or unexpected shutdown, and detect orphaned positions on restart,
So that I never have unmonitored open positions with real money at risk.

**Acceptance Criteria:**

**Given** the bot is running with open positions across one or more modes
**When** a SIGINT or SIGTERM signal is received
**Then** all trading modes stop accepting new trades immediately
**And** all open positions are closed per mode in sequence
**And** if a position close fails, the on-chain stop-loss serves as safety net
**And** the in-memory trade buffer is flushed to SQLite
**And** WebSocket connections are closed
**And** the database connection is closed
**And** the process exits cleanly

**Given** the bot starts and the positions table contains entries from a previous session
**When** the bot initializes
**Then** the system detects these as potentially orphaned positions
**And** the system attempts to verify their on-chain status
**And** any confirmed open positions are closed
**And** the user is alerted about recovered positions with details

### Story 3.3: RPC Connection Resilience

As theRoad,
I want the bot to retry RPC connection failures automatically and alert me when retries are exhausted,
So that temporary network issues don't require my intervention but persistent failures get my attention.

**Acceptance Criteria:**

**Given** the bot is connected to FOGOChain RPC
**When** an RPC call fails
**Then** the system retries with exponential backoff: 1s, 2s, 4s (max 3 retries)
**And** during retries, a warning toast appears on the dashboard: "RPC connection lost — retrying (1/3)..."
**And** if a retry succeeds, the toast updates to green "Reconnected" and auto-dismisses after 5s
**And** if all 3 retries fail, the alert escalates to a persistent critical banner: "RPC connection failed after 3 retries — check network"
**And** trading modes pause during RPC failure (no new trades attempted)
**And** existing positions remain with their on-chain stop-losses active
**And** when RPC reconnects, modes resume trading automatically

### Story 3.4: AlertBanner & Toast Notification System

As theRoad,
I want critical errors to show as persistent banners and non-critical alerts as toast notifications with severity-appropriate styling,
So that I can immediately see what's wrong and know exactly what to do about it.

**Acceptance Criteria:**

**Given** the dashboard is loaded
**When** a critical alert.triggered event is received (kill switch, session expired, RPC failed after retries)
**Then** a red AlertBanner renders above the entire dashboard (above the SummaryBar)
**And** the banner includes: warning icon, primary message, expandable details section, and resolution instruction
**And** critical banners cannot be dismissed until the underlying issue is resolved
**And** kill switch banners show expandable details: positions closed, closing prices, total loss amount

**Given** the dashboard is loaded
**When** a warning alert.triggered event is received (RPC retry in progress, approaching kill-switch threshold)
**Then** an amber persistent toast appears in the top-right corner
**And** the toast includes: severity icon, message, timestamp, and dismiss button

**Given** the dashboard is loaded
**When** an info alert is received (reconnection success, trade confirmation)
**Then** a green toast appears in the top-right corner and auto-dismisses after 5 seconds

**And** toasts stack vertically from top-right, maximum 3 visible, older toasts collapse
**And** toasts slide in from right (200ms ease-out) and fade out on dismiss (150ms)
**And** every error displayed includes a resolution path — never a dead end (FR31)

### Story 3.5: Error Handling Framework & Transaction Safety

As theRoad,
I want every error in the system to have a clear message, details, and resolution steps, and failed transactions to never leave orphaned positions,
So that I always know what went wrong and what to do, and my capital is never at risk from half-completed trades.

**Acceptance Criteria:**

**Given** any error occurs in the trading engine
**When** the error is caught
**Then** it is wrapped in an AppError with severity, code, message, details, and resolution fields
**And** the error is logged via pino at the appropriate level
**And** if user-facing, the error is broadcast via WebSocket alert.triggered event
**And** the dashboard renders the error according to its severity tier (info/warning/critical)

**Given** a position-opening transaction succeeds but the stop-loss transaction fails
**When** the system detects the inconsistency
**Then** the position is immediately closed to prevent an unprotected position
**And** the failed transaction is logged with full details
**And** the user is alerted with the error details and resolution steps

**Given** a position-closing transaction fails
**When** the system detects the failure
**Then** the system retries the close operation
**And** if retries fail, the on-chain stop-loss is relied upon as safety net
**And** the user is alerted that a position close failed with the position details and that stop-loss is active

---

## Epic 4: Multi-Mode Operation — Profit Hunter & Arbitrage

theRoad can enable Profit Hunter and Arbitrage modes alongside Volume Max, each with independent fund allocation, pair selection, and stats — all running in parallel without interfering with each other.

### Story 4.1: Pyth Oracle Client & Price Feed

As a developer,
I want a reliable Pyth Network oracle client that streams continuous price feeds,
So that the Profit Hunter strategy has real-time price data to trade against.

**Acceptance Criteria:**

**Given** the blockchain client layer from Epic 1
**When** the Pyth oracle client is initialized
**Then** src/server/blockchain/oracle.ts connects to the Pyth Network price feed via WebSocket subscription
**And** price updates stream continuously for all configured trading pairs
**And** the client maintains a 5-minute moving average for each subscribed pair
**And** price data is available to the trading engine via a typed interface: `getPrice(pair)` and `getMovingAverage(pair)`
**And** if the Pyth WebSocket disconnects, it reconnects with exponential backoff (same pattern as RPC retry)
**And** if the feed is unavailable, Profit Hunter mode is prevented from starting and an alert is broadcast

### Story 4.2: Profit Hunter Strategy

As theRoad,
I want to activate Profit Hunter mode to trade based on Pyth oracle price deviation from the 5-minute moving average,
So that I can capture mean-reversion profits when prices diverge from the short-term average.

**Acceptance Criteria:**

**Given** the mode-runner base class and position manager from Epic 2
**When** Profit Hunter mode is started via the dashboard
**Then** the strategy subscribes to Pyth oracle price feeds for its configured pairs
**And** when the current price deviates from the 5-minute moving average beyond a threshold, the strategy opens a position in the mean-reversion direction
**And** positions are opened with stop-loss protection (NFR8)
**And** positions are closed when price reverts toward the moving average
**And** the strategy respects its own fund allocation — never exceeds its budget
**And** all trades emit trade.executed, position.opened, position.closed, and stats.updated WebSocket events
**And** the ModeCard badge transitions to green "Running" and stats update in real-time
**And** trade log entries are tagged [PRO] in green
**And** stopping the mode closes all its open positions before emitting mode.stopped
**And** Profit Hunter can run simultaneously with Volume Max without interference (FR5)

### Story 4.3: Arbitrage Strategy

As theRoad,
I want to activate Arbitrage mode to exploit cross-market price differences,
So that I can profit from price discrepancies between markets.

**Acceptance Criteria:**

**Given** the mode-runner base class and position manager from Epic 2
**When** Arbitrage mode is started via the dashboard
**Then** the strategy monitors price differences across configured markets/pairs
**And** when a profitable spread is detected (after accounting for fees and slippage), positions are opened to capture the difference
**And** positions are opened with stop-loss protection (NFR8)
**And** positions are closed when the spread converges or a target profit is reached
**And** the strategy respects its own fund allocation — never exceeds its budget
**And** all trades emit trade.executed, position.opened, position.closed, and stats.updated WebSocket events
**And** the ModeCard badge transitions to green "Running" and stats update in real-time
**And** trade log entries are tagged [ARB] in cyan
**And** stopping the mode closes all its open positions before emitting mode.stopped
**And** Arbitrage can run simultaneously with Volume Max and Profit Hunter without interference (FR5)

### Story 4.4: Parallel Mode Execution & Independent Control

As theRoad,
I want to run all three modes simultaneously with independent start/stop control,
So that I can stack strategies based on market conditions without any mode interfering with another.

**Acceptance Criteria:**

**Given** Volume Max is running
**When** I allocate funds to Profit Hunter and toggle it on from its ModeCard
**Then** Profit Hunter starts trading independently alongside Volume Max
**And** both modes show green "Running" badges simultaneously
**And** both modes update their own stats independently on their ModeCards
**And** the trade log shows entries from both modes with distinct color tags ([VOL] purple, [PRO] green)
**And** the SummaryBar totals aggregate stats from both active modes

**Given** two or more modes are running
**When** I toggle one mode off
**Then** only that mode stops and closes its positions
**And** other running modes continue trading unaffected (FR6)
**And** the stopped mode's ModeCard shows "Stopping..." then "Stopped" with final stats
**And** the SummaryBar totals update to reflect only the remaining active modes

**Given** all three modes are running
**When** I view the dashboard
**Then** all three ModeCards show green "Running" with independent stats
**And** the trade log shows [VOL] purple, [PRO] green, and [ARB] cyan entries interleaved
**And** the PositionsTable shows positions from all modes, each tagged with its mode color
**And** the fund allocator enforces that the total allocation across all modes does not exceed the wallet balance

---

## Epic 5: Performance Dashboard & Session History

theRoad can review total profit across all sessions, see combined stats across all modes, and browse complete trade history.

### Story 5.1: Session Persistence & Cross-Session Profit Tracking

As theRoad,
I want the bot to persist session data and track total profit across all sessions,
So that I can see my cumulative performance over time, not just the current session.

**Acceptance Criteria:**

**Given** the bot starts a new trading session
**When** any mode begins trading
**Then** a new session record is created in the sessions table with startTime and mode

**Given** a trading session is active
**When** trades execute
**Then** the session record is updated with running totals: trade count, volume, and PnL

**Given** the bot shuts down (gracefully or via kill switch)
**When** the shutdown completes
**Then** the session record is finalized with endTime and final stats
**And** the in-memory trade buffer is flushed to the trades table

**Given** the bot starts and previous sessions exist in the database
**When** the dashboard loads
**Then** Total Profit in the SummaryBar aggregates PnL from all historical sessions plus the current session (FR20)
**And** Session PnL in the SummaryBar shows only the current session's PnL
**And** GET /api/status returns both totalProfit (all-time) and sessionPnl (current)

### Story 5.2: Trade History View

As theRoad,
I want to browse my complete trade history with pagination,
So that I can review past trades, verify execution, and analyze performance.

**Acceptance Criteria:**

**Given** trades have been recorded in the database
**When** I view the trade history on the dashboard
**Then** GET /api/trades returns paginated results in `{ trades: [...], total: number }` format
**And** trades are displayed in reverse chronological order (newest first)
**And** each trade shows: timestamp, mode (colored tag), pair, side (green Long / red Short), size, price, PnL (colored with +/- prefix), and fees
**And** all number columns use JetBrains Mono, right-aligned
**And** the table reuses the same styling patterns as the PositionsTable (row hover, semantic HTML, empty state)
**And** pagination controls allow navigating through historical trades
**And** when no trade history exists, "No trade history" shows centered in muted text

### Story 5.3: Combined Cross-Mode Statistics

As theRoad,
I want to see combined statistics aggregated across all active and historical modes,
So that I get a complete picture of overall bot performance at a glance.

**Acceptance Criteria:**

**Given** multiple modes have been active (currently or historically)
**When** I view the SummaryBar
**Then** Total PnL shows the sum of PnL across all modes and all sessions
**And** Session PnL shows the sum of current-session PnL across all active modes
**And** Total Trades shows the count of all trades across all modes
**And** Total Volume shows the sum of volume across all modes
**And** these combined stats update in real-time as any mode executes trades

**Given** the dashboard loads fresh (initial page load or reconnect)
**When** GET /api/status returns
**Then** the response includes combined stats calculated from all mode stats plus historical session data
**And** the Zustand store populates both per-mode stats (on ModeCards) and combined stats (on SummaryBar)
**And** subsequent WebSocket stats.updated events keep both per-mode and combined stats in sync

---

## Epic 6: Extensibility — Pluggable Strategy Architecture

New trading strategies can be added by dropping in a new strategy file, and all available strategies can be viewed and managed from the dashboard.

### Story 6.1: Strategy Plugin Interface & Registration

As a developer,
I want a clearly defined strategy interface and automatic registration system,
So that adding a new trading strategy requires only creating a new file in the strategies folder.

**Acceptance Criteria:**

**Given** the mode-runner base class from Epic 2
**When** a developer wants to add a new strategy
**Then** the mode-runner.ts base class defines a clear interface: `name`, `description`, `defaultConfig`, `onStart()`, `onStop()`, `onIteration()`, and lifecycle hooks
**And** a strategy registry in the engine discovers and registers all strategy files in src/server/engine/strategies/
**And** the three existing strategies (Volume Max, Profit Hunter, Arbitrage) conform to this interface
**And** adding a new strategy file that implements the interface automatically makes it available to the system
**And** the registry exposes a typed function `getAvailableStrategies()` returning name, description, and status for each
**And** GET /api/status includes the list of registered strategies in its response

### Story 6.2: Strategy Management on Dashboard

As theRoad,
I want to see all available trading strategies on the dashboard and have their ModeCards render dynamically,
So that when new strategies are added, they appear automatically without dashboard code changes.

**Acceptance Criteria:**

**Given** the strategy registry has registered strategies
**When** the dashboard loads
**Then** the mode cards row renders a ModeCard for each registered strategy (not hardcoded to three)
**And** each strategy's ModeCard shows its name, description, status, and controls
**And** the grid layout adapts: `repeat(N, 1fr)` columns where N is the number of strategies (min 1, max accommodated by the layout)
**And** new strategies added to the backend appear on the dashboard after a restart without frontend changes
**And** each strategy's mode identity color is configurable as part of the strategy interface
**And** the SummaryBar aggregates stats across all registered and active strategies dynamically

---

## Epic 7: Accessibility & UX Polish

The dashboard meets accessibility baseline and all transition/animation patterns are polished for a professional trading experience.

### Story 7.1: Accessibility Baseline Audit & Fixes

As theRoad,
I want the dashboard to be fully keyboard navigable with proper semantic HTML, focus indicators, and non-color-only indicators,
So that the interface is robust, professional, and usable without relying solely on color cues.

**Acceptance Criteria:**

**Given** the complete dashboard from Epics 1-6
**When** I navigate using keyboard only (Tab, Shift+Tab, Enter, Space, Escape)
**Then** all interactive elements (toggle switches, fund inputs, pair selectors, slippage inputs, toast dismiss buttons) are reachable and operable via keyboard
**And** every focused element shows a blue focus ring (ring-2 ring-blue-500)
**And** focus order follows visual layout: SummaryBar → ModeCards left to right → bottom panels

**Given** the dashboard renders
**When** I inspect the HTML structure
**Then** the SummaryBar uses `<header>` semantic element
**And** the main content area uses `<main>`
**And** all tables use proper `<thead>` and `<tbody>` structure
**And** all form inputs have associated labels (via aria-label or visible label)
**And** heading hierarchy is correct (h1 → h2 → h3, no skipped levels)

**Given** PnL values, status badges, and side indicators are displayed
**When** I inspect them
**Then** PnL always includes +/- sign prefix alongside green/red coloring
**And** status badges always pair a colored dot with a text label (Running, Stopped, Error, Kill Switch)
**And** trade side always shows "Long"/"Short" text alongside color
**And** no information is conveyed by color alone anywhere in the dashboard

**Given** any text element in the dashboard
**When** I measure its contrast ratio against its background
**Then** all text meets WCAG AA minimum: 4.5:1 for normal text, 3:1 for large text (18px+ or 14px+ bold)
**And** no text renders below 12px

### Story 7.2: Transition & Animation Polish

As theRoad,
I want smooth, consistent transitions on all state changes so the dashboard feels responsive and professional,
So that I can perceive state changes clearly without jarring visual jumps.

**Acceptance Criteria:**

**Given** a mode is toggled on
**When** the badge transitions
**Then** it animates from gray "Stopped" → green "Starting..." (1-2s) → green "Running" with 200ms ease timing

**Given** a mode is toggled off
**When** the mode stops
**Then** the badge shows "Stopping..." (gray) while positions close, then transitions to "Stopped" with 200ms ease timing

**Given** a kill switch triggers
**When** the mode enters kill-switch state
**Then** the badge transitions immediately to red "Kill Switch" — no intermediate state, urgency is instant

**Given** a position is closing
**When** the position row is about to be removed from the PositionsTable
**Then** the row highlights yellow (200ms fade) before removal

**Given** a toast notification appears or dismisses
**When** the animation plays
**Then** toasts slide in from the right (200ms ease-out) and fade out on dismiss (150ms)

**Given** the FundAllocationBar updates
**When** the remaining balance changes
**Then** the bar fill width animates smoothly (200ms ease) rather than jumping

**Given** the connection status changes
**When** transitioning to "Reconnecting..."
**Then** the yellow dot pulses with a CSS animation (not JS-driven)

**And** all animated elements use `will-change: transform` for GPU compositing where CSS transitions are applied
**And** all transition durations are consistently 200ms ease unless specified otherwise
