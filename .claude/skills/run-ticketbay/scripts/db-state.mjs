#!/usr/bin/env node
// db-state.mjs — print the TicketBay database state: "unreachable", "unmigrated", or "events=<n> users=<n>".
// Usage: node scripts/db-state.mjs   (run from the repo root; read-only)
// Reads DATABASE_URL like scripts/local-env.ts: environment, then .env, then .env.example.
import fs from "node:fs";

for (const file of [".env", ".env.example"]) {
  if (fs.existsSync(file)) process.loadEnvFile(file);
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.log("unreachable (no DATABASE_URL)");
  process.exit(1);
}
const { default: pg } = await import("pg");
const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });
try {
  await client.connect();
} catch (e) {
  console.log(`unreachable (${new URL(url).host}: ${e.code ?? e.message})`);
  process.exit(1);
}
try {
  const { rows } = await client.query("select to_regclass('public.events') is not null as ok");
  if (!rows[0].ok) {
    console.log("unmigrated");
  } else {
    const ev = await client.query("select count(*)::int as n from events");
    const us = await client.query('select count(*)::int as n from "user"');
    console.log(`events=${ev.rows[0].n} users=${us.rows[0].n}`);
  }
} finally {
  await client.end();
}
