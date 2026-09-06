#!/usr/bin/env bash
# AlphaFX — one-shot deploy on Amazon Linux EC2 (nginx + FastAPI + SQLite)
#
# Usage (on EC2, after cloning):
#   cd alpha-prop
#   chmod +x ec2_deploy.sh
#   ./ec2_deploy.sh
#
# Optional env vars:
#   ALPHAFX_PUBLIC_URL=https://yourdomain.com   # CORS + printed links (default: http://EC2_PUBLIC_IP)
#   ALPHAFX_ADMIN_PASSWORD=your-admin-password  # default: AdminFX2026!
#   ALPHAFX_SECRET_KEY=long-random-string         # auto-generated if omitted
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND="$ROOT/backend"
WEBSITE="$ROOT/website"
SERVICE_NAME="alphafx-api"
NGINX_CONF="/etc/nginx/conf.d/alphafx.conf"

log() { printf '\n==> %s\n' "$*"; }
die() { echo "ERROR: $*" >&2; exit 1; }

[[ -d "$BACKEND" && -d "$WEBSITE" ]] || die "Run this from the repo root (need backend/ and website/)."

if [[ "$(id -u)" -eq 0 ]]; then
  die "Do not run as root. Run as ec2-user: ./ec2_deploy.sh"
fi

command -v sudo >/dev/null || die "sudo is required"

# ── OS packages ──────────────────────────────────────────────────────────────
log "Installing system packages (nginx, git, Python)…"
if command -v dnf >/dev/null; then
  sudo dnf update -y
  sudo dnf install -y git nginx curl
  if ! command -v python3.11 >/dev/null 2>&1; then
    sudo dnf install -y python3.11 python3.11-pip 2>/dev/null || sudo dnf install -y python3 python3-pip
  fi
elif command -v yum >/dev/null; then
  sudo yum update -y
  sudo yum install -y git nginx curl python3 python3-pip
else
  die "Unsupported OS — use Amazon Linux 2 or 2023"
fi

if command -v python3.11 >/dev/null; then
  PYTHON=python3.11
elif command -v python3 >/dev/null; then
  PYTHON=python3
else
  die "Python 3 not found after install"
fi
log "Using $PYTHON ($($PYTHON --version))"

# ── Public URL / CORS ───────────────────────────────────────────────────────
PUBLIC_IP=""
if curl -sf --max-time 2 http://169.254.169.254/latest/meta-data/public-ipv4 >/dev/null 2>&1; then
  PUBLIC_IP="$(curl -sf --max-time 2 http://169.254.169.254/latest/meta-data/public-ipv4 || true)"
fi
if [[ -z "$PUBLIC_IP" ]]; then
  PUBLIC_IP="$(curl -sf --max-time 5 https://checkip.amazonaws.com 2>/dev/null | tr -d '[:space:]' || echo "")"
fi

if [[ -n "${ALPHAFX_PUBLIC_URL:-}" ]]; then
  PUBLIC_ORIGIN="${ALPHAFX_PUBLIC_URL%/}"
elif [[ -n "$PUBLIC_IP" ]]; then
  PUBLIC_ORIGIN="http://${PUBLIC_IP}"
else
  PUBLIC_ORIGIN="http://127.0.0.1"
fi

if [[ "$PUBLIC_ORIGIN" != http* ]]; then
  PUBLIC_ORIGIN="http://${PUBLIC_ORIGIN}"
fi

SECRET_KEY="${ALPHAFX_SECRET_KEY:-$(openssl rand -hex 32)}"
ADMIN_PASSWORD="${ALPHAFX_ADMIN_PASSWORD:-AdminFX2026!}"

log "Public URL / CORS origin: $PUBLIC_ORIGIN"

# ── Backend venv + deps ───────────────────────────────────────────────────────
log "Setting up Python virtualenv…"
cd "$BACKEND"
if [[ ! -d .venv ]]; then
  "$PYTHON" -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate
