// Property tests for GET /api/v1/organizer/invoices (src/finance/invoices.ts):
// generated months, event filters and orders, through the real route handler,
// a real API key and real Postgres.
//
// Properties, in English:
//  1. Crash hunt. For ANY query — a valid month, padded or not, a day after
//     it, month 00 or 13, junk, an empty or repeated parameter, an event id
//     that exists, does not exist or is not an id — over ANY month of orders —
//     none, refunded, at the month's edges, 0 to 10^10 cents, any name — the
//     answer is JSON, and below 500. Except for the crashes already found and
//     pinned in organizer-invoices.test.ts: those inputs must still give
//     exactly that 500, and nothing else may.
//  2. Money and membership. Over any month of orders: one invoice per paid
//     order created inside the UTC month, no other; every line is net + VAT =
//     gross with VAT = round(gross · 27/127); each organizer's totals are the
//     sum of its lines and the batch totals the sum of the organizers; the
//     invoice numbers are consecutive and unique within the export; every line
//     sits under its venue's organizer.
//
// Every run picks a new random seed; a failure prints it, and FC_SEED=<n>
// replays that run. FC_RUNS=<n> overrides the run count (hunt with 1000).
import fs from "node:fs";
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import fc from "fast-check";
import { sql } from "drizzle-orm";
import type { Auth } from "../../src/auth/auth";
import { events, orders } from "../../src/db/schema";
import { customer, makeAuth, scopedKey, type Customer } from "../integration/accounts";
import { useTestDatabase } from "../integration/database";
import { NOW } from "../integration/fixtures";
import { bearer, call, loadRoutes } from "./client";
import { addOrder, DOME, eventAt, FEB_2027, JAN_2027, KISUZEM, PARK, tempDir, UNKNOWN_VENUE } from "./invoice-fixtures";

const wiring = vi.hoisted(() => ({ auth: undefined as unknown, db: undefined as unknown }));
vi.mock("@/lib/auth", () => ({ appBaseURL: () => "http://localhost:3000", getAuth: () => wiring.auth }));
vi.mock("@/src/db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/db/client")>()),
  getDb: () => wiring.db,
}));

const t = useTestDatabase({ truncate: false });

const SEED = Number(process.env.FC_SEED ?? Math.floor(Math.random() * 2 ** 31));
const runs = (numRuns: number) => ({ seed: SEED, numRuns: Number(process.env.FC_RUNS ?? numRuns) });

let auth: Auth;
let alice: Customer;
let cwd: string;

beforeAll(async () => {
  process.env.TICKETBAY_TEST_CLOCK = "1";
  auth = makeAuth(t.db);
  wiring.auth = auth;
  wiring.db = t.db;
  await loadRoutes();
  alice = await customer(auth, "Alice");
});

afterAll(() => {
  delete process.env.TICKETBAY_TEST_CLOCK;
});

beforeEach(() => {
  cwd = tempDir();
  vi.spyOn(process, "cwd").mockReturnValue(cwd);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(cwd, { recursive: true, force: true });
});

// ---- The data ---------------------------------------------------------------

/** The events every run can sell: two at the same venue, one at a venue without a known organizer. */
const EVENTS = [
  { id: "park-one", venue: PARK },
  { id: "park-two", venue: PARK },
  { id: "dome-gala", venue: DOME },
  { id: "kis-jazz", venue: KISUZEM },
  { id: "garage-punk", venue: UNKNOWN_VENUE },
] as const;
const ORGANIZER_OF: Record<string, string> = {
  [PARK]: "Park Live Events Kft.",
  [DOME]: "Dome Arena Productions Zrt.",
  [KISUZEM]: "Kisüzem Kulturális Egyesület",
  [UNKNOWN_VENUE]: UNKNOWN_VENUE,
};
const venueOf = (eventId: string) => EVENTS.find((e) => e.id === eventId)!.venue;

