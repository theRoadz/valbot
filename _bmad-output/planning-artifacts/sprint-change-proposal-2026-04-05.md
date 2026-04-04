# Sprint Change Proposal: SVM → Hyperliquid API Correction

**Date:** 2026-04-05
**Author:** John (PM) with Amelia (Dev)
**Triggered by:** Story 8.1 implementation — session key hex support revealed wrong wallet address derivation
**Scope Classification:** Moderate
**Status:** Approved by theRoad

---

## 1. Issue Summary

### Problem Statement
The PRD, Architecture, Epics, and Project Context all assumed FOGOChain SVM for trade execution. During Story 8.1 implementation, we discovered that Valiant Perps routes all perpetual trades through **Hyperliquid's EVM-based order book**, not Fogo SVM smart contracts.

### Discovery Context
- Story 8.1 added hex format support for the agent key
- `Keypair.fromSeed()` (Ed25519/Solana) derived address `DHYXB8M2L...` — does not match the Valiant wallet `0x8edb...`
- Investigation confirmed: agent key is secp256k1 (EVM), wallet is 0x format, trades go through Hyperliquid REST API

### Evidence
- Valiant docs: *"Hyperliquid is the execution layer. Valiant is the experience layer on top."*
- Fogo docs confirm SVM chain, but Valiant creates embedded Privy Hyperliquid wallets for trading
- Extraction script outputs `WALLET: 0x8edb...` (EVM address) and `AGENT KEY: 0x1dcd...` (secp256k1 private key)
- Hyperliquid API documented at `https://api.hyperliquid.xyz/exchange`

---

## 2. Impact Analysis

### Epic Impact
| Epic | Impact | Details |
|------|--------|---------|
| Epic 1 (Foundation) | **Moderate** | Story 1.5 blockchain connection needs correction for Hyperliquid API |
| Epic 2 (Volume Max) | **Low** | Contract interface types change; engine/strategy code unaffected |
| Epic 3 (Safety) | **Low** | Story 3.3 wording: "RPC" → "API". Concepts unchanged |
| Epic 4 (Multi-Mode) | **Low** | Story 4.1 Pyth may have Hyperliquid allMids as alternative |
| Epics 5-7 | **None** | Dashboard, history, accessibility are blockchain-agnostic |

### Artifact Conflicts
| Artifact | Sections Affected |
|----------|------------------|
| PRD | Executive Summary, Technical Architecture, Smart Contract section, NFR10/12, FR33, Risk Mitigation |
| Architecture | Technical Constraints, Component descriptions, Boundary rules, Integration table, .env |
| Epics | NFR10/12, FR33, Epic 1 description, Stories 1.5, 3.3 |
| Project Context | Technology Stack, Boundary Rules, RPC & Blockchain Rules |
| idea.md | Core Tech, Blockchain lines |

### Technical Impact
- **2 files full rewrite:** `src/server/blockchain/client.ts`, `src/server/blockchain/contracts.ts`
- **3 files minor update:** `position-manager.ts` (param names), `errors.ts` (messages), `index.ts` (add init call)
- **Dependencies:** Remove `@solana/web3.js`, `@solana/spl-token`, `bs58`. Add `@nktkas/hyperliquid`, `viem`.
- **95% of codebase unaffected** — architecture boundary rules contained the blast radius

---

## 3. Recommended Approach

**Selected: Direct Adjustment**

The architecture's boundary rules (`src/server/blockchain/` is the only code touching the chain) contained the impact perfectly. No epics need removal or resequencing. The same features ship with different plumbing.

**Rationale:**
- Low effort: ~260 lines of code to rewrite + doc updates
- Low risk: 95% of code untouched, same test patterns
- MVP unchanged: Same features, same user experience
- Story 8.2 already written with full implementation plan

**Alternatives considered:**
- Rollback (not needed — only Story 1.5 blockchain code superseded, rest of 1.5 still valid)
- MVP scope reduction (not needed — same features, just different backend)

