---
stepsCompleted:
  - step-01-init
  - step-02-discovery
  - step-02b-vision
  - step-02c-executive-summary
  - step-03-success
  - step-04-journeys
  - step-05-domain
  - step-06-innovation
  - step-07-project-type
  - step-08-scoping
  - step-09-functional
  - step-10-nonfunctional
  - step-11-polish
inputDocuments:
  - D:\dev\2026\ValBot\idea.md
workflowType: prd
documentCounts:
  briefs: 0
  research: 0
  brainstorming: 0
  projectDocs: 0
  userProvided: 1
classification:
  projectType: blockchain_web3
  domain: general
  complexity: low
  projectContext: greenfield
---

# Product Requirements Document - ValBot

**Author:** theRoad
**Date:** 2026-04-03

## Executive Summary

ValBot is a personal multi-mode trading bot for Valiant Perps on FOGOChain. It automates three distinct trading strategies — volume farming for Flames rewards, oracle-driven profit hunting, and cross-market arbitrage — switchable on demand. Built with Node.js/TypeScript and SVM-Web3 libraries, it replaces manual trading execution with a single tool that handles whichever strategy fits the moment.

ValBot is not a platform. It consolidates three trading strategies into one bot with simple mode toggling: farm Flames when chasing leaderboard rewards, hunt profits when the market presents opportunities, or run arbitrage to exploit price differences. The core value is simplicity — eliminating repetitive manual execution across multiple strategies through a unified interface built for one user.

**Classification:** Blockchain/Web3 | General domain (personal tool) | Low complexity | Greenfield

## Success Criteria

### User Success

- Bot executes trades without manual intervention across all three modes
- Capital preserved — no unexpected losses or liquidations
- Mode switching is simple and immediate via the dashboard
- Real-time visibility into trades, volumes, status, session PnL, total profit, open positions, and trade history

### Business Success

- Delta-neutral or net-positive PnL after fees across all modes
- Consistent Flames reward generation when running Volume Max mode
- Arbitrage mode captures price differences profitably after transaction costs

### Technical Success

- Reliable connection to FOGOChain with sub-second trade execution
- Session key authentication works seamlessly via browser extraction
- Bot recovers gracefully from network issues or failed transactions without leaving open positions

### Measurable Outcomes

- Zero liquidation events
- Net PnL >= 0 after fees (delta-neutral minimum, profit-positive target)
- Bot uptime during active trading sessions > 99%
- All open positions have stop-loss protection active at all times

## Product Scope

### MVP (Phase 1)

**MVP Approach:** Problem-solving MVP — all three trading strategies with a functional dashboard from day one. The product isn't useful with partial modes since each serves a different trading goal.

**Must-Have Capabilities:**
- Volume Max mode (delta-neutral cycling for Flames)
- Profit Hunter mode (Pyth oracle-based mean reversion)
- Arbitrage mode (cross-market price difference exploitation)
- All modes run independently in parallel with dedicated fund allocation
- Web dashboard: total trades, volumes, bot status, session PnL, total profit, open positions, trade history, live trade log
- Per-mode fund allocation — each mode trades only within its assigned budget
- Asset/pair selection per mode with boost targeting
- Mode toggling and bot start/stop from dashboard
- Configurable slippage via dashboard
- Session key authentication via browser extraction
- Per-mode kill switch — auto-close mode positions if that mode's allocated collateral drops by 10%
- Stop-loss protection on every trade
- Clear error messages with resolution steps

### Growth (Phase 2)

- State Management mode (human-like behavior) if needed
- Configurable strategy parameters (leverage, thresholds, intervals)
- Dynamic slippage based on order book depth
- Mobile notifications for key events

### Vision (Phase 3)

- Multi-market support beyond Valiant Perps
- Custom strategy creation

### Risk Mitigation

- **Technical:** FOGOChain RPC reliability — mitigate with graceful error handling, automatic retry logic, and dashboard alerts. All positions protected by stop-loss before execution.
- **Market:** Minimal — personal tool. Strategy effectiveness validated through real trading with small position sizes first.
- **Resource:** Low risk — resources available. Build one mode at a time, integrate into dashboard incrementally.

## User Journeys

### Journey 1: First Launch — "Get Trading in Minutes"

theRoad opens the Valiant Perps browser console, runs the extraction script, and grabs his agent key. He pastes it into the `.env` file, runs the bot, and the dashboard opens. He sees his wallet balance, zero trades, all modes off. He allocates funds to Volume Max, toggles it on — the bot starts cycling delta-neutral trades immediately. Within seconds, the dashboard shows live trades, volume climbing, and session PnL ticking. No friction — just extract, configure, allocate, run.

### Journey 2: Multi-Mode Operation — "Stack the Strategies"

theRoad has Volume Max running and farming Flames with its allocated funds. He notices price volatility picking up — good conditions for Profit Hunter. He allocates funds to Profit Hunter and toggles it on from the dashboard *without stopping* Volume Max. Both modes run in parallel on their own budgets. Later, he spots an arbitrage opportunity, allocates funds, and enables that too. The dashboard shows all three modes active, with separate stats and fund usage for each — total trades, volumes, PnL, and remaining allocation broken down by mode and combined. He stops whichever modes he wants independently.

### Journey 3: Something Goes Wrong — "Clear Alerts, Clear Actions"

theRoad is running Profit Hunter when his session key expires. The bot stops trading immediately and the dashboard shows: "Session key expired — re-extract from browser console and update .env." Another scenario: Profit Hunter's allocated collateral drops 10%, triggering the per-mode kill switch. The dashboard shows exactly what happened — which positions were closed, at what prices, the loss amount — and what to do next. Other modes continue running unaffected. Every error has a message, details, and a resolution path.

