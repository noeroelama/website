#!/bin/bash
# cPanel deploy, run by .cpanel.yml after "Deploy HEAD Commit" (docs/deployment.md#cpanel).
# Builds every app, copies each Next app's standalone folder to $DEPLOY_DIR/<app> and tells
# Passenger to restart it. The cPanel Node.js app root is $DEPLOY_DIR/<app>/apps/<app>.
# The gateway runs from apps/gateway in place.
set -euo pipefail

cd "$(dirname "$0")/.."
DEPLOY_DIR="${DEPLOY_DIR:-$HOME/apps}"
PNPM_VERSION="$(node -p "require('./package.json').packageManager.split('@')[1]")"
pnpm() { npx --yes "pnpm@$PNPM_VERSION" "$@"; }

pnpm install --frozen-lockfile
APP_ENV=production NEXT_OUTPUT=standalone pnpm build

for app in web admin shop; do
  standalone="apps/$app/.next/standalone"
  # Next does not copy static files into the standalone folder.
  mkdir -p "$standalone/apps/$app/.next"
  cp -r "apps/$app/.next/static" "$standalone/apps/$app/.next/static"
  if [ -d "apps/$app/public" ]; then cp -r "apps/$app/public" "$standalone/apps/$app/public"; fi

  # Copy the whole folder: its node_modules symlinks need the monorepo layout.
  # tmp/ belongs to Passenger and stderr.log to cPanel, so they are kept.
  root="$DEPLOY_DIR/$app/apps/$app"
  mkdir -p "$root/tmp"
  rsync -a --delete --exclude "/apps/$app/tmp" --exclude "/apps/$app/stderr.log" \
    "$standalone/" "$DEPLOY_DIR/$app/"
  touch "$root/tmp/restart.txt"
done

mkdir -p apps/gateway/tmp
touch apps/gateway/tmp/restart.txt
