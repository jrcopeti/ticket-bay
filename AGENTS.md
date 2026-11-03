# TicketBay

A ticket shop (Next.js + Postgres). Setup, commands and the stack are in `README.md` and the `package.json` scripts; the folder layout speaks for itself.

## Rules

- Money is integer cents: in every column, every domain result and every calculation. Convert to euros only at the output edge (`lib/format.ts` for the UI, the `*_eur` fields in `src/mcp/tools.ts`).
- Never push to `main`. Every change goes through a pull request, and the CI gate (`.github/workflows/gate.yml`) must be green. A hook blocks the push.
- Never edit the migrations in `drizzle/` by hand. Change the schema, then run `npm run db:generate`. A hook blocks the edit.
- Never mark a mutant equivalent yourself. When the CI mutation check finds a survivor, write a test that kills it. If you think it cannot be killed, stop and ask the human, with the reason.
- A regression test goes in a new file `tests/domain/regression-<short-slug>.test.ts` (code in `src/domain`) or `tests/lib/regression-<short-slug>.test.ts` (code in `lib/`). Do not edit the unit test config.
- Before writing or changing any test, read `tests/AGENTS.md`.

## The box

- Inside `./box` the database is the box's own Postgres (`db:5432`): skip `npm run db:up` / `db:down`. To reset it, see "Reset the box database" in `.devcontainer/README.md`.
