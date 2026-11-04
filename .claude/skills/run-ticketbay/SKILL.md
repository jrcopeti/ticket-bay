---
name: run-ticketbay
description: "Start TicketBay from zero: database, demo data, logins. Use when the user says run TicketBay, start TicketBay, open TicketBay, start the app, run the app locally, start the dev server, set up TicketBay from scratch, set up the database, reset or reseed the demo data, wants to log in and click through the storefront or /admin, asks for the admin login, the demo password or which accounts exist, or says the app won't start or they can't log in. Detects the box or the host, installs deps, starts Postgres (host only), migrates, seeds only an empty database, checks the port, starts npm run dev and proves both demo logins work. Not for tests, builds or deploys. Never reseeds a database that has data without the user's yes, never deletes the Postgres volume, never runs db:up or docker inside the box, never edits .env.example."
---

# Run TicketBay

Take TicketBay from a fresh clone (or a stopped app) to a running dev server with demo data and working logins. It ends when `check-running.sh` prints PASS.

## Steps

1. **Prepare.** From the repo root, run `.claude/skills/run-ticketbay/scripts/run-ticketbay.sh`. It checks Node 22, runs `npm ci` if `node_modules` is missing, runs `npm run db:up` on the host only, then `npm run db:migrate`, and runs `npm run db:seed` only when the `events` table is empty. Then it checks that the port is free. For another port on the host, prefix `PORT=3100`. Done when it prints `== ready`.
   - Exit 3 means the port is taken. Run `.claude/skills/run-ticketbay/scripts/check-running.sh <port>`. If it prints PASS, TicketBay is already running: go to step 5. Otherwise, on the host, rerun with `PORT=<free port>`. In the box, find out from the user what holds 3000.
   - On any other error, fix the cause it names. Do not work around it. Then run the script again.
2. **Reseed only on a yes.** If the user asked to reset the demo data, or step 4 fails because the accounts are missing, first tell them: "Reseeding wipes every account, session, API key, order, event and discount code." Wait for a yes, then run `.claude/skills/run-ticketbay/scripts/run-ticketbay.sh --reseed`. Done when it prints `seeded ticketbay: 8 events`.
3. **Start the server.** Run the `Start the server:` line the script printed as a background process. That line is `npm run dev`, plus `PORT` and `BETTER_AUTH_URL` on another host port. In the box it always serves on 3000. The browser on the host uses `BOX_PORT` (default 3000, set when `./box` starts). Done when the log shows `✓ Ready`.
4. **Prove it.** Run `.claude/skills/run-ticketbay/scripts/check-running.sh [port]` with the port the server listens on (3000 in the box). Done when it prints `PASS`.
5. **Report** to the user:
   - The `Storefront:` and `Admin dashboard:` URLs the script printed. They follow `BETTER_AUTH_URL`, so in the box they already use `BOX_PORT`.
   - Logins, both with the password `ticketbay-demo`:
     - `anna@ticketbay.test` (customer, with orders under My orders)
     - `admin@ticketbay.test` (admin)

## Gotchas

- `npm run db:seed` TRUNCATEs every user (with their sessions and API keys), every order, every event and every discount code, then rebuilds them. Never run it on a database with data unless the user says yes. API keys the user created under Settings → Developers are lost.
- Never run `docker compose down -v`: it deletes the `ticketbay-pg` volume. Stop the database with `npm run db:down`.
- Inside the box (`DEVCONTAINER=true`, `DATABASE_URL` points at `db:5432`), Postgres is the box's own `db` container and there is no Docker engine. Never run `npm run db:up` or `docker` there. If the db is unreachable, the user must run `./box` again from the host.
- Overrides go in `.env` (it is gitignored). Never edit `.env.example`: it is committed, and the scripts and `docker-compose.yml` fall back to it.
- Port 5432 taken on the host: put `POSTGRES_PORT=5433` in `.env`, with the same port in a `DATABASE_URL` line there.
- Login fails, or redirects to the wrong place, on a port other than 3000: `BETTER_AUTH_URL` must equal the URL the browser uses. That happens when `npm run dev` runs without the printed `PORT`/`BETTER_AUTH_URL`, or when Next finds the port taken and moves to the next one.
- The seed's dates are relative to the hour it ran. After days without a reseed, the early-bird windows and the "upcoming" events drift. That is not a bug.
- The first request to each page compiles it, which takes a few seconds in dev. `check-running.sh` waits up to 90 s.

Last verified: 2026-11-04 with Claude Code in the box (empty db → seeded 8 events / 315 orders, rerun kept the data, check-running.sh PASS on :3000)
