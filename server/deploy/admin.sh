#!/usr/bin/env bash
# Admin commands, run inside the api container.
#   sudo ./admin.sh invite [--admin] [--uses N] [--hours H]
#   sudo ./admin.sh invites
#   sudo ./admin.sh users
#   sudo ./admin.sh kick <nickname>
#   sudo ./admin.sh channels
set -euo pipefail
cd "$(dirname "$0")"
exec docker compose exec -T api node --disable-warning=ExperimentalWarning src/cli.ts "$@"
