// GET /api/v1/organizer/invoices and the export behind it
// (src/finance/invoices.ts), pinned as they behave today: real Requests into
// the route handler, real Better Auth API keys, real Postgres. Only the app's
// singletons (getAuth / getDb) point at this file's database, and process.cwd()
// points at a temporary folder so the export's files land there instead of the
// repo's reports/.
//
// These are characterization tests: they pin today's behaviour, bugs included.
// A test named "pins current behaviour — suspected bug: …" documents a result
// that looks wrong; fixing it is a separate change with its own test.
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import type { Auth } from "../../src/auth/auth";
import { invoiceExport, lastInvoiceExport } from "../../src/finance/invoices";
import { customer, makeAuth, scopedKey, useCleanAccounts, type Customer } from "../integration/accounts";
import { useTestDatabase } from "../integration/database";
import { NOW } from "../integration/fixtures";
import { bearer, call, loadRoutes, quietRefusedKeyLogs } from "./client";
import { addOrder, DOME, eventAt, FEB_2027, JAN_2027, KISUZEM, PARK, read, tempDir, UNKNOWN_VENUE } from "./invoice-fixtures";

const wiring = vi.hoisted(() => ({ auth: undefined as unknown, db: undefined as unknown }));
vi.mock("@/lib/auth", () => ({ appBaseURL: () => "http://localhost:3000", getAuth: () => wiring.auth }));
vi.mock("@/src/db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/db/client")>()),
  getDb: () => wiring.db,
}));

const t = useTestDatabase();
useCleanAccounts(t);
quietRefusedKeyLogs();

let auth: Auth;
let alice: Customer;
let cwd: string;

beforeAll(async () => {
  process.env.TICKETBAY_TEST_CLOCK = "1";
  auth = makeAuth(t.db);
  wiring.auth = auth;
  wiring.db = t.db;
  await loadRoutes();
});

afterAll(() => {
  delete process.env.TICKETBAY_TEST_CLOCK;
});

beforeEach(async () => {
  alice = await customer(auth, "Alice");
  cwd = tempDir();
  vi.spyOn(process, "cwd").mockReturnValue(cwd);
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(cwd, { recursive: true, force: true });
});

const invoices = (query = "?month=2027-01", headers: Record<string, string> = bearer(alice.key)) =>
  call({ path: `/api/v1/organizer/invoices${query}`, headers, nowMs: NOW });

const MID_JAN = JAN_2027 + 14 * 24 * 3_600_000;
const seqOf = (invoiceNo: string) => Number(invoiceNo.slice(-6));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const allLines = (body: any) => body.organizers.flatMap((g: { lines: unknown[] }) => g.lines);

describe("GET /api/v1/organizer/invoices — who may call it", () => {
  it("refuses a request without an API key with 401 and a WWW-Authenticate header", async () => {
    const r = await invoices("?month=2027-01", {});
    expect(r.status).toBe(401);
    expect(r.body.error).toMatch(/needs an API key/);
    expect(r.headers.get("www-authenticate")).toBeTruthy();
  });

  it("refuses an unknown API key with 401", async () => {
    const r = await invoices("?month=2027-01", bearer("tb_not_a_real_key"));
    expect(r.status).toBe(401);
    expect(r.body).toHaveProperty("error");
  });

  it("pins current behaviour — suspected bug: any customer's read-only key exports every organizer's invoices, other customers' names and emails included", async () => {
    await eventAt(t.db, "park-show", PARK);
    await addOrder(t.db, { eventId: "park-show", customerName: "Bob Other", customerEmail: "bob@example.com" });
    const readOnly = await scopedKey(auth, alice.id, "read");

    const r = await invoices("?month=2027-01", bearer(readOnly.key));

    expect(r.status).toBe(200);
    expect(allLines(r.body)[0]).toMatchObject({ customer: "Bob Other", customerEmail: "bob@example.com" });
  });
});