const instant = fc.oneof(
  { weight: 6, arbitrary: fc.integer({ min: JAN_2027, max: FEB_2027 - 1 }) },
  { weight: 2, arbitrary: fc.constantFrom(JAN_2027 - 1, JAN_2027, FEB_2027 - 1, FEB_2027) },
  { weight: 1, arbitrary: fc.integer({ min: Date.UTC(2026, 11, 1), max: Date.UTC(2027, 2, 1) }) },
);

const cents = fc.oneof(
  { weight: 1, arbitrary: fc.constantFrom(0, 1, 2, 3, 99, 100, 127, 12700) },
  { weight: 4, arbitrary: fc.integer({ min: 0, max: 100_000 }) },
  { weight: 1, arbitrary: fc.integer({ min: 0, max: 10_000_000_000 }) },
);

// Postgres text cannot hold NUL, so a name never contains one; everything else goes.
const name = fc.oneof(
  fc.constantFrom("A Fan", "Doe, Jane", 'Zoé "Z" Ürge', "line\nbreak", "", " ", "x".repeat(300), "سارا", "👩‍🎤"),
  fc.string({ unit: "binary", maxLength: 40 }).map((s) => s.replaceAll("\u0000", "")),
);

const orderArb = fc.record({
  eventId: fc.constantFrom(...EVENTS.map((e) => e.id)),
  createdAtMs: instant,
  ticketsCents: cents,
  extraSubtotal: fc.oneof(fc.constant(0), fc.integer({ min: 0, max: 100_000 })),
  quantity: fc.integer({ min: 1, max: 50 }),
  status: fc.constantFrom<"paid" | "refunded">("paid", "paid", "paid", "refunded"),
  customerName: name,
});
type GenOrder = typeof orderArb extends fc.Arbitrary<infer T> ? T : never;
/** As the code wants them: the ones with a positive VAT (pinned: a 0-VAT order crashes the export). */
const vatOrderArb = orderArb.map((o) => ({ ...o, ticketsCents: Math.max(o.ticketsCents, 3) }));

/** Empty the tables, then write the events and these orders; returns the order ids in insertion order. */
async function seed(list: GenOrder[]): Promise<number[]> {
  await t.db.execute(sql`TRUNCATE ${orders}, ${events} RESTART IDENTITY CASCADE`);
  for (const e of EVENTS) await eventAt(t.db, e.id, e.venue);
  const ids: number[] = [];
  for (const o of list) {
    ids.push(
      await addOrder(t.db, {
        eventId: o.eventId,
        createdAtMs: o.createdAtMs,
        ticketsCents: o.ticketsCents,
        subtotalCents: o.ticketsCents + o.extraSubtotal,
        discountCents: o.extraSubtotal,
        quantity: o.quantity,
        status: o.status,
        customerName: o.customerName,
      }),
    );
  }
  return ids;
}

// ---- The query --------------------------------------------------------------

const month = fc.oneof(
  { weight: 6, arbitrary: fc.constant("2027-01") },
  { weight: 2, arbitrary: fc.constantFrom("2027-1", "2027-01-31", "2026-12", "2027-02", "2026-13", "2027-00", "2027-1-1") },
  { weight: 1, arbitrary: fc.tuple(fc.integer({ min: -10, max: 300_000 }), fc.integer({ min: -5, max: 30 })).map(([y, m]) => `${y}-${m}`) },
  { weight: 1, arbitrary: fc.constantFrom("", "abc", "2027", "-", "2027-xx", "0-0", "9999999-01", "1e3-01", " 2027-01", "2027-01;DROP", "../..") },
  { weight: 1, arbitrary: fc.string({ unit: "binary", maxLength: 20 }) },
);

