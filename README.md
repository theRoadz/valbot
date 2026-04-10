# ValBot

Algorithmic trading bot for [Valiant Perps](https://perps.valiant.exchange) on FOGOChain/Hyperliquid.

## What It Does

- **Five trading strategies** — Volume Max, Profit Hunter, Arbitrage, Momentum, and Grid Trading
- **Real-time web dashboard** — monitor positions, trades, and P&L as they happen
- **Risk controls** — per-mode kill switch, fund allocation limits, and mandatory stop-losses
- **Single-operator design** — built for personal use on your own machine or VPS

---

> **SECURITY WARNING**
>
> Your `SESSION_KEY` is a **private key** that can execute trades on your behalf. Treat it like a password to your wallet.
>
> - **Never** share your `.env` file or agent key with anyone
> - **Never** paste your agent key into websites, Discord bots, or online forms
> - **Never** commit `.env` to version control (it is already gitignored)
> - The server binds to `127.0.0.1` only — it is not exposed to the internet unless you set up a reverse proxy

---

## Prerequisites

- [Node.js](https://nodejs.org/) 22.x (LTS)
- pnpm 10.25.0 — enable with `corepack enable && corepack prepare pnpm@10.25.0 --activate`
- Git
- A [Valiant Perps](https://perps.valiant.exchange) account with an agent wallet created

## Getting Your Agent Key

ValBot needs two values to trade on your behalf: your **wallet address** and an **agent key**. These are created by Valiant and stored encrypted in your browser. The script below decrypts them locally on your machine — nothing leaves your computer.

### Steps

1. Open [Valiant Perps](https://perps.valiant.exchange) in your browser and **log in**
2. Press **F12** to open Developer Tools, then click the **Console** tab
3. The console blocks pasting by default. **Type `allow pasting` and press Enter** to unlock it
4. Copy the entire script below, paste it into the console, and press **Enter**
5. Look for the green **Success!** message — it shows your wallet address and agent key
6. Copy both values. You will need them for the `.env` file in the next step

```javascript
/**
 * RECOVERY TOOL: Valiant Agent Key Decryptor
 * Purpose: Decrypts locally stored agent keys using keys stored in IndexedDB.
 */

async function recoverAgentKeys() {
  const DB_NAME = 'valiant-agent-keys';
  const STORE_NAME = 'encryption-keys';
  const LS_PREFIX = 'valiant:agent:';

  try {
    // 1. Initialize IndexedDB Connection
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject('Database access denied');
    });

    // 2. Extract Encryption Materials
    let cryptoKeys = [];
    try {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      cryptoKeys = await new Promise((res) => {
        const req = store.getAll();
        req.onsuccess = () => res(req.result);
      });
    } catch (err) {
      console.warn('Primary store missing. Falling back to raw storage dump.');
      dumpRawLocalStorage(LS_PREFIX);
      return;
    }

    // 3. Process and Decrypt LocalStorage Entries
    const agentEntries = Object.keys(localStorage).filter(k => k.startsWith(LS_PREFIX));

    for (const keyMaterial of cryptoKeys) {
      const masterKey = keyMaterial.key || keyMaterial;

      for (const storageKey of agentEntries) {
        try {
          const walletAddress = storageKey.split(':').pop();
          const rawData = atob(localStorage.getItem(storageKey));

          // Convert string to byte array
          const buffer = Uint8Array.from(rawData, c => c.charCodeAt(0));

          // Standard AES-GCM Slicing: 12-byte IV + Ciphertext
          const iv = buffer.slice(0, 12);
          const ciphertext = buffer.slice(12);

          const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv },
            masterKey,
            ciphertext
          );

          console.info(`%cSuccess! [Wallet: ${walletAddress}]`, 'color: #00ff00; font-weight: bold');
          console.log('Agent Key:', new TextDecoder().decode(decrypted));

        } catch (decryptionError) {
          // Silent skip if the key doesn't match this specific entry
          continue;
        }
      }
    }
  } catch (globalError) {
    console.error('Execution Failed:', globalError);
  }
}

function dumpRawLocalStorage(prefix) {
  Object.keys(localStorage)
    .filter(k => k.startsWith(prefix))
    .forEach(k => console.log(`Raw Entry [${k}]:`, localStorage.getItem(k)));
}

// Execute logic
recoverAgentKeys();
```

> **Do not share the output of this script.** The agent key gives full trading access to your wallet. If you suspect it has been compromised, revoke the agent key from the Valiant interface immediately.

## Local Development Setup

### Windows

1. **Install Node.js 22** — download the Windows installer from [nodejs.org](https://nodejs.org/) (LTS version)

2. **Enable pnpm** — open PowerShell or Command Prompt:
   ```powershell
   corepack enable
   corepack prepare pnpm@10.25.0 --activate
   ```

3. **Install build tools** — better-sqlite3 requires C++ compilation. Install the Windows build tools:
   ```powershell
   npm install -g windows-build-tools
   ```
   Or install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the "Desktop development with C++" workload.

4. **Clone and set up:**
   ```powershell
   git clone <repo-url>
   cd valbot
   pnpm install
   copy .env.example .env
   ```

5. **Edit `.env`** — open it in any text editor and paste your `SESSION_KEY` and `WALLET` from the browser script step.

6. **Run migrations and start:**
   ```powershell
   pnpm db:migrate
   pnpm dev
   ```

### macOS / Linux

```bash
# Install Node.js 22 (macOS: brew install node@22, Linux: see nodejs.org)
# Enable pnpm
corepack enable && corepack prepare pnpm@10.25.0 --activate

# Clone and set up
git clone <repo-url> && cd valbot
pnpm install
cp .env.example .env

# Edit .env — paste your SESSION_KEY and WALLET from the browser script step

# Run migrations and start
pnpm db:migrate
pnpm dev
```

> On Linux, you may need `build-essential` and `python3` for better-sqlite3: `sudo apt install -y build-essential python3`

---

Both platforms: this starts the backend (Fastify on port 3000) and frontend (Vite dev server) concurrently. Open **http://localhost:5173** in your browser.

### Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start server + client in dev mode |
| `pnpm build` | Production build (client + server) |
| `pnpm start` | Run the production server |
| `pnpm test` | Run test suite |
| `pnpm db:migrate` | Apply database migrations |

## Environment Variables

Create a `.env` file from `.env.example` and configure these values:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SESSION_KEY` | Yes | — | Agent private key (0x-prefixed hex) from the browser script |
| `WALLET` | Yes | — | Master wallet address (0x-prefixed, 40 chars) |
| `PORT` | No | `3000` | Server listening port |
| `VALBOT_DB_PATH` | No | `./valbot.db` | SQLite database file path |
| `NODE_ENV` | No | — | Set to `production` for deployment |
| `BUILDER_ADDRESS` | No | See .env.example | Valiant builder fee recipient address |
| `BUILDER_FEE_RATE` | No | `38` | Builder fee in 0.1bps units (38 = 0.038%) |
| `TAKER_FEE_RATE` | No | `0.00045` | Estimated taker fee rate (0.045%) |

## Server Deployment (Contabo VPS / Ubuntu)

For 24/7 trading, deploy to a VPS. These instructions target Ubuntu 22.04+ on a Contabo VPS but work on any Ubuntu/Debian server.

**You will need:** a domain name with an A record pointing to the server's public IP.

### 1. Server Setup

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# Enable pnpm
corepack enable && corepack prepare pnpm@10.25.0 --activate

# Install build tools (for better-sqlite3 native compilation)
sudo apt install -y build-essential python3

# Install nginx and certbot
sudo apt install -y nginx certbot python3-certbot-nginx

# Create a dedicated user
sudo useradd -m -s /bin/bash valbot
```

### 2. Deploy the Application

```bash
# Switch to the valbot user
sudo su - valbot

# Clone and build
git clone <repo-url> ~/valbot && cd ~/valbot
pnpm install
pnpm build
pnpm db:migrate

# Create .env with production values
cat > .env << 'EOF'
SESSION_KEY=0x_your_agent_key
WALLET=0x_your_master_wallet_address
PORT=3000
VALBOT_DB_PATH=./valbot.db
NODE_ENV=production
BUILDER_ADDRESS=0x751d254c07f7a4b454eb5c2a23ebe3adf1a4eaec
BUILDER_FEE_RATE=38
EOF

# Smoke test — verify it starts, then Ctrl+C to stop
node dist/server/index.js

# Exit back to sudo user
exit
```

### 3. systemd Service

Create `/etc/systemd/system/valbot.service`:

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

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable valbot
sudo systemctl start valbot

# Verify it's running
sudo systemctl status valbot

# View logs
journalctl -u valbot -f
```

### 4. nginx Reverse Proxy

Create `/etc/nginx/sites-available/valbot`:

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

        # WebSocket support
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
    }
}
```

Enable and start:

```bash
sudo ln -s /etc/nginx/sites-available/valbot /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx
```

### 5. SSL with Let's Encrypt

```bash
sudo certbot --nginx -d yourdomain.com

# Verify auto-renewal
sudo certbot renew --dry-run
```

### 6. Firewall

```bash
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP (certbot renewal + redirect)
sudo ufw allow 443/tcp   # HTTPS
sudo ufw enable

# Verify — port 3000 should NOT be listed
sudo ufw status
```

## Updating (Production)

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

| Problem | What to check |
|---------|---------------|
| Bot won't start | `journalctl -u valbot --no-pager -n 50` |
| nginx 502 Bad Gateway | `sudo systemctl status valbot` (bot may be down) |
| WebSocket not connecting | Verify nginx has `Upgrade` and `Connection` headers |
| SSL certificate expired | `sudo certbot renew` (should auto-renew) |
| Database locked | `ps aux | grep valbot` (check for duplicate processes) |
| Port 3000 in use | `sudo lsof -i :3000` to find the conflicting process |

## Tech Stack

- **Runtime:** Node.js 22, TypeScript 5, pnpm
- **Frontend:** React 19, Vite 8, Tailwind CSS v4, shadcn/ui, Zustand
- **Backend:** Fastify 5, SQLite (better-sqlite3 + Drizzle ORM)
- **Blockchain:** @nktkas/hyperliquid SDK, viem, Pyth Network
- **Real-time:** WebSocket (ws)
