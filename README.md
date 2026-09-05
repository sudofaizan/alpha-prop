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

## User flow

1. **Register** at `/register.html` — empty portal, no demo data
2. **Dashboard** — empty until you buy a challenge
3. **Challenges** — pick plan → accept terms → **Pay now** (mock payment)
4. **My Accounts** — purchased challenge appears immediately
5. **Billing / Notifications** — real data from your purchases only

---

## Default credentials

| Role | Email | Password |
|------|-------|----------|
| Admin (seeded on first DB init) | `admin@alphafx.com` | `AdminFX2026!` |
| Traders | Register at `/register.html` | your choice |

Admin panel: **http://localhost:3000/admin.html**

Change admin password in `backend/.env` before any production deploy:

```env
ALPHAFX_ADMIN_PASSWORD=your-strong-password
ALPHAFX_SECRET_KEY=your-long-random-secret
```

---

## Project structure

```text
alpha-prop/
├── backend/           # FastAPI + SQLite
│   ├── app/           # routes, models, services
│   ├── run.sh         # one-command local API start
│   ├── .env.example   # copy to .env (gitignored)
│   └── requirements.txt
├── website/           # static HTML/JS/CSS portal
│   ├── js/config.js   # API URL (localhost by default)
│   └── ...
└── deploy.sh          # optional S3 deploy (uses your local AWS CLI)
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

Interactive docs: **http://127.0.0.1:8000/docs**

---

## Configuration

### Backend (`backend/.env`)

Copy from `.env.example`:

```bash
cp backend/.env.example backend/.env
```

Key variables:

| Variable | Default | Purpose |
|----------|---------|---------|
| `ALPHAFX_SECRET_KEY` | change-me | JWT/session signing |
| `ALPHAFX_DATABASE_URL` | sqlite:///./alphafx.db | Database |
| `ALPHAFX_CORS_ORIGINS` | localhost:3000 | Allowed frontend origins |
| `ALPHAFX_ADMIN_EMAIL` | admin@alphafx.com | Seed admin user |
| `ALPHAFX_ADMIN_PASSWORD` | AdminFX2026! | Seed admin password |

### Frontend (`website/js/config.js`)

```javascript
window.ALPHAFX_API = "http://localhost:8000";
```

For production, point this at your deployed API URL.

---

## Optional: deploy static site to S3

Requires AWS CLI configured **on your machine** (credentials are never committed):

```bash
AWS_PROFILE=your-profile AWS_DEFAULT_REGION=ap-south-1 ./deploy.sh
```

Or set a custom bucket:

```bash
ALPHAFX_BUCKET=my-portal-bucket AWS_PROFILE=your-profile ./deploy.sh
```

---

## Troubleshooting

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
- [ ] Real Stripe payment
- [ ] MT5 trade sync + live statistics
- [ ] EC2 deploy script + nginx
