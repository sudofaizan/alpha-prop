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
TICK_HUB_SERVICE="alphafx-tick-hub"
TICK_HUB_DIR="$ROOT/services/tick-hub"
NGINX_CONF="/etc/nginx/conf.d/alphafx.conf"
WEB_ROOT="/var/www/alphafx"

log() { printf '\n==> %s\n' "$*"; }
die() { echo "ERROR: $*" >&2; exit 1; }

[[ -d "$BACKEND" && -d "$WEBSITE" ]] || die "Run this from the repo root (need backend/ and website/)."

if [[ "$(id -u)" -eq 0 ]]; then
  die "Do not run as root. Run as ec2-user: ./ec2_deploy.sh"
fi

command -v sudo >/dev/null || die "sudo is required"

install_os_packages() {
  local pkgs=()
  command -v git >/dev/null || pkgs+=(git)
  command -v nginx >/dev/null || pkgs+=(nginx)
  # Amazon Linux ships curl-minimal; full "curl" package conflicts — do not install it
  if ! command -v curl >/dev/null; then
    pkgs+=(curl-minimal)
  fi
  if ! command -v python3.11 >/dev/null 2>&1 && ! command -v python3 >/dev/null 2>&1; then
    pkgs+=(python3.11 python3.11-pip)
  fi

  if command -v dnf >/dev/null; then
    sudo dnf update -y
    if ((${#pkgs[@]})); then
      sudo dnf install -y "${pkgs[@]}" || {
        # Fallback if python3.11 unavailable on this AMI
        local fallback=()
        for p in "${pkgs[@]}"; do
          [[ "$p" == python3.11* ]] && continue
          fallback+=("$p")
        done
        if ! command -v python3 >/dev/null; then
          fallback+=(python3 python3-pip)
        fi
        ((${#fallback[@]})) && sudo dnf install -y "${fallback[@]}"
      }
    fi
    if ! command -v python3.11 >/dev/null 2>&1 && ! command -v python3 >/dev/null 2>&1; then
      sudo dnf install -y python3 python3-pip
    fi
  elif command -v yum >/dev/null; then
    sudo yum update -y
    if ((${#pkgs[@]})); then
      sudo yum install -y "${pkgs[@]}"
    fi
    if ! command -v python3 >/dev/null; then
      sudo yum install -y python3 python3-pip
    fi
  else
    die "Unsupported OS — use Amazon Linux 2 or 2023"
  fi
}

# ── OS packages ──────────────────────────────────────────────────────────────
log "Installing system packages (nginx, git, Python)…"
install_os_packages
command -v curl >/dev/null || die "curl not found (expected curl-minimal on Amazon Linux)"

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

SECRET_KEY="${ALPHAFX_SECRET_KEY:-$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')}"
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

# Tick hub: same EC2 by default (mock until Windows MT5 EA is wired)
TICK_HUB_MOCK="${ALPHAFX_TICK_HUB_MOCK:-1}"
TICK_HUB_WS="${ALPHAFX_TICK_HUB_WS:-ws://127.0.0.1:9002}"

log "Writing backend/.env…"
cat > .env <<EOF
ALPHAFX_ENV=production
ALPHAFX_SECRET_KEY=${SECRET_KEY}
ALPHAFX_DATABASE_URL=sqlite:///./alphafx.db
ALPHAFX_CORS_ORIGINS=${PUBLIC_ORIGIN}
ALPHAFX_ADMIN_EMAIL=admin@alphafx.com
ALPHAFX_ADMIN_PASSWORD=${ADMIN_PASSWORD}
ALPHAFX_ADMIN_NAME=AlphaFX Admin
ALPHAFX_TICK_MOCK=false
ALPHAFX_TICK_HUB_WS=${TICK_HUB_WS}
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

log "Publishing static site to ${WEB_ROOT}…"
sudo mkdir -p "$WEB_ROOT"
sudo rsync -a --delete "$WEBSITE/" "$WEB_ROOT/"
sudo chmod -R a+rX "$WEB_ROOT"

# ── Tick hub (systemd) ────────────────────────────────────────────────────────
log "Setting up tick hub service…"
if [[ -d "$TICK_HUB_DIR" ]]; then
  if [[ ! -d "$TICK_HUB_DIR/.venv" ]]; then
    "$PYTHON" -m venv "$TICK_HUB_DIR/.venv"
  fi
  # shellcheck disable=SC1091
  source "$TICK_HUB_DIR/.venv/bin/activate"
  pip install -q --upgrade pip
  pip install -q -r "$TICK_HUB_DIR/requirements.txt"
  deactivate

  sudo tee "/etc/systemd/system/${TICK_HUB_SERVICE}.service" > /dev/null <<EOF
[Unit]
Description=AlphaFX Tick Hub (MT5 ingest + WebSocket)
After=network.target

[Service]
User=$(whoami)
Group=$(id -gn)
WorkingDirectory=${TICK_HUB_DIR}
Environment=TICK_HUB_MOCK=${TICK_HUB_MOCK}
Environment=PATH=${TICK_HUB_DIR}/.venv/bin:/usr/bin
ExecStart=${TICK_HUB_DIR}/.venv/bin/python hub.py --mock
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

  # When mock is off, run ingest-only (real ticks from MT5 EA on TCP :9001)
  if [[ "$TICK_HUB_MOCK" != "1" && "$TICK_HUB_MOCK" != "true" ]]; then
    sudo sed -i 's/ hub.py --mock/ hub.py/' "/etc/systemd/system/${TICK_HUB_SERVICE}.service"
  fi

  sudo systemctl daemon-reload
  sudo systemctl enable "${TICK_HUB_SERVICE}"
  sudo systemctl restart "${TICK_HUB_SERVICE}"
else
  log "No services/tick-hub — skipping tick hub systemd"
fi

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
# Amazon Linux ships default.conf with server_name _ — remove it or our vhost is ignored
sudo rm -f /etc/nginx/conf.d/default.conf

sudo tee "$NGINX_CONF" > /dev/null <<EOF
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    root ${WEB_ROOT};
    index dashboard.html index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location /ws/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_read_timeout 3600s;
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
if [[ -d "$TICK_HUB_DIR" ]]; then
  curl -sf http://127.0.0.1:9003/health | grep -q '"status":"ok"' || die "Tick hub health check failed (port 9003)"
fi
STATIC_CODE="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1/register.html 2>/dev/null || echo '000')"
[[ "$STATIC_CODE" == "200" ]] || die "nginx static check failed (GET /register.html → HTTP ${STATIC_CODE}). Try: curl -v http://127.0.0.1/register.html"

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
  sudo systemctl status ${TICK_HUB_SERVICE}
  sudo journalctl -u ${SERVICE_NAME} -f
  sudo journalctl -u ${TICK_HUB_SERVICE} -f
  sudo tail -f /var/log/nginx/error.log
  curl -s http://127.0.0.1:9003/health

To update after git pull:
  cd ${ROOT} && git pull && ${ROOT}/ec2_deploy.sh

EOF
