#!/usr/bin/env bash
# run-ticketbay.sh — get TicketBay ready to serve: Node 22, deps, Postgres, migrations, demo data (seeded only when empty).
# Usage: .claude/skills/run-ticketbay/scripts/run-ticketbay.sh [--reseed] [--dry-run]
#   --reseed   wipe and reseed the demo data even when the database has data (ask the user first)
#   --dry-run  print what would run, change nothing
#   PORT=3100  serve on another port on the host (BETTER_AUTH_URL follows it); the box always serves on 3000
# Does not start the dev server: it prints the npm run dev line to run. Exits 3 when the port is taken.
set -euo pipefail

RESEED=0
DRY=0
for a in "$@"; do
  case "$a" in
    --reseed) RESEED=1 ;;
    --dry-run) DRY=1 ;;
    -h|--help) sed -n '2,7p' "$0"; exit 0 ;;
    *) echo "unknown argument: $a (see --help)" >&2; exit 2 ;;
  esac
done

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../../../.." && pwd)"
cd "$root"
grep -q '"name": "ticketbay"' package.json 2>/dev/null || { echo "not the TicketBay repo: $root" >&2; exit 1; }

run() {
  echo "+ $*"
  if [ "$DRY" -eq 0 ]; then "$@"; fi
}
step() { echo; echo "== $*"; }

# 1. Where are we? The box sets DEVCONTAINER=true and points DATABASE_URL at its own Postgres container (host "db").
if [ "${DEVCONTAINER:-}" = true ] || [[ "${DATABASE_URL:-}" == *@db:* ]]; then MODE=box; else MODE=host; fi
step "mode: $MODE"

# The port npm run dev will serve on. The box publishes container port 3000 (BOX_PORT picks the host port)
# and sets BETTER_AUTH_URL itself; on the host, BETTER_AUTH_URL follows PORT unless already set.
if [ "$MODE" = box ]; then
  [ -z "${PORT:-}" ] || [ "${PORT}" = 3000 ] || echo "PORT=$PORT ignored in the box: it serves on 3000 (BOX_PORT=<port> ./box picks the host port)"
  port=3000
  auth_url="${BETTER_AUTH_URL:-http://localhost:3000}"
else
  port="${PORT:-3000}"
  auth_url="${BETTER_AUTH_URL:-http://localhost:$port}"
fi
[[ "$port" =~ ^[0-9]+$ ]] || { echo "PORT must be a number: $port" >&2; exit 2; }
export BETTER_AUTH_URL="$auth_url"

# 2. Node 22 (.nvmrc).
want="$(tr -d 'v \n' < .nvmrc)"
have="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo none)"
[ "$have" = "$want" ] || { echo "Node $want needed, found $have: run 'nvm use' (reads .nvmrc), then rerun" >&2; exit 1; }
echo "node $(node -v)"

# 3. Dependencies.
step "dependencies"
if [ -d node_modules/next ] && [ -d node_modules/pg ]; then echo "node_modules present"; else run npm ci; fi

# 4. Postgres. Host: docker compose (port 5432 or POSTGRES_PORT). Box: the db container is already up.
step "postgres"
if [ "$MODE" = host ]; then
  docker info >/dev/null 2>&1 || { echo "Docker is not running: start Docker Desktop (or the daemon), then rerun" >&2; exit 1; }
  run npm run db:up
fi
if [ "$DRY" -eq 0 ] || [ "$MODE" = box ]; then
  state="$(node "$here/db-state.mjs")" || {
    echo "database $state" >&2
    if [ "$MODE" = box ]; then echo "the box's db container is down: exit the box and run ./box again from the host" >&2
    else echo "port 5432 taken by another Postgres? put POSTGRES_PORT=5433 in .env and the same port in its DATABASE_URL, then rerun" >&2; fi
    exit 1
  }
  echo "database: $state"
fi

# 5. Migrations (idempotent).
step "migrations"
run npm run db:migrate

# 6. Demo data: only into an empty database, unless --reseed.
step "demo data"
state="$(node "$here/db-state.mjs" 2>/dev/null || echo unknown)"
echo "database: $state"
if [ "$RESEED" -eq 1 ]; then
  echo "--reseed: wiping every account, API key, order, event and discount code"
  run npm run db:seed
elif [[ "$state" == "events=0 "* || "$state" == unmigrated || "$state" == unknown ]]; then
  run npm run db:seed
else
  echo "already seeded: kept as is (pass --reseed to wipe and reseed)"
fi

# 7. The port must be free, or Next moves to another one and the logins break (BETTER_AUTH_URL no longer matches).
step "port $port"
if ! node -e 'const s=require("net").createServer();s.once("error",()=>process.exit(1));s.listen(+process.argv[1],()=>s.close(()=>process.exit(0)))' "$port"; then
  echo "port $port is taken. Already TicketBay? Run check-running.sh $port." >&2
  if [ "$MODE" = box ]; then echo "Something else: stop it (the box always serves on 3000)." >&2
  else echo "Something else: rerun with PORT=<free port>." >&2; fi
  exit 3
fi
echo "free"

# 8. What to do next.
if [ "$MODE" = host ] && { [ "$port" != 3000 ] || [ "$auth_url" != "http://localhost:3000" ]; }; then
  dev="PORT=$port BETTER_AUTH_URL=$auth_url npm run dev"
else
  dev="npm run dev"
fi
step "ready"
cat <<MSG
Start the server:  $dev
Storefront:        $auth_url
Admin dashboard:   $auth_url/admin
Logins (password ticketbay-demo):
  anna@ticketbay.test    customer, has orders under My orders
  admin@ticketbay.test   admin, opens /admin
MSG
[ "$DRY" -eq 0 ] || echo "Dry run only: nothing changed."
