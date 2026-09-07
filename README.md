# Alpha Prop — AlphaFX Trader Portal

Prop firm trader portal with a **static frontend** (`website/`) and a **Python/FastAPI backend** with SQLite.

No AWS credentials are stored in this repo. Local development uses `localhost` only.

## Prerequisites

| Tool | Version |
|------|---------|
| Python | 3.11+ (3.14 tested) |
| pip | latest |
| Git | any recent |

Optional for S3 deploy: [AWS CLI](https://aws.amazon.com/cli/) configured on your machine (not committed to git).

---

## Local development (for all developers)

### 1. Clone the repo

```bash
git clone https://github.com/sudofaizan/alpha-prop.git
cd alpha-prop
```

### 2. Start the API (Terminal 1)

```bash
cd backend
./run.sh
```

On first run, `./run.sh` will:

- Create a Python virtualenv (`.venv/`)
- Install dependencies from `requirements.txt`
- Copy `.env.example` → `.env` if missing
- Start the API at **http://127.0.0.1:8000**

Verify:

```bash
curl http://127.0.0.1:8000/health
```

### 3. Start the website (Terminal 2)

```bash
cd website
python3 -m http.server 3000
```

Open **http://localhost:3000/register.html**

The frontend talks to the API at `http://localhost:8000` (set in `website/js/config.js`).

### 4. Reset the database (optional)

If you need a fresh DB (schema changes, wipe demo data):

```bash
cd backend
rm -f alphafx.db
source .venv/bin/activate
python3 -c "from app.seed import init_db; init_db()"
```

---

## Deploy to Amazon Linux EC2 (production)

One script installs **nginx** (static site + reverse proxy), **FastAPI** (systemd service), and **SQLite**.

### Architecture

```text
Browser → EC2:80 (nginx) → /          → website/ (static HTML/JS)
                          → /api/*     → uvicorn :8000 (FastAPI)
                          → /docs      → uvicorn :8000
```

### Step 1 — AWS Console

Launch **Amazon Linux 2023** (or Amazon Linux 2) EC2 instance.

**Security group inbound rules:**

| Port | Source | Purpose |
|------|--------|---------|
| 22 | Your IP | SSH |
| 80 | 0.0.0.0/0 | HTTP portal |
| 443 | 0.0.0.0/0 | HTTPS (optional, later) |

### Step 2 — SSH into EC2

From your laptop:

```bash
ssh -i /path/to/your-key.pem ec2-user@YOUR_EC2_PUBLIC_IP
```

### Step 3 — Clone and run deploy script

On the EC2 instance:

```bash
git clone https://github.com/sudofaizan/alpha-prop.git
cd alpha-prop
chmod +x ec2_deploy.sh
./ec2_deploy.sh
```

The script automatically:

1. Installs `git`, `nginx`, Python 3.11 (or Python 3)
2. Creates backend virtualenv and installs pip packages
3. Writes production `backend/.env` (random secret key, CORS for your EC2 IP)
4. Initializes SQLite database + admin user
5. Sets `website/js/config.js` to use same-origin API (`window.location.origin`)
6. Registers **systemd** service `alphafx-api` (auto-start on boot)
7. Configures **nginx** to serve the portal and proxy `/api` to FastAPI
8. Runs health checks and prints your live URLs

**Optional environment variables** (set before running the script):

```bash
export ALPHAFX_PUBLIC_URL=https://yourdomain.com   # if using a domain
export ALPHAFX_ADMIN_PASSWORD='YourStrongAdminPass!'
export ALPHAFX_SECRET_KEY='your-long-random-secret' # auto-generated if omitted

./ec2_deploy.sh
```

### Step 4 — Open the portal

Replace `YOUR_EC2_PUBLIC_IP` with your instance IP:

| Page | URL |
|------|-----|
| Register | http://YOUR_EC2_PUBLIC_IP/register.html |
| Admin | http://YOUR_EC2_PUBLIC_IP/admin.html |
| API docs | http://YOUR_EC2_PUBLIC_IP/docs |
| Health | http://YOUR_EC2_PUBLIC_IP/health |

**Default admin** (change in `backend/.env` after first deploy):

| Email | Password |
|-------|----------|
| `admin@alphafx.com` | `AdminFX2026!` (or your `ALPHAFX_ADMIN_PASSWORD`) |

### Update after code changes

On EC2:

```bash
cd ~/alpha-prop
git pull
./ec2_deploy.sh
```

Re-running the script is safe — it refreshes deps, restarts services, and keeps the existing database.

### EC2 troubleshooting

```bash
# API status + logs
sudo systemctl status alphafx-api
sudo journalctl -u alphafx-api -f

# nginx status + logs
sudo systemctl status nginx
sudo tail -f /var/log/nginx/error.log

# Local checks on EC2
curl -s http://127.0.0.1:8000/health
curl -I http://127.0.0.1/register.html
```

| Problem | Fix |
|---------|-----|
| `curl` package conflict on dnf | Fixed in latest `ec2_deploy.sh` — run `git pull && ./ec2_deploy.sh` |
| `conflicting server name "_"` / static check failed | Remove default nginx site; script now copies site to `/var/www/alphafx` — `git pull && ./ec2_deploy.sh` |
| Site not loading | Security group must allow TCP **80** |
| CORS errors | Set `ALPHAFX_PUBLIC_URL` to exact browser URL, re-run `./ec2_deploy.sh` |
| API 502 | `sudo systemctl restart alphafx-api` then check logs |
| Registration 500 | Stop API, `rm backend/alphafx.db`, re-run `./ec2_deploy.sh` |

### HTTPS with a domain (optional)

Point your domain A-record to the EC2 IP, then on EC2:

```bash
sudo dnf install -y certbot python3-certbot-nginx   # Amazon Linux 2023
# or: sudo yum install -y certbot python3-certbot-nginx   # Amazon Linux 2

sudo certbot --nginx -d yourdomain.com
export ALPHAFX_PUBLIC_URL=https://yourdomain.com
./ec2_deploy.sh
```

---

## User flow

1. **Register** at `/register.html` — empty portal, no demo data
2. **Dashboard** — empty until you buy a challenge
3. **Challenges** — pick plan → accept terms → **Pay now** (mock payment)
4. **My Accounts** — purchased challenge appears immediately
5. **Billing / Notifications** — real data from your purchases only

---

## Default credentials (local dev)

| Role | Email | Password |
|------|-------|----------|
| Admin (seeded) | `admin@alphafx.com` | `AdminFX2026!` |
| Traders | Register at `/register.html` | your choice |

Admin panel: **http://localhost:3000/admin.html**

Change admin password in `backend/.env` before any production deploy.

---

## Project structure

```text
alpha-prop/
├── backend/           # FastAPI + SQLite
│   ├── app/           # routes, models, services
│   ├── run.sh         # local dev API start
│   ├── .env.example   # copy to .env (gitignored)
│   └── requirements.txt
├── website/           # static HTML/JS/CSS portal
│   ├── js/config.js   # API URL (localhost by default)
│   └── ...
├── ec2_deploy.sh      # one-shot EC2 production deploy
└── deploy.sh          # optional S3 static deploy
```

---

## API (v0.2)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/auth/register` | Create account + login |
| POST | `/api/v1/auth/login` | Login (single session) |
| GET | `/api/v1/auth/me` | Current user |
| POST | `/api/v1/auth/logout` | Logout |
| GET | `/api/v1/plans` | Challenge catalog |
| GET | `/api/v1/dashboard` | Dashboard summary |
| GET | `/api/v1/accounts` | User's challenge accounts |
| GET | `/api/v1/accounts/{id}` | Account detail |
| POST | `/api/v1/checkout/pay` | Mock payment → creates account |
| GET | `/api/v1/billing` | User billing history |
| GET | `/api/v1/notifications` | User notifications |
| GET | `/api/v1/admin/stats` | Admin stats |
| GET | `/api/v1/admin/users` | All users |
| PATCH | `/api/v1/admin/users/{id}/block` | Block/unblock user |

Interactive docs: **http://127.0.0.1:8000/docs** (local) or **http://YOUR_EC2_IP/docs** (production)

---

## Configuration

### Backend (`backend/.env`)

| Variable | Default | Purpose |
|----------|---------|---------|
| `ALPHAFX_SECRET_KEY` | change-me | JWT/session signing |
| `ALPHAFX_DATABASE_URL` | sqlite:///./alphafx.db | Database |
| `ALPHAFX_CORS_ORIGINS` | localhost:3000 | Allowed frontend origins |
| `ALPHAFX_ADMIN_EMAIL` | admin@alphafx.com | Seed admin user |
| `ALPHAFX_ADMIN_PASSWORD` | AdminFX2026! | Seed admin password |

### Frontend (`website/js/config.js`)

Local dev:

```javascript
window.ALPHAFX_API = "http://localhost:8000";
```

Production (set automatically by `ec2_deploy.sh`):

```javascript
window.ALPHAFX_API = window.location.origin;
```

---

## Optional: deploy static site to S3

Requires AWS CLI configured **on your machine** (credentials are never committed):

```bash
AWS_PROFILE=your-profile AWS_DEFAULT_REGION=ap-south-1 ./deploy.sh
```

If using S3 for frontend + EC2 for API only, set `website/js/config.js` to your EC2 API URL and add the S3 website origin to `ALPHAFX_CORS_ORIGINS`.

---

## Live market data (MT5 tick hub)

Phase 1–4: **ticks + bar history → WebSocket/HTTP → Trade page**.

### Local dev (mock ticks, no MT5)

```bash
# Terminal 1 — API (mock ticks built-in when ALPHAFX_TICK_MOCK=true)
cd backend && ./run.sh

# Optional Terminal 2 — standalone tick hub with --mock
cd services/tick-hub && TICK_HUB_MOCK=1 ./run.sh
# Then in backend/.env:
#   ALPHAFX_TICK_HUB_WS=ws://127.0.0.1:9002
#   ALPHAFX_TICK_HUB_HTTP=http://127.0.0.1:9003
#   ALPHAFX_TICK_MOCK=false
```

Open **http://127.0.0.1:3000/trade.html** (or your static server) while logged in — watchlist and chart update live.

### Windows EC2 (MT5 → tick hub)

1. Install MT5, copy **`AlphaFXBridge.mq5`** into `MQL5/Experts/`, compile, attach **once** to any chart:
   - Live ticks (OnTick + timer poll)
   - M1 OHLC history (`CopyRates`, every 60s)
2. Run tick hub on Linux EC2 (or Windows if co-located):

```bash
cd services/tick-hub
pip install -r requirements.txt
python hub.py   # TCP :9001 (EAs), WS :9002 (portal), health+bars :9003
```

3. EA inputs: `InpHubHost=<tick-hub-ip>`, `InpHubPort=9001`, symbols list.
4. On Linux portal EC2 `backend/.env`:

```env
ALPHAFX_TICK_MOCK=false
ALPHAFX_TICK_HUB_WS=ws://127.0.0.1:9002
ALPHAFX_TICK_HUB_HTTP=http://127.0.0.1:9003
```

Security group: allow **9001** from Windows MT5 IP to Linux tick hub; **9002** from Linux EC2 only (not public).

Verify bar cache after AlphaFXBridge connects:

```bash
curl -s "http://127.0.0.1:9003/bars?symbol=XAUUSD&limit=5"
curl -s "http://127.0.0.1:8000/api/v1/market/history?symbol=XAUUSD&limit=5"
# Chart badge should show "MT5 | XAUUSD · N bars" (not "Demo")
```

### Architecture

```
MT5 AlphaFXBridge  ── ticks + CopyRates bars ── TCP :9001 ──► Tick Hub ── WS :9002 ──► FastAPI /ws/quotes ──► Browser
                                                              │
                                                              └── HTTP :9003 /bars ──► FastAPI /market/history
```

---

## Local troubleshooting

| Problem | Fix |
|---------|-----|
| Top bar shows "Loading…" | Hard refresh (Cmd+Shift+R). Ensure API is running and `api.js` loads before `auth.js`. |
| CORS errors | Add your frontend origin to `ALPHAFX_CORS_ORIGINS` in `backend/.env`. |
| Registration 500 | Delete `backend/alphafx.db` and re-run seed (see above). |
| Port 8000 in use | `lsof -ti :8000 \| xargs kill -9` then restart `./run.sh`. |

---

## Roadmap

- [x] Static Capiffy-style portal
- [x] Auth + single session
- [x] Fresh user registration
- [x] Mock challenge purchase
- [x] Dynamic accounts, dashboard, billing, notifications
- [x] Admin panel (block users)
- [x] EC2 deploy script + nginx
- [x] Tick hub + WebSocket quotes + Trade terminal shell (mock/MT5)
- [x] MT5 M1 bar history (AlphaFXBridge EA → tick hub → /market/history)
- [ ] MT5 Manager API order routing (web BUY/SELL)
- [ ] TradingView Charting Library (Capiffy parity)
- [ ] Real Stripe payment
- [ ] MT5 trade sync + live statistics
