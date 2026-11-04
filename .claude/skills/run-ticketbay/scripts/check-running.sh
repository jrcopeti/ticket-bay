#!/usr/bin/env bash
# check-running.sh — wait for the TicketBay dev server, then prove the demo data and both logins work.
# Usage: .claude/skills/run-ticketbay/scripts/check-running.sh [port]   (default 3000; read-only, waits at most 90 s)
set -euo pipefail

case "${1:-}" in -h|--help) sed -n '2,3p' "$0"; exit 0 ;; esac
port="${1:-3000}"
[[ "$port" =~ ^[0-9]+$ ]] || { echo "port must be a number: $port" >&2; exit 2; }
base="http://localhost:$port"

echo "== waiting for $base (the first request compiles the route and takes a while)"
for i in $(seq 1 45); do
  curl -sf -o /dev/null "$base/api/v1/events" && break
  [ "$i" -eq 45 ] && { echo "FAIL: no answer from $base/api/v1/events after 90 s: read the npm run dev output" >&2; exit 1; }
  sleep 2
done

n="$(curl -sf "$base/api/v1/events" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log((Array.isArray(j)?j:j.events??[]).length)})')"
echo "events: $n"
[ "$n" -gt 0 ] || { echo "FAIL: no events: the database is not seeded (run-ticketbay.sh seeds an empty one)" >&2; exit 1; }

fail=0
for email in anna@ticketbay.test admin@ticketbay.test; do
  code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$base/api/auth/sign-in/email" \
    -H 'content-type: application/json' -H "origin: $base" \
    -d "{\"email\":\"$email\",\"password\":\"ticketbay-demo\"}")"
  echo "sign-in $email: HTTP $code"
  [ "$code" = 200 ] || fail=1
done
if [ "$fail" -eq 1 ]; then
  echo "FAIL: a demo login was refused: the accounts are missing (reseed, with the user's yes) or BETTER_AUTH_URL does not match $base" >&2
  exit 1
fi
echo "PASS: $base serves $n events and both demo logins work"