describe("GET /api/v1/organizer/invoices — input", () => {
  it("answers 404 for an event id that is not a slug, before reading anything", async () => {
    const r = await invoices("?month=2027-01&event=Not_A_Slug");
    expect(r).toMatchObject({ status: 404, body: { error: "Event not found." } });
  });

  it("reads a month without a leading zero the same as with one", async () => {
    await eventAt(t.db, "park-show", PARK);
    await addOrder(t.db, { eventId: "park-show" });
    const r = await invoices("?month=2027-1");
    expect(r.status).toBe(200);
    expect(r.body.month).toBe("2027-01");
    expect(r.body.totals.invoices).toBe(1);
  });

  it("ignores a day after the month: 2027-01-31 exports January", async () => {
    await eventAt(t.db, "park-show", PARK);
    await addOrder(t.db, { eventId: "park-show" });
    const r = await invoices("?month=2027-01-31");
    expect(r.body.month).toBe("2027-01");
    expect(r.body.totals.invoices).toBe(1);
  });

  it("pins current behaviour — suspected bug: month 13 is not refused, 2026-13 silently exports January 2027", async () => {
    await eventAt(t.db, "park-show", PARK);
    await addOrder(t.db, { eventId: "park-show" });
    const r = await invoices("?month=2026-13");
    expect(r.status).toBe(200);
    expect(r.body.month).toBe("2027-01");
    expect(r.body.batchId).toMatch(/^INV-2027-01-/);
  });

  it("pins current behaviour — suspected bug: month 00 is not refused, 2027-00 silently exports December 2026", async () => {
    await eventAt(t.db, "park-show", PARK);
    await addOrder(t.db, { eventId: "park-show", createdAtMs: Date.UTC(2026, 11, 10) });
    const r = await invoices("?month=2027-00");
    expect(r.status).toBe(200);
    expect(r.body.month).toBe("2026-12");
  });

  it.each(["abc", "2027", "2027-xx", "-"])("pins current behaviour — suspected bug: a malformed month (%s) is a 500, not a 400", async (month) => {
    await eventAt(t.db, "park-show", PARK);
    await addOrder(t.db, { eventId: "park-show" });
    const r = await invoices(`?month=${month}`);
    expect(r).toMatchObject({ status: 500, body: { error: "Something went wrong on our side. Try again later." } });
  });

  it("pins current behaviour — suspected bug: a month with no paid orders is a 500, not an empty export", async () => {
    const r = await invoices("?month=2027-01");
    expect(r).toMatchObject({ status: 500, body: { error: "Something went wrong on our side. Try again later." } });
  });

  it("pins current behaviour — suspected bug: a well-formed event id that does not exist is a 500, not a 404", async () => {
    await eventAt(t.db, "park-show", PARK);
    await addOrder(t.db, { eventId: "park-show" });
    const r = await invoices("?month=2027-01&event=no-such-event");
    expect(r.status).toBe(500);
  });

  it("pins current behaviour — suspected bug: without ?month it exports the server's current wall-clock month, ignoring the request's clock", async () => {
    // NOW is in January 2027; the wall clock is not, so January's order is not found.
    await eventAt(t.db, "park-show", PARK);
    await addOrder(t.db, { eventId: "park-show", createdAtMs: NOW - 1000 });
    const r = await invoices("");
    expect(r.status).toBe(500);
  });
});

