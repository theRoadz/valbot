# Story 8.19: Deploy ValBot to Contabo VPS

Status: todo

## Story

As theRoad,
I want ValBot deployed on my Contabo VPS with nginx reverse proxy, systemd process management, and free SSL,
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

### Architecture fit

| Requirement | Contabo VPS |
|---|---|
| Persistent filesystem (SQLite) | Yes |
| Long-running processes (trading loops) | Yes |
| WebSocket server (real-time UI) | Yes |
| In-memory state (positions, kill-switch) | Yes |
| Public IP for HTTPS | Yes |

### Cost

- **$0 additional** — nginx, Let's Encrypt/Certbot, systemd, Node.js, pnpm are all free and open-source
- Only costs: Contabo server subscription + domain name

### No core code changes

This story modifies **zero files** in `src/`. All configuration is on the server.

## Acceptance Criteria

1. **Given** the VPS has Node.js 22, pnpm, and build tools installed, **When** `pnpm install && pnpm build && pnpm db:migrate` is run, **Then** the application builds successfully.
2. **Given** the systemd service is configured, **When** `sudo systemctl start valbot` is run, **Then** the bot process starts and stays running. **When** the process crashes, **Then** systemd auto-restarts it within 5 seconds.
3. **Given** nginx is configured as a reverse proxy, **When** a user visits `http://yourdomain.com`, **Then** they see the ValBot dashboard. WebSocket connections for real-time updates work through the proxy.
4. **Given** Certbot has issued a Let's Encrypt certificate, **When** a user visits `https://yourdomain.com`, **Then** the connection is secured with a valid SSL certificate. HTTP requests redirect to HTTPS.
5. **Given** the firewall is configured, **When** checking open ports, **Then** only SSH (22), HTTP (80), and HTTPS (443) are accessible. Port 3000 is NOT exposed externally.
6. **Given** the VPS reboots, **When** the system starts, **Then** valbot auto-starts via systemd (`WantedBy=multi-user.target`).
7. **Given** a new version is pushed to Git, **When** the update procedure is followed (pull, install, build, restart), **Then** the new version is live within minutes.

## Prerequisites

- Contabo VPS with Ubuntu 22.04+ (or Debian 12+)
- A domain name with an A record pointing to the server's public IP
- SSH access to the server (root or sudo user)
- ValBot repo accessible from the server (GitHub/GitLab)

## Tasks / Subtasks

- [ ] Task 1: Server environment setup
  - [ ] 1.1 Update system packages: `sudo apt update && sudo apt upgrade -y`
  - [ ] 1.2 Install Node.js 22.x via NodeSource: `curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs`
  - [ ] 1.3 Enable pnpm via corepack: `corepack enable && corepack prepare pnpm@10.25.0 --activate`
  - [ ] 1.4 Install native build tools (for better-sqlite3): `sudo apt install -y build-essential python3`
  - [ ] 1.5 Install nginx and certbot: `sudo apt install -y nginx certbot python3-certbot-nginx`
  - [ ] 1.6 Create dedicated `valbot` user: `sudo useradd -m -s /bin/bash valbot`

- [ ] Task 2: Deploy application
  - [ ] 2.1 Switch to valbot user: `sudo su - valbot`
  - [ ] 2.2 Clone repository: `git clone <repo-url> ~/valbot && cd ~/valbot`
  - [ ] 2.3 Install dependencies: `pnpm install`
  - [ ] 2.4 Build for production: `pnpm build`
  - [ ] 2.5 Run database migrations: `pnpm db:migrate`
  - [ ] 2.6 Create `.env` file with production values:
    ```
    SESSION_KEY=0x_your_agent_key
    WALLET=0x_your_master_wallet_address
    PORT=3000
    VALBOT_DB_PATH=./valbot.db
    NODE_ENV=production
    BUILDER_ADDRESS=0x751d254c07f7a4b454eb5c2a23ebe3adf1a4eaec
    BUILDER_FEE_RATE=38
    ```
  - [ ] 2.7 Smoke test: `node dist/server/index.js` — verify startup logs, then Ctrl+C

- [ ] Task 3: Create systemd service
  - [ ] 3.1 Create `/etc/systemd/system/valbot.service`:
    ```ini
    [Unit]
    Description=ValBot Trading Bot
    After=network.target

    [Service]
    Type=simple
    User=valbot
    WorkingDirectory=/home/valbot/valbot
    ExecStart=/usr/bin/node dist/server/index.js
    Restart=always
    RestartSec=5
    Environment=NODE_ENV=production

    # Security hardening
    NoNewPrivileges=true
    ProtectSystem=strict
    ReadWritePaths=/home/valbot/valbot

    # Logging
    StandardOutput=journal
    StandardError=journal
    SyslogIdentifier=valbot

    [Install]
    WantedBy=multi-user.target
    ```
  - [ ] 3.2 Reload systemd: `sudo systemctl daemon-reload`
  - [ ] 3.3 Enable on boot: `sudo systemctl enable valbot`
  - [ ] 3.4 Start service: `sudo systemctl start valbot`
  - [ ] 3.5 Verify running: `sudo systemctl status valbot` — should show "active (running)"
  - [ ] 3.6 Check logs: `journalctl -u valbot -f` — verify engine initialization

