#!/usr/bin/env bash
# Runs the API keys flows with QuickE2E. Needs the app on :3000 and the local engine on :8822.
#
#   TEST_EMAIL=... TEST_PASSWORD=... quicke2e/run.sh [rounds]     (default 3)
#
# The flows depend on each other (create, then revoke), so `quicke2e run --runs 3` cannot repeat them:
# the second run would revoke a key that is already gone. Each round here uses fresh key names, runs
# every flow once in order, and removes its keys. The boundary and attack flows only run after the
# happy paths pass, because on a broken flow an attack cannot tell a refusal from a breakage.
#
# The account must have no other keys: create-key asserts "never used", which only a key row shows.
# `quicke2e check` flags revoke-key as WEAK_ASSERTION when run on its own, because the list is empty
# until create-key has run. The trace of a real run shows the key on the page and the revoke click.
set -u
cd "$(dirname "$0")"

rounds="${1:-3}"
stamps=(ra rb rc rd re rf rg rh ri rj)
failed=0

run_flows() { # file, then flow names
  local file="$1" ok=0 flow
  shift
  for flow in "$@"; do
    npx -y quicke2e run "$file" --only "$flow" --base http://localhost:3000 --engine local --trace "runs/$QE_STAMP" 2>&1 | grep -vE '^[[:space:]]*$'
    [ "${PIPESTATUS[0]}" -eq 0 ] || ok=1
  done
  return "$ok"
}

node login.mjs || exit 1
for ((i = 0; i < rounds; i++)); do
  export QE_STAMP="${stamps[$i]}"
  echo "--- round $((i + 1)) of $rounds (key names end in $QE_STAMP)"
  node cleanup.mjs >/dev/null
  if run_flows happy.flows.mjs create-key revoke-key setup-keep-key setup-bravo-key revoked-key-gone-from-list revoked-key-gone-after-navigation; then
    run_flows edge.flows.mjs boundary-name-at-max-length attack-html-in-key-name-is-plain-text attack-sql-in-key-name-is-plain-text attack-signed-out-is-sent-to-sign-in || failed=1
  else
    failed=1
    echo "happy path failed: boundary and attack flows held for this round"
  fi
  node cleanup.mjs | tail -1
done
exit "$failed"
