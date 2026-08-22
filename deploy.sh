#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${ANYSCREEN_DIR:-$HOME/anyscreen}"
COMPOSE_PROJECT_NAME="anyscreen"
DATA_VOLUME="${COMPOSE_PROJECT_NAME}_anyscreen_data"
DEFAULT_REPO_URL="https://github.com/Speedware/anyscreen.git"

REPO_URL=""
BACKUP_ONLY=""
RESTORE_FROM=""
MODE=""

usage() {
  cat <<'USAGE'
Usage:
  ./deploy.sh [git-repo-url]
  ./deploy.sh --backup [output.tar.gz]
  ./deploy.sh --restore <backup.tar.gz> [git-repo-url]

Run with no arguments for an interactive menu: update, fresh install, or migrate.
Use --backup / --restore to script those same actions without prompts.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --backup)
      shift
      if [[ $# -gt 0 && "$1" != --* ]]; then
        BACKUP_ONLY="$1"
        shift
      else
        BACKUP_ONLY="anyscreen-backup-$(date +%Y%m%d-%H%M%S).tar.gz"
      fi
      ;;
    --restore)
      RESTORE_FROM="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      REPO_URL="$1"
      shift
      ;;
  esac
done

log() { printf '\n\033[1;34m==>\033[0m %s\n' "$1"; }

as_root() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

do_backup() {
  local dest="$1"
  if ! docker volume inspect "$DATA_VOLUME" &>/dev/null; then
    echo "Volume $DATA_VOLUME does not exist — nothing to back up." >&2
    exit 1
  fi
  mkdir -p "$(dirname "$dest")"
  local backup_dir backup_name
  backup_dir="$(cd "$(dirname "$dest")" && pwd)"
  backup_name="$(basename "$dest")"
  docker run --rm \
    -v "$DATA_VOLUME:/data" \
    -v "$backup_dir:/backup" \
    alpine tar czf "/backup/$backup_name" -C / data
  echo "Wrote $backup_dir/$backup_name"
}

if [[ -n "$BACKUP_ONLY" ]]; then
  log "Backing up data volume to $BACKUP_ONLY"
  do_backup "$BACKUP_ONLY"
  exit 0
fi

if [[ -z "$RESTORE_FROM" ]]; then
  existing=false
  [[ -d "$PROJECT_DIR" && -n "$(ls -A "$PROJECT_DIR" 2>/dev/null)" ]] && existing=true
  command -v docker &>/dev/null && docker volume inspect "$DATA_VOLUME" &>/dev/null && existing=true

  echo ""
  if [[ "$existing" == true ]]; then
    echo "An existing Anyscreen installation was detected on this server."
    echo "  1) Update        — pull the latest code, keep all data (uploads, database, pairings, schedules)"
    echo "  2) Fresh install — delete everything and start over (existing data will be LOST)"
    echo "  3) Migrate       — import a backup from another server, or export this server's data to move it"
    read -rp "Choose [1/2/3] (default 1): " choice < /dev/tty
    case "$choice" in
      2) MODE="fresh" ;;
      3) MODE="migrate" ;;
      *) MODE="update" ;;
    esac
  else
    echo "No existing Anyscreen installation detected on this server."
    echo "  1) Fresh install — set up a new instance"
    echo "  2) Import        — restore data migrated from another server"
    read -rp "Choose [1/2] (default 1): " choice < /dev/tty
    case "$choice" in
      2) MODE="migrate" ;;
      *) MODE="fresh" ;;
    esac
  fi

  if [[ "$MODE" == "migrate" ]]; then
    read -rp "Import a backup here, or export this server's data? [import/export] (default import): " direction < /dev/tty
    if [[ "$direction" =~ ^[Ee] ]]; then
      default_name="anyscreen-backup-$(date +%Y%m%d-%H%M%S).tar.gz"
      read -rp "Save backup to [$default_name]: " out_path < /dev/tty
      log "Backing up data volume to ${out_path:-$default_name}"
      do_backup "${out_path:-$default_name}"
      exit 0
    fi
    read -rp "Path to the backup file to import: " RESTORE_FROM < /dev/tty
    MODE="update"
  fi
else
  MODE="update"
fi

log "Checking git"
if ! command -v git &>/dev/null; then
  as_root apt-get update -y
  as_root apt-get install -y git
fi

log "Checking Docker"
if ! command -v docker &>/dev/null || ! docker compose version &>/dev/null; then
  curl -fsSL https://get.docker.com | as_root sh
  as_root systemctl enable --now docker
fi