- [ ] Task 4: Configure nginx reverse proxy
  - [ ] 4.1 Create `/etc/nginx/sites-available/valbot`:
    ```nginx
    server {
        listen 80;
        server_name yourdomain.com;

        location / {
            proxy_pass http://127.0.0.1:3000;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;

            # WebSocket support (critical for real-time updates)
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_read_timeout 86400;  # keep WS alive for 24h
        }
    }
    ```
  - [ ] 4.2 Enable site: `sudo ln -s /etc/nginx/sites-available/valbot /etc/nginx/sites-enabled/`
  - [ ] 4.3 Remove default site: `sudo rm /etc/nginx/sites-enabled/default`
  - [ ] 4.4 Test config: `sudo nginx -t`
  - [ ] 4.5 Restart nginx: `sudo systemctl restart nginx`
  - [ ] 4.6 Verify: visit `http://yourdomain.com` in browser — should show ValBot dashboard

- [ ] Task 5: SSL with Let's Encrypt
  - [ ] 5.1 Run certbot: `sudo certbot --nginx -d yourdomain.com`
  - [ ] 5.2 Follow prompts — certbot auto-modifies nginx config for HTTPS + redirect
  - [ ] 5.3 Verify auto-renewal timer: `sudo systemctl status certbot.timer`
  - [ ] 5.4 Test renewal: `sudo certbot renew --dry-run`
  - [ ] 5.5 Verify: visit `https://yourdomain.com` — valid SSL certificate, padlock icon

- [ ] Task 6: Firewall configuration
  - [ ] 6.1 Allow SSH: `sudo ufw allow 22/tcp`
  - [ ] 6.2 Allow HTTP: `sudo ufw allow 80/tcp` (needed for certbot renewal + redirect)
  - [ ] 6.3 Allow HTTPS: `sudo ufw allow 443/tcp`
  - [ ] 6.4 Enable firewall: `sudo ufw enable`
  - [ ] 6.5 Verify: `sudo ufw status` — only 22, 80, 443 open. Port 3000 NOT exposed.

- [ ] Task 7: Final verification
  - [ ] 7.1 `https://yourdomain.com` loads ValBot dashboard
  - [ ] 7.2 WebSocket connects — real-time price updates visible in UI
  - [ ] 7.3 Can allocate funds and start/stop modes from the dashboard
  - [ ] 7.4 `journalctl -u valbot -f` shows trade activity logs
  - [ ] 7.5 Reboot server: `sudo reboot` — after restart, valbot auto-starts
  - [ ] 7.6 After reboot, dashboard is accessible and positions/sessions recovered from DB

## Update Procedure (Future Deploys)

```bash
sudo su - valbot
cd ~/valbot
git pull
pnpm install
pnpm build
pnpm db:migrate    # only if schema changed
exit
sudo systemctl restart valbot
```

## Troubleshooting

| Issue | Command |
|---|---|
| Bot not starting | `journalctl -u valbot --no-pager -n 50` |
| nginx 502 Bad Gateway | `sudo systemctl status valbot` (bot may be down) |
| WebSocket not connecting | Check nginx `proxy_set_header Upgrade` config |
| SSL certificate expired | `sudo certbot renew` (should auto-renew) |
| DB locked errors | Check only one valbot process: `ps aux \| grep valbot` |
| Port 3000 already in use | `sudo lsof -i :3000` to find conflicting process |

## Dev Agent Record

### Implementation Notes

- This is an infrastructure-only story — zero changes to any file in `src/`
- All configs are created on the Contabo server, not committed to the repo
- The `.env` file contains secrets (private keys) and must NEVER be committed
- systemd `ProtectSystem=strict` + `ReadWritePaths` limits filesystem access for security
- nginx `proxy_read_timeout 86400` prevents WebSocket disconnects (24h timeout)
- Let's Encrypt certificates auto-renew every 90 days via certbot systemd timer — $0 cost

## Change Log

_(to be filled during implementation)_

## File List

**Server-side files (NOT in repo):**
- `/etc/systemd/system/valbot.service` — systemd service unit
- `/etc/nginx/sites-available/valbot` — nginx reverse proxy config
- `/home/valbot/valbot/.env` — environment variables with secrets

**No files in the ValBot repo are modified by this story.**
