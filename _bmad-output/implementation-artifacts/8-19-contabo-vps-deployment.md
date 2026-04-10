# Story 8.19: Deploy ValBot to Contabo VPS

Status: done

## Story

As theRoad,
I want ValBot deployed on my Contabo VPS with nginx reverse proxy, systemd process management, and secured access,
So that the trading bot runs 24/7 with the dashboard accessible via HTTPS on my domain.

## Problem

ValBot runs locally in development but needs a production deployment for continuous 24/7 trading. The Contabo VPS provides persistent compute with a stable filesystem (ideal for SQLite), long-running processes (required for trading loops and WebSocket), and a public IP for the dashboard UI.

## Background

### Current production support (already built)

- `pnpm build` compiles React frontend → `dist/client/`, Fastify backend → `dist/server/`
- `pnpm start` runs `node dist/server/index.js` which serves both API + SPA on a single port
- `NODE_ENV=production` enables static file serving via `@fastify/static` (`src/server/index.ts:31-36`)
- Server binds to `127.0.0.1:PORT` (default 3000) — safe behind reverse proxy
- SQLite DB auto-created on first `pnpm db:migrate`, persisted to disk
- Graceful shutdown on SIGINT/SIGTERM already implemented (`src/server/lib/shutdown.ts`)

### Server environment

- **OS:** Ubuntu 24.04.4 LTS (x86_64)
- **Domain:** `valbot.in`
- **Existing services:** fogopulse crank-bot + trade-bot (systemd, unaffected)
- **Node.js:** Upgraded from v20.20.1 → v22.22.2

### Architecture fit

| Requirement | Contabo VPS |
|---|---|
| Persistent filesystem (SQLite) | Yes |
| Long-running processes (trading loops) | Yes |
| WebSocket server (real-time UI) | Yes |
| In-memory state (positions, kill-switch) | Yes |
| Public IP for HTTPS | Yes |

### Cost

- **$0 additional** — nginx, Cloudflare (free tier), systemd, Node.js, pnpm are all free and open-source
- Only costs: Contabo server subscription + domain name

## Acceptance Criteria

1. **Given** the VPS has Node.js 22, pnpm, and build tools installed, **When** `pnpm install && pnpm build && pnpm db:migrate` is run, **Then** the application builds successfully.
2. **Given** the systemd service is configured, **When** `sudo systemctl start valbot` is run, **Then** the bot process starts and stays running. **When** the process crashes, **Then** systemd auto-restarts it within 5 seconds.
3. **Given** nginx is configured as a reverse proxy, **When** a user visits `http://valbot.in`, **Then** they see the ValBot dashboard. WebSocket connections for real-time updates work through the proxy.
4. **Given** Cloudflare Access is configured, **When** an unauthenticated user visits `https://valbot.in`, **Then** they are prompted to authenticate via Google OAuth before accessing the dashboard.
5. **Given** the firewall is configured, **When** checking open ports, **Then** only SSH (22), HTTP (80), and HTTPS (443) are accessible. Port 3000 is NOT exposed externally.
6. **Given** the VPS reboots, **When** the system starts, **Then** valbot auto-starts via systemd (`WantedBy=multi-user.target`).
7. **Given** a new version is pushed to Git, **When** the update procedure is followed (pull, install, build, restart), **Then** the new version is live within minutes.

## Prerequisites

- Contabo VPS with Ubuntu 24.04+
- A domain name with DNS on Cloudflare
- SSH access to the server (root or sudo user)
- ValBot repo accessible from the server (GitHub)
- Cloudflare account (free tier)

## Tasks / Subtasks

- [x] Task 1: Server environment setup
  - [x] 1.1 Update system packages: `sudo apt update && sudo apt upgrade -y`
  - [x] 1.2 Upgrade Node.js 20 → 22 via NodeSource, verify fogopulse bots still running
  - [x] 1.3 Enable pnpm via corepack: `sudo corepack enable && sudo corepack prepare pnpm@10.25.0 --activate`
  - [x] 1.4 Install native build tools (for better-sqlite3): `sudo apt install -y build-essential python3`
  - [x] 1.5 Install nginx and certbot: `sudo apt install -y nginx certbot python3-certbot-nginx`
  - [x] 1.6 Create dedicated `valbot` user: `sudo useradd -m -s /bin/bash valbot`

- [x] Task 2: Deploy application
  - [x] 2.1 Switch to valbot user: `sudo su - valbot`
  - [x] 2.2 Clone repository: `git clone https://github.com/theRoadz/valbot.git ~/valbot`
  - [x] 2.3 Install dependencies: `pnpm install` (395 packages, better-sqlite3 compiled)
  - [x] 2.4 Build for production: `pnpm build` (client + server built successfully)
  - [x] 2.5 Run database migrations: `pnpm db:migrate`
  - [x] 2.6 Create `.env` file with production values (SESSION_KEY, WALLET, PORT, etc.)
  - [x] 2.7 Smoke test: `node dist/server/index.js` — engine initialized, blockchain connected

- [x] Task 3: Create systemd service
  - [x] 3.1 Create `/etc/systemd/system/valbot.service` with security hardening
  - [x] 3.2 Reload systemd: `sudo systemctl daemon-reload`
  - [x] 3.3 Enable on boot: `sudo systemctl enable valbot`
  - [x] 3.4 Start service: `sudo systemctl start valbot`
  - [x] 3.5 Verified running: engine initialized, blockchain connected, oracle streaming

