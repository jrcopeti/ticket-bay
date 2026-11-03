# Database access

- The schema is in two files: `schema.ts` (the app tables) and `auth-schema.ts` (Better Auth's tables: `user`, `session`, `account`, `verification`, `apikey`). `schema.ts` re-exports `auth-schema.ts`, so import tables from `schema.ts` and `npm run db:generate` sees both.
- The app tables have a repo file each (`events-repo.ts`, `orders-repo.ts`, `codes-repo.ts`, `checkout-claims-repo.ts`, `voided-charges-repo.ts`). The auth tables have none: Better Auth reads and writes them (`src/auth/auth.ts`). Queries across tables for the admin dashboard live in `admin-queries.ts`.
- No `numeric` or `real` columns: money is integer cents.