pip install -q --upgrade pip
pip install -q -r requirements.txt

log "Writing backend/.env…"
cat > .env <<EOF
ALPHAFX_ENV=production
ALPHAFX_SECRET_KEY=${SECRET_KEY}
ALPHAFX_DATABASE_URL=sqlite:///./alphafx.db
ALPHAFX_CORS_ORIGINS=${PUBLIC_ORIGIN}
ALPHAFX_ADMIN_EMAIL=admin@alphafx.com
ALPHAFX_ADMIN_PASSWORD=${ADMIN_PASSWORD}
ALPHAFX_ADMIN_NAME=AlphaFX Admin
EOF
chmod 600 .env

log "Initializing database…"
python -c "from app.seed import init_db; init_db()"

deactivate

# ── Frontend API URL ──────────────────────────────────────────────────────────
log "Configuring website/js/config.js for production…"
cat > "$WEBSITE/js/config.js" <<'EOF'
/** API base URL — same origin; nginx proxies /api to uvicorn */
window.ALPHAFX_API = window.ALPHAFX_API || window.location.origin;
EOF

log "Setting website file permissions for nginx…"
chmod -R a+rX "$WEBSITE"

# ── systemd ───────────────────────────────────────────────────────────────────
log "Installing systemd service: ${SERVICE_NAME}…"
sudo tee "/etc/systemd/system/${SERVICE_NAME}.service" > /dev/null <<EOF
[Unit]
Description=AlphaFX FastAPI
After=network.target

[Service]
User=$(whoami)
Group=$(id -gn)
WorkingDirectory=${BACKEND}
Environment=PATH=${BACKEND}/.venv/bin:/usr/bin
ExecStart=${BACKEND}/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable "${SERVICE_NAME}"
sudo systemctl restart "${SERVICE_NAME}"

# ── nginx ─────────────────────────────────────────────────────────────────────
log "Configuring nginx…"
sudo tee "$NGINX_CONF" > /dev/null <<EOF
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    root ${WEBSITE};
    index dashboard.html index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location /health {
        proxy_pass http://127.0.0.1:8000;
    }

    location /docs {
        proxy_pass http://127.0.0.1:8000;
    }

    location /openapi.json {
        proxy_pass http://127.0.0.1:8000;
    }

    location / {
        try_files \$uri \$uri/ =404;
    }
}
EOF

sudo nginx -t
sudo systemctl enable nginx
sudo systemctl restart nginx

# ── Health checks ─────────────────────────────────────────────────────────────
log "Running health checks…"
sleep 2
curl -sf http://127.0.0.1:8000/health | grep -q '"status":"ok"' || die "API health check failed"
curl -sf -o /dev/null http://127.0.0.1/register.html || die "nginx static check failed"

# ── Done ──────────────────────────────────────────────────────────────────────
cat <<EOF

╔══════════════════════════════════════════════════════════════╗
║  AlphaFX deploy complete                                     ║
╠══════════════════════════════════════════════════════════════╣
║  Portal:    ${PUBLIC_ORIGIN}/register.html
║  Admin:      ${PUBLIC_ORIGIN}/admin.html
║  API docs:   ${PUBLIC_ORIGIN}/docs
║  Health:     ${PUBLIC_ORIGIN}/health
╠══════════════════════════════════════════════════════════════╣
║  Admin email:    admin@alphafx.com
║  Admin password: ${ADMIN_PASSWORD}
╠══════════════════════════════════════════════════════════════╣
║  EC2 security group must allow inbound TCP 80 (and 443 later)
║  Change admin password in: ${BACKEND}/.env
╚══════════════════════════════════════════════════════════════╝

Useful commands:
  sudo systemctl status ${SERVICE_NAME}
  sudo journalctl -u ${SERVICE_NAME} -f
  sudo tail -f /var/log/nginx/error.log

To update after git pull:
  cd ${ROOT} && git pull && ${ROOT}/ec2_deploy.sh

EOF
