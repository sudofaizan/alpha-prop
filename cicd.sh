#!/usr/bin/env bash
# AlphaFX — poll GitHub for changes and run ec2_deploy.sh when updates land.
#
# Usage (on EC2):
#   cd ~/alpha-prop
#   chmod +x cicd.sh
#   ./cicd.sh                  # foreground loop (Ctrl+C to stop)
#   nohup ./cicd.sh >> logs/cicd.log 2>&1 &   # background
#
# systemd (optional — install once on EC2):
#   sudo tee /etc/systemd/system/alphafx-cicd.service <<'UNIT'
#   [Unit]
#   Description=AlphaFX GitHub poll + deploy
#   After=network-online.target
#   Wants=network-online.target
#
#   [Service]
#   Type=simple
#   User=ec2-user
#   WorkingDirectory=/home/ec2-user/alpha-prop
#   ExecStart=/home/ec2-user/alpha-prop/cicd.sh
#   Restart=always
#   RestartSec=30
#
#   [Install]
#   WantedBy=multi-user.target
#   UNIT
#   sudo systemctl daemon-reload
#   sudo systemctl enable --now alphafx-cicd
#
# Optional env:
#   ALPHAFX_BRANCH=main        # branch to track (default: current branch)
#   ALPHAFX_POLL_SECS=300      # poll interval in seconds (default: 300 = 5 min)
#   ALPHAFX_REMOTE=origin      # git remote name (default: origin)
#   ALPHAFX_SKIP_FETCH=1       # skip git fetch (offline testing only)
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
DEPLOY="$ROOT/ec2_deploy.sh"
LOG_DIR="$ROOT/logs"
LOG_FILE="$LOG_DIR/cicd.log"
LOCK_FILE="/tmp/alphafx-cicd.lock"
POLL_SECS="${ALPHAFX_POLL_SECS:-300}"
REMOTE="${ALPHAFX_REMOTE:-origin}"

log() {
  printf '[%s] %s\n' "$(date -u '+%Y-%m-%d %H:%M:%S UTC')" "$*"
}

log_both() {
  log "$*" | tee -a "$LOG_FILE"
}

cleanup() {
  rm -f "$LOCK_FILE"
}

on_exit() {
  local code=$?
  cleanup
  if (( code != 0 && code != 130 )); then
    log_both "cicd.sh exiting with code ${code}"
  fi
}

on_signal() {
  log_both "Received stop signal — shutting down cicd loop"
  exit 0
}

[[ -d "$ROOT/.git" ]] || { echo "ERROR: not a git repo: $ROOT" >&2; exit 1; }
[[ -x "$DEPLOY" ]] || { echo "ERROR: missing or not executable: $DEPLOY" >&2; exit 1; }

if [[ "$(id -u)" -eq 0 ]]; then
  echo "ERROR: do not run as root. Use ec2-user." >&2
  exit 1
fi

mkdir -p "$LOG_DIR"
touch "$LOG_FILE"

BRANCH="${ALPHAFX_BRANCH:-$(git -C "$ROOT" rev-parse --abbrev-ref HEAD)}"
if [[ "$BRANCH" == "HEAD" ]]; then
  BRANCH="main"
fi

trap cleanup EXIT
trap on_signal INT TERM

log_both "AlphaFX CI/CD watcher started (branch=${BRANCH}, remote=${REMOTE}, poll=${POLL_SECS}s)"

while true; do
  if [[ -f "$LOCK_FILE" ]]; then
    log "Deploy already in progress (lock: $LOCK_FILE) — skipping poll"
    sleep "$POLL_SECS"
    continue
  fi

  cd "$ROOT"

  if [[ "${ALPHAFX_SKIP_FETCH:-}" != "1" ]]; then
    if ! git fetch "$REMOTE" "$BRANCH" --quiet 2>>"$LOG_FILE"; then
      log_both "git fetch failed — will retry in ${POLL_SECS}s"
      sleep "$POLL_SECS"
      continue
    fi
  fi

  LOCAL="$(git rev-parse HEAD)"
  REMOTE_REF="$REMOTE/$BRANCH"

  if ! git rev-parse --verify "$REMOTE_REF" >/dev/null 2>&1; then
    log_both "Remote ref ${REMOTE_REF} not found — will retry in ${POLL_SECS}s"
    sleep "$POLL_SECS"
    continue
  fi

  UPSTREAM="$(git rev-parse "$REMOTE_REF")"

  if [[ "$LOCAL" == "$UPSTREAM" ]]; then
    log "No changes on ${REMOTE}/${BRANCH} (${LOCAL:0:7}) — next check in ${POLL_SECS}s"
    sleep "$POLL_SECS"
    continue
  fi

  log_both "Change detected: ${LOCAL:0:7} → ${UPSTREAM:0:7} — deploying…"
  touch "$LOCK_FILE"

  if git pull "$REMOTE" "$BRANCH" --ff-only >>"$LOG_FILE" 2>&1; then
    log_both "git pull OK — running ec2_deploy.sh"
    if "$DEPLOY" >>"$LOG_FILE" 2>&1; then
      log_both "Deploy complete ($(git rev-parse --short HEAD))"
    else
      log_both "ERROR: ec2_deploy.sh failed (repo at $(git rev-parse --short HEAD))"
    fi
  else
    log_both "ERROR: git pull --ff-only failed — manual fix required"
  fi

  rm -f "$LOCK_FILE"
  sleep "$POLL_SECS"
done