// Mostly real ids, so most runs get past the validation and into the export.
const event = fc.oneof(
  { weight: 5, arbitrary: fc.constantFrom(...EVENTS.map((e) => e.id)) },
  { weight: 1, arbitrary: fc.constantFrom("no-such-event", "Not_A_Slug", "", "-", "a".repeat(101), "park-one/../x") },
  { weight: 1, arbitrary: fc.string({ unit: "binary", maxLength: 20 }) },
);

/** What the request carries: each parameter absent, once, or twice (the export reads the first). */
const queryArb = fc.record({
  month: fc.oneof({ weight: 8, arbitrary: month.map((m) => [m]) }, { weight: 1, arbitrary: fc.constant([]) }, { weight: 1, arbitrary: fc.tuple(month, month) }),
  event: fc.oneof({ weight: 5, arbitrary: fc.constant([]) }, { weight: 4, arbitrary: event.map((e) => [e]) }, { weight: 1, arbitrary: fc.tuple(event, event) }),
});

function queryString(q: { month: string[]; event: string[] }): string {
  const p = new URLSearchParams();
  for (const m of q.month) p.append("month", m);
  for (const e of q.event) p.append("event", e);
  const s = p.toString();
  return s ? `?${s}` : "";
}

const isSlug = (s: string) => /^[a-z0-9][a-z0-9-]{0,99}$/.test(s);

/**
 * The crashes already found, each pinned by a test in
 * organizer-invoices.test.ts. Returns which one this input hits, or null.
 * The property checks that these inputs still give exactly that 500, and that
 * no other input does.
 */
function knownCrash(q: { month: string[]; event: string[] }, list: GenOrder[]): string | null {
  const ev = q.event[0] ?? null;
  if (ev !== null && !isSlug(ev)) return null; // a 404 before anything is read
  // The month as the export reads it: no month means the wall clock's month (local time).
  let m = q.month[0] || "";
  if (!m) {
    const d = new Date();
    m = d.getFullYear() + "-" + (d.getMonth() + 1);
  }
  const [y, mm] = m.split("-").map((s) => parseInt(s));
  const start = Date.UTC(y!, mm! - 1, 1);
  const end = Date.UTC(y!, mm!, 1);
  // pinned: "a malformed month (…) is a 500, not a 400"
  if (Number.isNaN(new Date(start).getTime()) || Number.isNaN(new Date(end).getTime())) return "malformed month";
  const hit = list.filter((o) => o.status === "paid" && o.createdAtMs >= start && o.createdAtMs < end && (ev === null || o.eventId === ev));
  // pinned: "a month with no paid orders is a 500" / "a well-formed event id that does not exist is a 500"
  if (hit.length === 0) return "no paid orders";
  // pinned: "an order with 0 cents …" / "a 1-cent order, whose VAT rounds to 0, …"
  if (hit.some((o) => o.ticketsCents <= 2)) return "an order whose VAT rounds to 0";
  return null;
}