---

## 4. Detailed Change Proposals

### PRD Changes (Approved)

**Executive Summary:**
- "SVM-Web3 libraries" → "Hyperliquid TypeScript SDK (Valiant routes trades through Hyperliquid's order book)"

**Technical Architecture section:**
- "Chain: FOGOChain (SVM-based)" → "Chain Identity: FOGOChain (SVM) for sessions; Trade Execution: Hyperliquid REST API"
- "RPC: Public FOGOChain API endpoints" → "API: Hyperliquid Info + Exchange endpoints"
- "Wallet Integration" updated for EVM agent key + master wallet dual-address model

**Smart Contract section → Hyperliquid API Interaction:**
- SVM contracts → REST API with EIP-712 signed requests
- IOC/GTC order types, stop-loss trigger orders, account state queries

**NFRs:** NFR10 (FOGOChain RPC → Hyperliquid API), NFR12 (SVM contracts → Hyperliquid API)
**FRs:** FR33 (RPC failures → API failures)
**Risk:** FOGOChain RPC reliability → Hyperliquid API reliability

### Architecture Changes (Approved)

- Technical constraints: SVM-Web3 → Hyperliquid SDK + viem
- All "FOGOChain RPC" references → "Hyperliquid API"
- Boundary rule updated for Hyperliquid
- Integration table: SVM transactions → REST with EIP-712
- .env: Remove RPC_URL, add WALLET
- Data flow: "on-chain confirmation" → "Hyperliquid API response"

### Epics Changes (Approved)

- NFR10, NFR12, FR33: SVM/RPC references → Hyperliquid API
- Epic 1 description: "connects to FOGOChain" → "connects to Hyperliquid API"
- Story 1.5: Renamed to "Hyperliquid Connection & Agent Key Authentication"
- Story 3.3: Renamed to "API Connection Resilience"
- Story 4.1: Note added about Hyperliquid allMids as Pyth alternative
- FR Coverage Map: FR33 updated

### Project Context Changes (Approved)

- Technology Stack: SVM-Web3 → @nktkas/hyperliquid + viem
- Boundary Rules: FOGOChain RPC → Hyperliquid API
- RPC & Blockchain Rules → API & Blockchain Rules + EVM agent key details

### idea.md Changes (Approved)

- Core Tech line: SVM-Web3 → Hyperliquid SDK + viem
- Blockchain line: FOGOChain SVM → Hyperliquid via Valiant Perps

---

## 5. Implementation Handoff

### Scope: Moderate

**Phase 1 — Document Updates (PM + Architect):**
Apply all approved text changes to:
1. `_bmad-output/planning-artifacts/prd.md`
2. `_bmad-output/planning-artifacts/architecture.md`
3. `_bmad-output/planning-artifacts/epics.md`
4. `_bmad-output/project-context.md`
5. `idea.md`

**Phase 2 — Code Implementation (Dev — Story 8.2):**
Implementation story already written: `_bmad-output/implementation-artifacts/8-2-hyperliquid-blockchain-layer-rewrite.md`

Key tasks:
1. Swap dependencies (remove Solana, add Hyperliquid SDK + viem)
2. Rewrite `src/server/blockchain/client.ts` — EVM wallet, Hyperliquid API connection, balance query
3. Rewrite `src/server/blockchain/contracts.ts` — Hyperliquid order placement, cancel, stop-loss
4. Update `position-manager.ts` param names
5. Update error messages
6. Rewrite tests
7. Verify: `pnpm test`, `pnpm build`, correct wallet on dashboard

### Success Criteria
- Zero SVM/FOGOChain references in `src/` code (trading context)
- All 300+ tests pass
- Dashboard shows correct 0x wallet address matching Valiant Perps
- Real USDC balance displayed from Hyperliquid account state
- Documents internally consistent — no contradictory SVM/Hyperliquid references