describe("GET /api/v1/organizer/invoices — which orders get an invoice", () => {
  it("invoices every paid order created inside the UTC month: the first millisecond in, the first millisecond of the next month out", async () => {
    await eventAt(t.db, "park-show", PARK);
    const before = await addOrder(t.db, { eventId: "park-show", createdAtMs: JAN_2027 - 1 });
    const first = await addOrder(t.db, { eventId: "park-show", createdAtMs: JAN_2027 });
    const last = await addOrder(t.db, { eventId: "park-show", createdAtMs: FEB_2027 - 1 });
    const after = await addOrder(t.db, { eventId: "park-show", createdAtMs: FEB_2027 });

    const r = await invoices();

    const ids = allLines(r.body).map((l: { orderId: number }) => l.orderId);
    expect(ids).toEqual([first, last]);
    expect(ids).not.toContain(before);
    expect(ids).not.toContain(after);
    expect(r.body.totals.invoices).toBe(2);
  });

  it("leaves refunded orders out", async () => {
    await eventAt(t.db, "park-show", PARK);
    const paid = await addOrder(t.db, { eventId: "park-show" });
    await addOrder(t.db, { eventId: "park-show", status: "refunded" });
    const r = await invoices();
    expect(allLines(r.body).map((l: { orderId: number }) => l.orderId)).toEqual([paid]);
  });

  it("with ?event, invoices only that event's orders", async () => {
    await eventAt(t.db, "park-show", PARK);
    await eventAt(t.db, "dome-show", DOME);
    await addOrder(t.db, { eventId: "park-show" });
    const dome = await addOrder(t.db, { eventId: "dome-show" });
    const r = await invoices("?month=2027-01&event=dome-show");
    expect(allLines(r.body).map((l: { orderId: number }) => l.orderId)).toEqual([dome]);
    expect(r.body.organizers.map((g: { organizer: string }) => g.organizer)).toEqual(["Dome Arena Productions Zrt."]);
  });
});

describe("GET /api/v1/organizer/invoices — the money", () => {
  it.each([
    // gross cents → net, VAT: VAT = round(gross − gross / 1.27), net = gross − VAT
    [12700, 10000, 2700],
    [5000, 3937, 1063],
    [999, 787, 212],
    [4, 3, 1],
    [3, 2, 1],
    [123456789, 97210070, 26246719],
  ])("splits a %i-cent order into %i net and %i VAT at 27%%", async (gross, net, vat) => {
    await eventAt(t.db, "park-show", PARK);
    await addOrder(t.db, { eventId: "park-show", ticketsCents: gross });
    const r = await invoices();
    expect(allLines(r.body)[0]).toMatchObject({ grossCents: gross, netCents: net, vatCents: vat });
  });

  it.each([1, 2])("pins current behaviour — suspected bug: a %i-cent order, whose VAT rounds to 0, crashes the export with a 500", async (gross) => {
    await eventAt(t.db, "park-show", PARK);
    await addOrder(t.db, { eventId: "park-show", ticketsCents: gross });
    const r = await invoices();
    expect(r.status).toBe(500);
  });

  it("invoices the discounted ticket amount only — never the service fee — and reports the discount as a whole percent", async () => {
    await eventAt(t.db, "park-show", PARK);
    await addOrder(t.db, { eventId: "park-show", subtotalCents: 10000, discountCents: 1250, ticketsCents: 8750 });
    const r = await invoices();
    expect(allLines(r.body)[0]).toMatchObject({ grossCents: 8750, discountPercent: 13 });
  });

  it("adds the lines up per organizer and for the whole batch", async () => {
    await eventAt(t.db, "park-show", PARK);
    await eventAt(t.db, "dome-show", DOME);
    await addOrder(t.db, { eventId: "park-show", ticketsCents: 5000 });
    await addOrder(t.db, { eventId: "park-show", ticketsCents: 12700 });
    await addOrder(t.db, { eventId: "dome-show", ticketsCents: 999 });

    const r = await invoices();

    const [park, dome] = r.body.organizers;
    expect(park).toMatchObject({ organizer: "Park Live Events Kft.", netCents: 3937 + 10000, vatCents: 1063 + 2700, grossCents: 17700 });
    expect(dome).toMatchObject({ organizer: "Dome Arena Productions Zrt.", netCents: 787, vatCents: 212, grossCents: 999 });
    expect(r.body.totals).toEqual({ invoices: 3, netCents: 14724, vatCents: 3975, grossCents: 18699 });
  });
});

