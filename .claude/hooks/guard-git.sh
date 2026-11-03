#!/usr/bin/env bash
# PreToolUse guard for Bash: never push to main (AGENTS.md). Every change goes
# through a pull request. Exit 2 = block, stderr = reason.
block() { echo "Blocked by guard-git: $1" >&2; exit 2; }

command -v jq >/dev/null || block "jq is missing: install it (see the setup guide)"
cmd=$(jq -r '.tool_input.command // ""')

grep -Eq '(^|[;&|( ])git( +-[^ ]+( +[^- ][^ ]*)?)* +push( |$)' <<<"$cmd" || exit 0

# An explicit main target: `git push origin main`, `HEAD:main`, `:main`, `+main`.
if grep -Eq 'push( +[^;&|]*)? +([^ ;&|]*:)?\+?(refs/heads/)?main([ ;&|]|$)' <<<"$cmd"; then
  block "never push to main: push a branch and open a pull request"
fi

# A bare `git push` (or `git push origin`) while main is checked out.
branch=$(git -C "${CLAUDE_PROJECT_DIR:-.}" rev-parse --abbrev-ref HEAD 2>/dev/null)
if [ "$branch" = main ] && ! grep -Eq 'push( +-[^ ]+)* +[^- ;&|][^ ;&|]* +[^- ;&|]' <<<"$cmd"; then
  block "main is checked out: create a branch first, then push it"
fi

exit 0