log "Checking Node.js"
if ! command -v node &>/dev/null || [[ "$(node -v | sed 's/v//;s/\..*//')" -lt 22 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | as_root bash -
  as_root apt-get install -y nodejs
fi

log "Fetching Anyscreen"
if [[ "$MODE" == "fresh" ]]; then
  if [[ -f "$PROJECT_DIR/docker-compose.yml" ]]; then
    (cd "$PROJECT_DIR" && docker compose down -v) || true
  fi
  rm -rf "$PROJECT_DIR"
  docker volume rm "$DATA_VOLUME" &>/dev/null || true
  REPO_URL="${REPO_URL:-$DEFAULT_REPO_URL}"
  git clone "$REPO_URL" "$PROJECT_DIR"
  cd "$PROJECT_DIR"
elif [[ -d "$PROJECT_DIR/.git" ]]; then
  cd "$PROJECT_DIR"
  git pull
elif [[ -d "$PROJECT_DIR" && -n "$(ls -A "$PROJECT_DIR" 2>/dev/null)" ]]; then
  log "Existing non-git install found — replacing source code, keeping .env/Caddyfile and all data"
  saved_env=""
  saved_caddyfile=""
  [[ -f "$PROJECT_DIR/.env" ]] && saved_env="$(cat "$PROJECT_DIR/.env")"
  [[ -f "$PROJECT_DIR/Caddyfile" ]] && saved_caddyfile="$(cat "$PROJECT_DIR/Caddyfile")"
  [[ -f "$PROJECT_DIR/docker-compose.yml" ]] && (cd "$PROJECT_DIR" && docker compose down) || true
  mv "$PROJECT_DIR" "${PROJECT_DIR}.old-$(date +%Y%m%d-%H%M%S)"
  REPO_URL="${REPO_URL:-$DEFAULT_REPO_URL}"
  git clone "$REPO_URL" "$PROJECT_DIR"
  cd "$PROJECT_DIR"
  [[ -n "$saved_env" ]] && printf '%s\n' "$saved_env" > .env
  [[ -n "$saved_caddyfile" ]] && printf '%s\n' "$saved_caddyfile" > Caddyfile
else
  REPO_URL="${REPO_URL:-$DEFAULT_REPO_URL}"
  git clone "$REPO_URL" "$PROJECT_DIR"
  cd "$PROJECT_DIR"
fi

if [[ -n "$RESTORE_FROM" ]]; then
  log "Restoring data from $RESTORE_FROM"
  docker volume create "$DATA_VOLUME" &>/dev/null || true
  docker run --rm \
    -v "$DATA_VOLUME:/data" \
    -v "$(dirname "$(realpath "$RESTORE_FROM")"):/backup" \
    alpine sh -c "cd / && tar xzf /backup/$(basename "$RESTORE_FROM")"
fi

log "Checking .env / JWT_SECRET"
if [[ ! -f .env ]]; then
  JWT_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
  echo "JWT_SECRET=$JWT_SECRET" > .env
else
  echo ".env already present — leaving it untouched."
fi

log "Checking ufw"
if ! command -v ufw &>/dev/null; then
  as_root apt-get update -y
  as_root apt-get install -y ufw
fi
as_root ufw allow 22/tcp
as_root ufw allow 80/tcp
as_root ufw allow 443/tcp
as_root ufw --force enable

log "Checking domain (Caddy runs as a container in docker-compose.yml, nothing to install on the host)"
current_domain=""
if [[ -f Caddyfile ]]; then
  current_domain="$(head -1 Caddyfile | awk '{print $1}')"
fi

write_caddyfile() {
  printf '%s {\n\treverse_proxy anyscreen:3001\n}\n' "$1" > Caddyfile
}

if [[ -n "$current_domain" && "$current_domain" != "your-domain.com" ]]; then
  read -rp "Domain '$current_domain' already configured — keep it? [Y/n] " keep < /dev/tty
  keep="${keep:-Y}"
  if [[ "$keep" =~ ^[Nn] ]]; then
    read -rp "New domain: " new_domain < /dev/tty
    write_caddyfile "$new_domain"
  fi
else
  read -rp "Domain for this Anyscreen instance: " new_domain < /dev/tty
  write_caddyfile "$new_domain"
fi

if docker volume inspect "$DATA_VOLUME" &>/dev/null; then
  log "Backing up current data before rebuilding"
  mkdir -p backups
  docker run --rm \
    -v "$DATA_VOLUME:/data" \
    -v "$(pwd)/backups:/backup" \
    alpine tar czf "/backup/anyscreen-backup-$(date +%Y%m%d-%H%M%S).tar.gz" -C / data
fi

log "Starting Anyscreen"
docker compose up -d --build

log "Health check"
sleep 3
docker compose ps
domain="$(head -1 Caddyfile | awk '{print $1}')"
if docker compose exec -T anyscreen node -e "require('http').get('http://localhost:3001/api/health',r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{console.log(d);process.exit(0)})}).on('error',()=>process.exit(1))" 2>/dev/null; then
  echo "App container is healthy."
else
  echo "App container not responding yet — check: docker compose logs -f anyscreen"
fi
echo "Once DNS points here and Caddy has a certificate (can take a minute on first start), check: curl -I https://$domain"
