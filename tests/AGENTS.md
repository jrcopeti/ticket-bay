# Tests

## What needs what

- `tests/domain`, `tests/payments`, `tests/lib`: the unit lane (`npm run test:unit`), no database.
- `tests/integration` and `tests/http` need Postgres. On your machine that is Testcontainers (Docker). In a plain `./box` they use the box's own database instead (`tests/integration/global-setup.ts`).
- `npm test` runs every Vitest test, `tests/http` included, so it needs Postgres too.
- `e2e/` is Playwright (`npm run test:ui`) and needs Docker: on your machine, in `./box --docker`, or in CI.

## How to test

- Test behavior through the public API: the route handlers, the server actions and the `src/domain` / `src/services` functions the app calls. Never test private helpers, never assert on internal calls, never mock `src/domain` or `src/services`.
- Mock only the wiring seams: `lib/auth`, `src/db/client` and `src/payments`. Tests that call server actions outside Next also mock `next/headers` (to carry the signed-in cookie) and `next/cache` (`revalidatePath`). The pass-through `vi.mock` calls for `src/auth` and `src/mcp` re-import the real module, so the test shares one instance with the app code.
- Import app code with relative paths (`../../src/domain/refund`). But a `vi.mock` specifier must match how the app code imports the module, which is `@/...` (`vi.mock("@/src/payments", ...)`). A relative specifier there mocks nothing.
- Where a regression test goes: see the root `AGENTS.md`.
