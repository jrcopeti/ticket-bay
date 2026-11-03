#!/usr/bin/env bash
# PreToolUse guard for Edit/Write: never edit the migrations in drizzle/ by hand
# (AGENTS.md). Change src/db/schema.ts, then run `npm run db:generate`.
# Exit 2 = block, stderr = reason.
block() { echo "Blocked by guard-migrations: $1" >&2; exit 2; }

command -v jq >/dev/null || block "jq is missing: install it (see the setup guide)"
path=$(jq -r '.tool_input.file_path // .tool_input.notebook_path // ""')
path=${path#"${CLAUDE_PROJECT_DIR:-$PWD}"/}

case "$path" in
  drizzle/*)
    block "drizzle/ is generated: change src/db/schema.ts, then run npm run db:generate" ;;
esac

exit 0
