#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."
PNPM_VERSION="$(node -p "require('./package.json').packageManager.split('@')[1]")"
pnpm() { npx --yes "pnpm@$PNPM_VERSION" "$@"; }

build_gateway() {
  pnpm install --frozen-lockfile
  APP_ENV=production pnpm exec turbo run build --filter=gateway --concurrency=1
  mkdir -p apps/gateway/tmp
  touch apps/gateway/tmp/restart.txt
}

upload_apps() {
  : "${DEPLOY_HOST:?DEPLOY_HOST (user@host) is required}"
  local deploy_dir="${DEPLOY_DIR:-apps}"
  local ssh_opts=(-p "${DEPLOY_SSH_PORT:-22}")

  pnpm install --frozen-lockfile
  APP_ENV=production NEXT_OUTPUT=standalone \
    pnpm exec turbo run build --filter=web --filter=admin --filter=shop

  for app in web admin shop; do
    standalone="apps/$app/.next/standalone"
    mkdir -p "$standalone/apps/$app/.next"
    cp -r "apps/$app/.next/static" "$standalone/apps/$app/.next/static"
    if [ -d "apps/$app/public" ]; then cp -r "apps/$app/public" "$standalone/apps/$app/public"; fi

    root="$deploy_dir/$app/apps/$app"
    ssh "${ssh_opts[@]}" "$DEPLOY_HOST" "mkdir -p '$root/tmp'"
    rsync -a --delete -e "ssh ${ssh_opts[*]}" \
      --exclude "/apps/$app/tmp" --exclude "/apps/$app/stderr.log" \
      "$standalone/" "$DEPLOY_HOST:$deploy_dir/$app/"
    ssh "${ssh_opts[@]}" "$DEPLOY_HOST" "touch '$root/tmp/restart.txt'"
  done
}

case "${1:-}" in
  gateway) build_gateway ;;
  apps) upload_apps ;;
  *) echo "usage: $0 gateway|apps" >&2; exit 2 ;;
esac