### Journey 4: Monitoring Performance — "How Am I Doing?"

theRoad opens the dashboard after running the bot overnight. He sees total profit across all sessions, today's session PnL, total trades executed, volume generated, all open positions, and remaining fund allocation per mode. He checks trade history and the live log to review what happened while he was away. Everything on one screen.

### Journey Requirements Summary

| Capability | Revealed By |
|---|---|
| Session key extraction & config | Journey 1 |
| Instant bot startup with zero friction | Journey 1 |
| Per-mode fund allocation | Journey 1, 2 |
| Independent parallel mode execution | Journey 2 |
| Per-mode and combined stats on dashboard | Journey 2 |
| Per-mode kill switch (isolated from other modes) | Journey 3 |
| Clear error messages with resolution steps | Journey 3 |
| Dashboard: total profit, session PnL, trades, volumes, open positions, trade history, live log, fund allocation | Journey 4 |

## Blockchain/Web3 Specific Requirements

### Technical Architecture

- **Chain:** FOGOChain (SVM-based)
- **Wallet Integration:** Session keys extracted from Valiant Perps browser console via agent key script, stored in `.env`
- **Gas:** Covered by Fogo sessions — no gas optimization needed
- **RPC:** Public FOGOChain API endpoints
- **Transaction Speed:** Sub-second execution (nice-to-have)
- **Oracle Integration:** Pyth Network for price feeds (Profit Hunter mode)

### Smart Contract Interaction

- Interact with Valiant Perps contracts for opening/closing positions
- Support long and short positions with configurable leverage
- Handle order placement, cancellation, and position management

### Asset & Pair Selection

- Dashboard UI to select which trading pairs to target
- Per-mode pair configuration — different modes can trade different pairs
- Support targeting boosted pairs when Valiant offers extra Flames rewards on specific assets

### Slippage & Execution

- Default slippage: 0.5%, configurable via dashboard UI
- Dynamic adjustment based on order book depth (growth feature)

### Security Model

- Session keys stored locally in `.env`, never committed to version control or exposed via dashboard/logs
- Key rotation every 7 days or on session expiry
- No session key data transmitted over network beyond chain transactions
- Dashboard accessible only on localhost (no remote access by default)
- Priority: flawless execution and zero fund loss

## Functional Requirements

### Trading Engine

- FR1: User can start and stop the trading bot from the dashboard
- FR2: User can activate Volume Max mode to execute delta-neutral long/short cycling
- FR3: User can activate Profit Hunter mode to execute trades based on Pyth oracle price deviation from 5-minute moving average
- FR4: User can activate Arbitrage mode to exploit cross-market price differences
- FR5: User can run multiple trading modes simultaneously and independently
- FR6: User can stop individual modes without affecting other running modes
- FR7: User can select which trading pairs each mode targets
- FR8: User can target specific boosted pairs for extra Flames rewards

### Fund Allocation

- FR9: User can allocate a specific fund amount to each trading mode from the dashboard
- FR10: Each mode trades only within its allocated fund amount
- FR11: User can view remaining allocated funds per mode on the dashboard

### Position Management

- FR12: System applies stop-loss protection to every opened position
- FR13: System auto-closes all positions for a specific mode when that mode's allocated collateral drops by 10% (per-mode kill switch)
- FR14: User can view all currently open positions on the dashboard
- FR15: System handles failed transactions gracefully without leaving orphaned positions

### Dashboard & Monitoring

- FR16: User can view total number of trades executed
- FR17: User can view total trading volume generated
- FR18: User can view current bot status (running/stopped, active modes)
- FR19: User can view session PnL
- FR20: User can view total profit across all sessions
- FR21: User can view complete trade history
- FR22: User can view per-mode statistics (trades, volume, PnL) separately
- FR23: User can view combined statistics across all modes
- FR24: User can view a live trade log streaming trades in real-time

### Configuration

- FR25: User can configure slippage percentage from the dashboard
- FR26: User can toggle trading modes on/off from the dashboard

### Authentication & Session

- FR27: System authenticates using session keys extracted from browser console
- FR28: System stores session keys locally in `.env` file
- FR29: System detects expired session keys and alerts the user with resolution steps

### Error Handling

- FR30: System displays clear error messages with details when issues occur
- FR31: System provides resolution steps for every error type
- FR32: System alerts user when per-mode kill switch is triggered with full details (positions closed, prices, loss amount)
- FR33: System handles RPC connection failures with retry logic and dashboard alerts

### Extensibility

- FR34: System supports a pluggable strategy architecture allowing new trading strategies to be added in the future
- FR35: User can view and manage all available trading strategies from the dashboard

## Non-Functional Requirements

### Performance

- Trade execution completes within 1 second of signal trigger
- Dashboard updates real-time via WebSocket (no polling/refresh)
- Live trade log streams trades as they happen with zero noticeable delay
- Pyth oracle price feed updates continuously for Profit Hunter mode

### Reliability

- Bot never leaves orphaned open positions on crash or error
- Per-mode kill switch triggers independently even if other modes crash
- Automatic retry on RPC connection failures (max 3 retries before alerting user)
- All position-opening transactions confirm stop-loss is set before proceeding
- On unexpected shutdown, bot closes all open positions gracefully

### Integration

- Stable connection to FOGOChain public RPC endpoints
- Reliable Pyth Network oracle price feed for Profit Hunter mode
- Valiant Perps smart contract interaction for all position management