// Better Auth rate-limits each key to 120 requests a minute: a fresh key every 100 requests.
let key = "";
let sent = 0;
async function invoices(query: string) {
  if (sent++ % 100 === 0) key = (await scopedKey(auth, alice.id, "read")).key;
  return call({ path: `/api/v1/organizer/invoices${query}`, headers: bearer(key), nowMs: NOW });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
interface Line {
  invoiceNo: string;
  orderId: number;
  eventId: string;
  netCents: number;
  vatCents: number;
  grossCents: number;
  discountPercent: number | null;
}
const linesOf = (body: Body): Line[] => body.organizers.flatMap((g: { lines: Line[] }) => g.lines);

// ---- 1. Crash hunt ----------------------------------------------------------

describe("GET /api/v1/organizer/invoices — crash hunt", () => {
  it("answers every query, over every month of orders, with JSON below 500 — except the pinned crashes, which still give exactly their 500", async () => {
    await fc.assert(
      fc.asyncProperty(queryArb, fc.oneof({ weight: 1, arbitrary: fc.constant([]) }, { weight: 6, arbitrary: fc.array(orderArb, { minLength: 1, maxLength: 15 }) }), async (q, list) => {
        await seed(list);
        const r = await invoices(queryString(q));
        expect(r.isJson, r.text).toBe(true);
        const crash = knownCrash(q, list);
        if (crash) {
          expect(r.status, `expected the pinned crash: ${crash}`).toBe(500);
          expect(r.body).toEqual({ error: "Something went wrong on our side. Try again later." });
          return;
        }
        expect(r.status, r.text).toBeLessThan(500);
        if (r.status === 200) {
          expect(r.body).toMatchObject({ batchId: expect.any(String), month: expect.stringMatching(/^\d{4}-\d{2}$/), emailsSent: r.body.organizers.length });
        } else {
          expect(r.body).toEqual({ error: expect.any(String) });
        }
      }),
      runs(150),
    );
  }, 600_000);
});

// ---- 2. Money and membership -------------------------------------------------

describe("GET /api/v1/organizer/invoices — invariants", () => {
  it("invoices exactly the paid orders of the UTC month, with net + VAT = gross, VAT = round(gross·27/127), and totals that add up", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(vatOrderArb, { minLength: 1, maxLength: 10 }), async (generated) => {
        // at least one paid January order, so the month is never empty (pinned elsewhere)
        const list = [{ ...generated[0]!, status: "paid" as const, createdAtMs: JAN_2027 + 1 }, ...generated.slice(1)];
        const ids = await seed(list);
        const r = await invoices("?month=2027-01");
        expect(r.status, r.text).toBe(200);
        const body = r.body;
        const lines = linesOf(body);

        // membership: one line per paid January order, none for anything else
        const expected = ids.filter((_, i) => list[i]!.status === "paid" && list[i]!.createdAtMs >= JAN_2027 && list[i]!.createdAtMs < FEB_2027);
        expect(lines.map((l) => l.orderId).sort((a, b) => a - b)).toEqual(expected);

        // per line: the money
        for (const l of lines) {
          const o = list[ids.indexOf(l.orderId)]!;
          expect(l.grossCents).toBe(o.ticketsCents);
          expect(l.vatCents).toBe(Math.round((o.ticketsCents * 27) / 127));
          expect(l.netCents + l.vatCents).toBe(l.grossCents);
          expect(l.discountPercent).toBe(Math.round((o.extraSubtotal / (o.ticketsCents + o.extraSubtotal)) * 100));
        }

        // per organizer: its own venue's lines, and their sums
        for (const g of body.organizers) {
          for (const l of g.lines as Line[]) expect(ORGANIZER_OF[venueOf(l.eventId)]).toBe(g.organizer);
          const sum = (k: "netCents" | "vatCents" | "grossCents") => (g.lines as Line[]).reduce((s, l) => s + l[k], 0);
          expect([g.netCents, g.vatCents, g.grossCents]).toEqual([sum("netCents"), sum("vatCents"), sum("grossCents")]);
        }
        expect(new Set(body.organizers.map((g: { organizer: string }) => g.organizer)).size).toBe(body.organizers.length);

        // the batch: sums of the organizers
        const total = (k: "netCents" | "vatCents" | "grossCents") => body.organizers.reduce((s: number, g: Record<string, number>) => s + g[k]!, 0);
        expect(body.totals).toEqual({ invoices: lines.length, netCents: total("netCents"), vatCents: total("vatCents"), grossCents: total("grossCents") });
        expect(body.emailsSent).toBe(body.organizers.length);

        // invoice numbers: TB-202701-nnnnnn, consecutive in the export's order, so never repeated
        const seqs = lines.map((l) => {
          expect(l.invoiceNo).toMatch(/^TB-202701-\d{6}$/);
          return Number(l.invoiceNo.slice(-6));
        });
        expect(seqs).toEqual(seqs.map((_, i) => seqs[0]! + i));
      }),
      runs(100),
    );
  }, 600_000);
});
