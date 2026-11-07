// TEMPORARY approval tests — scaffolding for the invoice export refactor.
// Delete each one once functional tests (organizer-invoices.test.ts) pin what
// it covers.
//
// One fixed month of orders goes through invoiceExport with a fixed clock; the
// CSV the accountants import, the printable copy and the outbox mails must
// match the approved files under __approved__/ byte for byte. A difference
// fails and shows the diff; `npx vitest run -u <this file>` re-approves after
// a deliberate change. The invoice numbers start at 000001 because this file
// runs exactly one export per worker (the counter lives in the module).
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { invoiceExport } from "../../src/finance/invoices";
import { useTestDatabase } from "../integration/database";
import { addOrder, DOME, eventAt, JAN_2027, KISUZEM, PARK, read, tempDir, UNKNOWN_VENUE } from "./invoice-fixtures";

const wiring = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/src/db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/db/client")>()),
  getDb: () => wiring.db,
}));

const t = useTestDatabase({ truncate: false });
const DAY = 24 * 3_600_000;
const GENERATED = Date.UTC(2027, 1, 2, 9, 30); // 2 February 2027, 09:30 UTC
const approved = (name: string) => path.join(__dirname, "__approved__", name);

let dir: string;
let result: Awaited<ReturnType<typeof invoiceExport>>;

beforeAll(async () => {
  wiring.db = t.db;
  vi.spyOn(console, "log").mockImplementation(() => {});
  await eventAt(t.db, "park-summer", PARK, "Summer Night Park Session");
  await eventAt(t.db, "dome-gala", DOME, 'Gala, "the big one"');
  await eventAt(t.db, "kis-jazz", KISUZEM, "Jazz Kisüzem");
  await eventAt(t.db, "garage-punk", UNKNOWN_VENUE, "Punk Night");
  await addOrder(t.db, { eventId: "park-summer", createdAtMs: JAN_2027 + 2 * DAY, ticketsCents: 5000, customerName: "Anna Kovács", quantity: 1 });
  await addOrder(t.db, {
    eventId: "park-summer",
    createdAtMs: JAN_2027 + 3 * DAY,
    subtotalCents: 20000,
    discountCents: 2000,
    ticketsCents: 18000,
    customerName: "Bartholomew Featherstonehaugh-Smythe",
    quantity: 4,
  });
  await addOrder(t.db, { eventId: "dome-gala", createdAtMs: JAN_2027 + 10 * DAY, ticketsCents: 123456789, customerName: "Doe, Jane", quantity: 50 });
  await addOrder(t.db, { eventId: "kis-jazz", createdAtMs: JAN_2027 + 20 * DAY, ticketsCents: 99, customerName: 'Zoé "Z" Ürge', quantity: 1 });
  await addOrder(t.db, { eventId: "garage-punk", createdAtMs: JAN_2027 + 30 * DAY, ticketsCents: 1270, customerName: "Punk Fan", quantity: 2 });
  dir = tempDir();
  result = await invoiceExport({ event: null, month: "2027-01" }, { now: () => GENERATED, reportsDir: dir });
});

afterAll(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("invoice export — approved outputs (TEMPORARY)", () => {
  it("the CSV for the accountants", async () => {
    await expect(read(path.join(dir, "invoices-2027-01.csv"))).toMatchFileSnapshot(approved("invoices-2027-01.approved.csv"));
  });

  it("the printable copy", async () => {
    await expect(read(path.join(dir, "invoices-2027-01.txt"))).toMatchFileSnapshot(approved("invoices-2027-01.approved.txt"));
  });

  it("the mails to the organizers", async () => {
    await expect(read(path.join(dir, "outbox.log"))).toMatchFileSnapshot(approved("outbox-2027-01.approved.log"));
  });

  it("the JSON result, minus the paths of the temporary folder", async () => {
    await expect(JSON.stringify({ ...result, files: undefined }, null, 2) + "\n").toMatchFileSnapshot(approved("invoices-2027-01.approved.json"));
  });
});
