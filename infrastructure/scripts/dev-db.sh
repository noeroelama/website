#!/usr/bin/env bash
#
# dev-db.sh — MySQL lokal untuk dev (menggantikan Remote MySQL produksi).
#
#   ./infrastructure/scripts/dev-db.sh status   # cek apakah 3306 hidup
#   ./infrastructure/scripts/dev-db.sh install  # cetak perintah install (butuh sudo)
#   ./infrastructure/scripts/dev-db.sh init     # cetak perintah sudo untuk buat DB+user
#   ./infrastructure/scripts/dev-db.sh init --apply  # jalankan sql via sudo mysql
#   ./infrastructure/scripts/dev-db.sh seed     # isi dummy events/galleries
#
# DB dibuat dari apps/web/.env.local (DATABASE_URL), jadi identik dengan yang
# dipakai app — struktur tabel dibuat otomatis oleh store (ensureTables) saat
# seed pertama kali berjalan.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$ROOT/apps/web/.env.local"

url_from_env() {
  if [[ ! -s "$ENV_FILE" ]]; then
    echo "Tidak ada apps/web/.env.local — isi DATABASE_URL dulu." >&2
    exit 2
  fi
  DATABASE_URL="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | head -1 | sed 's/^DATABASE_URL=//')"
  if [[ -z "$DATABASE_URL" ]]; then
    echo "DATABASE_URL kosong di apps/web/.env.local." >&2
    exit 2
  fi
  # mysql://user:pass@host:port/db|user:pass@host:port/db (bisa ada query string)
  URL="${DATABASE_URL%%\?*}"
  URL="${URL#mysql://}"
  DB_USER="${URL%%:*}"
  REST="${URL#*:}"
  DB_PASS="${REST%%@*}"
  REST="${REST#*@}"
  DB_HOST="${REST%%/*}"
  DB_NAME="${REST#*/}"
  DB_PORT="${DB_HOST##*:}"
  [[ "$DB_PORT" == "$DB_HOST" ]] && DB_PORT=3306
}

case "${1:-status}" in
  status)
    if (exec 3<>/dev/tcp/127.0.0.1/3306) 2>/dev/null; then
      echo "MySQL aktif di 127.0.0.1:3306 ✓"
    else
      echo "MySQL TIDAK aktif di 127.0.0.1:3306."
      echo "Jalankan: ./infrastructure/scripts/dev-db.sh install"
      exit 1
    fi
    ;;
  install)
    echo "Mesin ini belum punya server MySQL. Jalankan sekali (butuh password sudo Anda):"
    echo
    echo "  sudo apt update && sudo apt install -y mariadb-server"
    echo "  sudo systemctl enable --now mariadb   # (opsional, agar nyala otomatis)"
    echo
    echo "Setelah itu: ./infrastructure/scripts/dev-db.sh init --apply"
    ;;
  init)
    url_from_env
    SQL="CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` CHARACTER SET utf8mb4;"
    SQL+=" CREATE USER IF NOT EXISTS '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASS';"
    SQL+=" CREATE USER IF NOT EXISTS '$DB_USER'@'127.0.0.1' IDENTIFIED BY '$DB_PASS';"
    SQL+=" GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$DB_USER'@'localhost';"
    SQL+=" GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$DB_USER'@'127.0.0.1';"
    SQL+=" FLUSH PRIVILEGES;"
    if [[ "${2:-}" == "--apply" ]]; then
      echo "Membuat database \`$DB_NAME\` dan user '$DB_USER'@'localhost'..."
      printf '%s\n' "$SQL" | sudo mariadb        # root unix_socket
      echo "Selesai. Lanjut: ./infrastructure/scripts/dev-db.sh seed"
    else
      echo "Print SQL init (jalankan dengan sudo saat MySQL sudah terinstall):"
      echo
      echo "  printf '%s\\n' '$SQL' | sudo mariadb"
    fi
    ;;
  seed)
    url_from_env
    set -a
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    set +a
    node --experimental-strip-types --import "$ROOT/infrastructure/scripts/ts-register.mjs" \
      "$ROOT/infrastructure/scripts/seed-dummy.mjs"
    ;;
  *) echo "usage: $0 status|install|init [--apply]|seed" >&2; exit 2 ;;
esac