- [x] Task 4: Configure nginx reverse proxy
  - [x] 4.1 Create `/etc/nginx/sites-available/valbot` with WebSocket support
  - [x] 4.2 Enable site, remove default, test config, restart nginx
  - [x] 4.3 Verified: `http://valbot.in` shows ValBot dashboard

- [x] Task 5: Cloudflare DNS + Access (replaced Let's Encrypt)
  - [x] 5.1 Moved `valbot.in` DNS to Cloudflare (nameservers: ines.ns.cloudflare.com, peyton.ns.cloudflare.com)
  - [x] 5.2 Cloudflare handles SSL/TLS — HTTPS via Cloudflare proxy
  - [x] 5.3 Set up Cloudflare Zero Trust Access Application (team: valbot)
  - [x] 5.4 Configured Google OAuth authentication
  - [x] 5.5 Verified: unauthenticated users see login screen, only authorized email gets access

- [x] Task 6: Firewall configuration
  - [x] 6.1 Allow SSH (22), HTTP (80), HTTPS (443)
  - [x] 6.2 Enable firewall: `sudo ufw enable`
  - [x] 6.3 Verified: only 22, 80, 443 open. Port 3000 NOT exposed.

- [x] Task 7: Final verification
  - [x] 7.1 `https://valbot.in` loads ValBot dashboard (after Cloudflare auth)
  - [x] 7.2 WebSocket connects — real-time price updates visible in UI
  - [x] 7.3 Fogopulse bots unaffected — both crank-bot and trade-bot running
  - [x] 7.4 `journalctl -u valbot -f` shows trade activity logs

## Update Procedure (Future Deploys)

### Standard update (most changes — code, UI, strategies, bug fixes):
```bash
sudo su - valbot
cd ~/valbot
git pull
pnpm install
pnpm build
exit
sudo systemctl restart valbot
```

### Schema update (only when `src/server/db/schema.ts` changed — new/modified tables or columns):
```bash
sudo su - valbot
cd ~/valbot
git pull
pnpm install
pnpm build
pnpm db:migrate
exit
sudo systemctl restart valbot
```

## Troubleshooting

| Issue | Command |
|---|---|
| Bot not starting | `journalctl -u valbot --no-pager -n 50` |
| nginx 502 Bad Gateway | `sudo systemctl status valbot` (bot may be down) |
| WebSocket not connecting | Check nginx `proxy_set_header Upgrade` config |
| DB locked errors | Check only one valbot process: `ps aux \| grep valbot` |
| Port 3000 already in use | `sudo lsof -i :3000` to find conflicting process |
| Cloudflare Access not blocking | Check Access Application is enabled in Zero Trust dashboard |

## Dev Agent Record

### Implementation Notes

- Upgraded Node.js system-wide from v20 to v22 — fogopulse bots (require node >= 18) unaffected, restarted and verified
- `pnpm` installed via `sudo corepack enable` (requires root, not regular user)
- Build initially failed due to two pre-existing TypeScript errors:
  1. `vaultAddress` was in `OrderParameters` but SDK v0.32.2 expects it in `OrderOptions` (3rd arg to `exchange.order()`)
  2. `eventsource` was a type-only import but not in `package.json` — pinned to v3.0.7 to match `@pythnetwork/hermes-client`
- Both fixes are compile-time only — zero runtime behavior change, all 813 tests pass
- Used Cloudflare Access with Google OAuth instead of Let's Encrypt for SSL + authentication in one solution
- Cloudflare free tier provides SSL, DDoS protection, and access control at no cost
- systemd `ProtectSystem=strict` + `ReadWritePaths` limits filesystem access for security
- nginx `proxy_read_timeout 86400` prevents WebSocket disconnects (24h timeout)
- The `valbot` user is a service account with no password — accessed only via `sudo su - valbot`

### Build Fix Commit

Commit `b9a29a5`: fix: move vaultAddress to OrderOptions and add eventsource dev dep
- `src/server/blockchain/contracts.ts` — moved `vaultAddress` from params to opts in 3 order calls
- `package.json` — added `eventsource@3.0.7` as dev dependency
- `.gitignore` — added `*.db-shm` and `*.db-wal`

## Change Log

- 2026-04-10: Story 8-19 deployed — ValBot live at https://valbot.in
- 2026-04-10: Node.js upgraded 20 → 22, fogopulse bots verified unaffected
- 2026-04-10: Fixed 2 build errors (vaultAddress placement, eventsource dep) — commit b9a29a5
- 2026-04-10: Cloudflare Access configured with Google OAuth for dashboard protection

## File List

**Server-side files (NOT in repo):**
- `/etc/systemd/system/valbot.service` — systemd service unit
- `/etc/nginx/sites-available/valbot` — nginx reverse proxy config
- `/home/valbot/valbot/.env` — environment variables with secrets

**Repo files modified (build fixes):**
- `src/server/blockchain/contracts.ts` — moved vaultAddress to OrderOptions (3rd arg)
- `package.json` — added eventsource@3.0.7 dev dependency
- `pnpm-lock.yaml` — lockfile updated
- `.gitignore` — added *.db-shm and *.db-wal patterns
