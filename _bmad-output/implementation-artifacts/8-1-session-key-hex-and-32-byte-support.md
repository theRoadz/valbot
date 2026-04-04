# Story 8.1: Session Key Hex & 32-Byte Seed Support

Status: superseded by 8-2 (SVM assumption was incorrect — Valiant trades via Hyperliquid EVM API, not Fogo SVM)

## Story

As theRoad,
I want to paste the agent key from the Valiant Perps extraction script directly into `.env`,
So that I don't have to manually convert between hex and base58 formats or worry about key length differences.

## Problem

The Valiant Perps browser extraction script outputs the agent key as a **32-byte hex-encoded string** with `0x` prefix. The original `loadSessionKey()` in Story 1.5 only accepted **64-byte base58-encoded** keys. This caused two errors:

1. `Non-base58 character` — hex characters (`0x...`) aren't valid base58
2. `Expected 64-byte secret key, got 32 bytes` — the agent key is a 32-byte private key seed, not a full 64-byte Solana keypair

## Acceptance Criteria

1. **Scenario 1: Hex-encoded 32-byte agent key**
   - **Given** SESSION_KEY in `.env` is a `0x`-prefixed hex string (32 bytes / 64 hex chars)
   - **When** the bot starts
   - **Then** `loadSessionKey()` strips the `0x` prefix, decodes hex to bytes
   - **And** uses `Keypair.fromSeed()` to derive the full keypair from the 32-byte seed
   - **And** the server starts successfully with the correct wallet address

2. **Scenario 2: Hex-encoded 64-byte full keypair**
   - **Given** SESSION_KEY in `.env` is a `0x`-prefixed hex string (64 bytes / 128 hex chars)
   - **When** the bot starts
   - **Then** `loadSessionKey()` decodes and uses `Keypair.fromSecretKey()` as before

3. **Scenario 3: Base58-encoded 64-byte key (regression)**
   - **Given** SESSION_KEY in `.env` is a base58-encoded 64-byte key (original format)
   - **When** the bot starts
   - **Then** behavior is unchanged — key loads successfully

4. **Scenario 4: Invalid key length**
   - **Given** SESSION_KEY decodes to neither 32 nor 64 bytes
   - **When** the bot attempts to load the key
   - **Then** throws `SESSION_KEY_INVALID` AppError with message indicating expected 32 or 64 bytes

## Tasks / Subtasks

- [x] Task 1: Add hex format detection to `loadSessionKey()` (AC: #1, #2)
  - [x] 1.1 Trim whitespace from SESSION_KEY value before processing
  - [x] 1.2 If value starts with `0x`, strip prefix and decode as hex via `Buffer.from(hex, 'hex')`
  - [x] 1.3 Otherwise, decode as base58 (existing behavior)

- [x] Task 2: Add 32-byte seed support (AC: #1, #4)
  - [x] 2.1 If decoded bytes are 64 → `Keypair.fromSecretKey()` (existing)
  - [x] 2.2 If decoded bytes are 32 → `Keypair.fromSeed()` (new — derives full keypair from Ed25519 seed)
  - [x] 2.3 Otherwise → throw `sessionKeyInvalidError` with byte count

- [x] Task 3: Update error/resolution messages (AC: #1, #2, #3, #4)
  - [x] 3.1 Update `SESSION_KEY_MISSING` resolution to mention both formats
  - [x] 3.2 Update catch-all error message to mention both base58 and hex

- [x] Task 4: Add test for 32-byte hex-encoded seed (AC: #1)
  - [x] 4.1 New test in `client.test.ts`: generate 32-byte seed, hex-encode with `0x` prefix, verify `Keypair.fromSeed()` produces matching keypair

- [x] Task 5: Verify no regressions (AC: #3)
  - [x] 5.1 Existing test for valid base58 64-byte key still passes
  - [x] 5.2 Full test suite: 307 tests across 26 files, all passing

## Dev Notes

### Key Technical Details

- `Keypair.fromSeed(seed: Uint8Array)` is available in `@solana/web3.js` v1.98.4
- Takes exactly 32 bytes, derives the full Ed25519 keypair deterministically
- Same seed always produces the same wallet address
- No new dependencies required — `Buffer` is a Node.js global

### Why 32 vs 64 bytes?

- **32-byte seed:** The raw Ed25519 private key. This is what Valiant Perps stores and what the extraction script outputs.
- **64-byte secret key:** Solana's format — the 32-byte private key concatenated with the 32-byte public key. This is what `Keypair.generate().secretKey` produces and what `Keypair.fromSecretKey()` expects.
- `Keypair.fromSeed()` bridges the gap — takes the 32-byte seed and derives both halves.

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Completion Notes List

- **Task 1-2:** Modified `loadSessionKey()` to trim input, detect `0x` prefix for hex decode, and branch on 32 vs 64 byte length.
- **Task 3:** Updated resolution text in both the missing-key error and the catch-all decode error.
- **Task 4:** Added test `returns Keypair for 32-byte hex-encoded seed (0x prefix)` — generates a 32-byte seed, hex-encodes with `0x`, verifies keypair matches `Keypair.fromSeed()`.
- **Task 5:** Full suite: 307 tests, 26 files, all passing. No regressions.

### Change Log

- 2026-04-04: Story 8.1 implementation complete — hex format support and 32-byte seed support for session keys

### File List

Modified files:
- src/server/blockchain/client.ts — `loadSessionKey()` updated with hex detection, trimming, and 32-byte `fromSeed()` support
- src/server/blockchain/client.test.ts — added test for 32-byte hex-encoded seed