describe("GET /api/v1/organizer/invoices — the shape of the export", () => {
  it("groups the invoices by organizer, ordered by venue name, then by order id", async () => {
    await eventAt(t.db, "park-show", PARK);
    await eventAt(t.db, "dome-show", DOME);
    await eventAt(t.db, "park-two", PARK);
    const p1 = await addOrder(t.db, { eventId: "park-show" });
    const d1 = await addOrder(t.db, { eventId: "dome-show" });
    const p2 = await addOrder(t.db, { eventId: "park-two" });

    const r = await invoices();

    expect(r.body.organizers.map((g: { organizer: string }) => g.organizer)).toEqual(["Park Live Events Kft.", "Dome Arena Productions Zrt."]);
    expect(r.body.organizers[0].lines.map((l: { orderId: number }) => l.orderId)).toEqual([p1, p2]);
    expect(r.body.organizers[1].lines.map((l: { orderId: number }) => l.orderId)).toEqual([d1]);
  });

  it("names the seller with its tax number and finance address from the organizer list", async () => {
    await eventAt(t.db, "kis-show", KISUZEM);
    await addOrder(t.db, { eventId: "kis-show" });
    const r = await invoices();
    expect(r.body.organizers[0]).toMatchObject({
      organizer: "Kisüzem Kulturális Egyesület",
      email: "hello@kisuzem.example",
      taxNo: "18765432-1-42",
    });
  });

  it.each([
    ["Budapest Park", "Park Live Events Kft.", "finance@parklive.example", "12345678-2-42"],
    ["Zamárdi Beach", "Lakeside Festivals Kft.", "accounts@lakeside-fest.example", "23456789-2-14"],
    ["Hungexpo Hall G", "CraftConf Szervező Kft.", "billing@craftconf.example", "34567890-2-41"],
    ["MVM Dome", "Dome Arena Productions Zrt.", "settlements@domearena.example", "45678901-2-43"],
    ["Kisüzem", "Kisüzem Kulturális Egyesület", "hello@kisuzem.example", "18765432-1-42"],
    ["A38 Ship", "Danube Stage Kft.", "finance@danubestage.example", "56789012-2-43"],
    ["Opus Jazz Club", "Opus Music Kft.", "office@opusmusic.example", "67890123-2-42"],
  ])("invoices orders at %s in the name of %s (%s, tax no. %s)", async (venueName, organizer, email, taxNo) => {
    await eventAt(t.db, "the-show", venueName);
    await addOrder(t.db, { eventId: "the-show" });
    const r = await invoices();
    expect(r.body.organizers).toHaveLength(1);
    expect(r.body.organizers[0]).toMatchObject({ organizer, email, taxNo });
  });

  it("pins current behaviour — suspected bug: a venue with no known organizer is invoiced in the venue's name, with no tax number, to TicketBay's own address", async () => {
    await eventAt(t.db, "garage-show", UNKNOWN_VENUE);
    await addOrder(t.db, { eventId: "garage-show" });
    const r = await invoices();
    expect(r.body.organizers[0]).toMatchObject({ organizer: "Garage Club", email: "invoices@ticketbay.example", taxNo: "" });
  });

  it("pins current behaviour — suspected bug: a venue named like a built-in object property (toString) crashes the export with a 500", async () => {
    await eventAt(t.db, "odd-venue", "toString");
    await addOrder(t.db, { eventId: "odd-venue" });
    const r = await invoices();
    expect(r.status).toBe(500);
  });

  it("pins current behaviour — suspected bug: a venue named constructor is invoiced as organizer \"Object\", with no address or tax number", async () => {
    await eventAt(t.db, "odd-venue", "constructor");
    await addOrder(t.db, { eventId: "odd-venue" });
    const r = await invoices();
    expect(r.status).toBe(200);
    expect(r.body.organizers[0].organizer).toBe("Object");
    expect(r.body.organizers[0]).not.toHaveProperty("email");
    expect(r.body.organizers[0]).not.toHaveProperty("taxNo");
    expect(read(path.join(cwd, "reports", "invoices-2027-01.csv"))).toContain(",Object,undefined,");
  });

  it("describes each invoice line: order number, date, customer, event, tickets", async () => {
    await eventAt(t.db, "park-show", PARK, "Summer Night");
    const id = await addOrder(t.db, {
      eventId: "park-show",
      createdAtMs: MID_JAN + 5 * 3_600_000,
      customerName: "Carla Customer",
      customerEmail: "carla@example.com",
      quantity: 3,
    });
    const r = await invoices();
    expect(allLines(r.body)[0]).toMatchObject({
      orderId: id,
      orderNumber: "TB-" + String(id).padStart(5, "0"),
      date: "2027-01-15",
      customer: "Carla Customer",
      customerEmail: "carla@example.com",
      eventId: "park-show",
      eventName: "Summer Night",
      tickets: 3,
      discountPercent: 0,
    });
  });

  it("names the batch after the month and its first order, and lists the files it wrote and the mails it sent", async () => {
    await eventAt(t.db, "park-show", PARK);
    await eventAt(t.db, "dome-show", DOME);
    const first = await addOrder(t.db, { eventId: "park-show" });
    await addOrder(t.db, { eventId: "dome-show" });

    const r = await invoices();

    expect(r.body).toMatchObject({
      batchId: `INV-2027-01-${first}`,
      month: "2027-01",
      files: ["reports/invoices-2027-01.csv", "reports/invoices-2027-01.txt"],
      emailsSent: 2,
    });
    expect(Number.isNaN(Date.parse(r.body.generatedAt))).toBe(false);
  });

  it("numbers the invoices TB-<yyyymm>-<6 digits>, consecutively within the export", async () => {
    await eventAt(t.db, "park-show", PARK);
    await eventAt(t.db, "dome-show", DOME);
    await addOrder(t.db, { eventId: "park-show" });
    await addOrder(t.db, { eventId: "dome-show" });
    await addOrder(t.db, { eventId: "park-show" });

    const r = await invoices();

    const numbers: string[] = allLines(r.body).map((l: { invoiceNo: string }) => l.invoiceNo);
    for (const n of numbers) expect(n).toMatch(/^TB-202701-\d{6}$/);
    const seqs = numbers.map(seqOf);
    expect(seqs).toEqual([seqs[0], seqs[0]! + 1, seqs[0]! + 2]);
  });

  it("pins current behaviour — suspected bug: exporting the same month again gives the same orders new invoice numbers (an in-memory counter that a restart resets to 1)", async () => {
    await eventAt(t.db, "park-show", PARK);
    await addOrder(t.db, { eventId: "park-show" });

    const first = await invoices();
    const again = await invoices();

    const a = seqOf(allLines(first.body)[0].invoiceNo);
    const b = seqOf(allLines(again.body)[0].invoiceNo);
    expect(b).toBe(a + 1);
  });
});

describe("GET /api/v1/organizer/invoices — files and mail", () => {
  it("writes the CSV and the printable copy under reports/, one CSV row per invoice", async () => {
    await eventAt(t.db, "park-show", PARK);
    await addOrder(t.db, { eventId: "park-show" });
    await addOrder(t.db, { eventId: "park-show" });

    await invoices();

    const csv = read(path.join(cwd, "reports", "invoices-2027-01.csv")).trimEnd().split("\n");
    expect(csv[0]).toBe("batch_id,invoice_no,order_no,date,organizer,organizer_tax_no,customer,event,tickets,discount_pct,net_eur,vat_eur,gross_eur,vat_rate");
    expect(csv).toHaveLength(3);
    expect(read(path.join(cwd, "reports", "invoices-2027-01.txt"))).toMatch(/^TICKETBAY - ORGANIZER INVOICES 2027-01\n/);
  });

  it("quotes CSV fields with commas, quotes or line breaks", async () => {
    await eventAt(t.db, "park-show", PARK, 'Rock, "Live"');
    await addOrder(t.db, { eventId: "park-show", customerName: "Doe, Jane\nJr" });
    await invoices();
    const csv = read(path.join(cwd, "reports", "invoices-2027-01.csv"));
    expect(csv).toContain(',"Doe, Jane\nJr","Rock, ""Live""",');
  });

  it("mails each organizer once per export, to its finance address", async () => {
    await eventAt(t.db, "park-show", PARK);
    await eventAt(t.db, "dome-show", DOME);
    await addOrder(t.db, { eventId: "park-show" });
    await addOrder(t.db, { eventId: "dome-show" });

    await invoices();

    const outbox = read(path.join(cwd, "reports", "outbox.log"));
    expect(outbox.match(/^To: .*$/gm)).toEqual(["To: finance@parklive.example", "To: settlements@domearena.example"]);
  });

  it("pins current behaviour — suspected bug: every GET mails every organizer again", async () => {
    await eventAt(t.db, "park-show", PARK);
    await addOrder(t.db, { eventId: "park-show" });
    await invoices();
    await invoices();
    const outbox = read(path.join(cwd, "reports", "outbox.log"));
    expect(outbox.match(/^To: /gm)).toHaveLength(2);
  });

  it("pins current behaviour — suspected bug: a one-event export overwrites the whole month's CSV", async () => {
    await eventAt(t.db, "park-show", PARK);
    await eventAt(t.db, "dome-show", DOME);
    await addOrder(t.db, { eventId: "park-show" });
    await addOrder(t.db, { eventId: "dome-show" });

    await invoices();
    await invoices("?month=2027-01&event=dome-show");

    const rows = read(path.join(cwd, "reports", "invoices-2027-01.csv")).trimEnd().split("\n").slice(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("Dome Arena Productions Zrt.");
  });

  it("right-aligns the amounts of the printable copy in 12-character columns", async () => {
    await eventAt(t.db, "park-show", PARK);
    await addOrder(t.db, { eventId: "park-show", ticketsCents: 12700, customerName: "Ann" });
    await invoices();
    const txt = read(path.join(cwd, "reports", "invoices-2027-01.txt"));
    expect(txt).toContain("Ann                     2          100.00       27.00      127.00\n");
    expect(txt).toContain("Total" + " ".repeat(54) + "      100.00       27.00      127.00\n");
  });

  it("pins current behaviour — suspected bug: an amount under one euro is pushed 2 columns right in the printable copy", async () => {
    await eventAt(t.db, "park-show", PARK);
    await addOrder(t.db, { eventId: "park-show", ticketsCents: 99, customerName: "Ann" });
    await invoices();
    const txt = read(path.join(cwd, "reports", "invoices-2027-01.txt"));
    // left("Ann", 24) + left("2", 5), then each amount 13 wide instead of 12
    expect(txt).toContain("Ann".padEnd(24) + "2".padEnd(5) + "         0.78" + "         0.21" + "         0.99\n");
  });

  it("keeps a customer name of exactly 24 characters whole in the printable copy", async () => {
    await eventAt(t.db, "park-show", PARK);
    await addOrder(t.db, { eventId: "park-show", ticketsCents: 12700, customerName: "Abcdefghijklmnopqrstuvwx" });
    await invoices();
    const txt = read(path.join(cwd, "reports", "invoices-2027-01.txt"));
    expect(txt).toContain("Abcdefghijklmnopqrstuvwx2    ");
  });

  it("pins current behaviour — suspected bug: a customer name over 24 characters is cut with … and runs into the Qty column", async () => {
    await eventAt(t.db, "park-show", PARK);
    await addOrder(t.db, { eventId: "park-show", ticketsCents: 12700, customerName: "Bartholomew Featherstonehaugh" });
    await invoices();
    const txt = read(path.join(cwd, "reports", "invoices-2027-01.txt"));
    expect(txt).toContain("Bartholomew Featherston…2    ");
  });

  it("pins current behaviour — suspected bug: an order with 0 cents for its tickets (100% discount) crashes the export with a 500", async () => {
    await eventAt(t.db, "park-show", PARK);
    await addOrder(t.db, { eventId: "park-show", subtotalCents: 5000, discountCents: 5000, ticketsCents: 0 });
    const r = await invoices();
    expect(r.status).toBe(500);
  });
});

describe("invoiceExport — the clock and the folder", () => {
  const savedTz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = savedTz;
  });

  it("without a month exports the month of now(), stamps generatedAt with it, and writes into reportsDir", async () => {
    process.env.TZ = "UTC";
    await eventAt(t.db, "park-show", PARK);
    await addOrder(t.db, { eventId: "park-show" });
    const dir = path.join(cwd, "elsewhere");

    const result = await invoiceExport({ event: null, month: null }, { now: () => NOW, reportsDir: dir });

    expect(result.month).toBe("2027-01");
    expect(result.generatedAt).toBe(new Date(NOW).toISOString());
    expect(fs.readdirSync(dir).sort()).toEqual(["invoices-2027-01.csv", "invoices-2027-01.txt", "outbox.log"]);
    expect(read(path.join(dir, "outbox.log"))).toContain("Date: " + new Date(NOW).toUTCString());
    expect(lastInvoiceExport).toBe(result);
  });

  it("logs one line per step: the export with its UTC range and event filter, the count, each mail, the files", async () => {
    await eventAt(t.db, "park-show", PARK);
    await eventAt(t.db, "dome-show", DOME);
    await addOrder(t.db, { eventId: "park-show" });
    await addOrder(t.db, { eventId: "dome-show" });

    await invoiceExport({ event: null, month: "2027-01" }, { now: () => NOW, reportsDir: cwd });
    await invoiceExport({ event: "dome-show", month: "2027-01" }, { now: () => NOW, reportsDir: cwd });

    const logged = vi.mocked(console.log).mock.calls.map((c) => c.join(" "));
    const csv = path.join(cwd, "invoices-2027-01.csv");
    const txt = path.join(cwd, "invoices-2027-01.txt");
    expect(logged).toEqual([
      "[invoices] export 2027-01 (2027-01-01T00:00:00.000Z - 2027-02-01T00:00:00.000Z) event=null",
      "[invoices] 2 paid orders",
      `[invoices] wrote ${csv} and ${txt}`,
      "[invoices] mail -> finance@parklive.example (TicketBay invoices 2027-01 (INV-2027-01-1))",
      "[invoices] mail -> settlements@domearena.example (TicketBay invoices 2027-01 (INV-2027-01-1))",
      "[invoices] export 2027-01 (2027-01-01T00:00:00.000Z - 2027-02-01T00:00:00.000Z) event=dome-show",
      "[invoices] 1 paid orders",
      `[invoices] wrote ${csv} and ${txt}`,
      "[invoices] mail -> settlements@domearena.example (TicketBay invoices 2027-01 (INV-2027-01-2))",
    ]);
  });

  it("pins current behaviour — suspected bug: when the outbox cannot be written, the export still succeeds and counts the mail as sent", async () => {
    await eventAt(t.db, "park-show", PARK);
    await addOrder(t.db, { eventId: "park-show" });
    fs.mkdirSync(path.join(cwd, "outbox.log")); // a folder where the mail file should be: every append fails

    const result = await invoiceExport({ event: null, month: "2027-01" }, { now: () => NOW, reportsDir: cwd });

    expect(result.emailsSent).toBe(1);
    expect(fs.existsSync(path.join(cwd, "invoices-2027-01.csv"))).toBe(true);
    const failure = vi.mocked(console.log).mock.calls.find((c) => c[0] === "[invoices] could not write outbox");
    expect(failure?.[1]).toMatchObject({ code: "EISDIR" });
  });

  it("pins current behaviour — suspected bug: the default month follows the server's time zone, so in Budapest 2027-01-31 23:30 UTC exports February", async () => {
    process.env.TZ = "Europe/Budapest";
    await eventAt(t.db, "park-show", PARK);
    await addOrder(t.db, { eventId: "park-show", createdAtMs: FEB_2027 + 3_600_000 });

    const result = await invoiceExport({ event: null, month: null }, { now: () => FEB_2027 - 30 * 60_000, reportsDir: cwd });

    expect(result.month).toBe("2027-02");
  });
});
