// Shared set-up for the organizer invoice export tests (GET
// /api/v1/organizer/invoices and src/finance/invoices.ts): paid orders written
// straight into the test database, so a test controls exactly what the export
// reads — the instant, the status and every cent column.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Db } from "../../src/db/client";
import { orders } from "../../src/db/schema";
import { venue } from "../integration/fixtures";

/** 2027-01-01T00:00:00.000Z and 2027-02-01T00:00:00.000Z: the month NOW (fixtures.ts) falls in. */
export const JAN_2027 = Date.UTC(2027, 0, 1);
export const FEB_2027 = Date.UTC(2027, 1, 1);

/** The venues the export knows an organizer for, and one it does not. */
export const PARK = "Budapest Park";
export const DOME = "MVM Dome";
export const KISUZEM = "Kisüzem";
export const UNKNOWN_VENUE = "Garage Club";

export function eventAt(db: Db, id: string, venueName: string, name = `Show ${id}`) {
  return venue(db, { id, venue: venueName, name });
}

let keys = 0;

export interface OrderSpec {
  eventId: string;
  createdAtMs?: number;
  ticketsCents?: number;
  subtotalCents?: number;
  discountCents?: number;
  quantity?: number;
  status?: "paid" | "refunded";
  customerName?: string;
  customerEmail?: string;
}

/** One order row as checkout would leave it; defaults: paid, 2 tickets, €50.00, mid-January 2027. */
export async function addOrder(db: Db, o: OrderSpec): Promise<number> {
  const tickets = o.ticketsCents ?? 5000;
  const discount = o.discountCents ?? 0;
  const [row] = await db
    .insert(orders)
    .values({
      eventId: o.eventId,
      customerEmail: o.customerEmail ?? "fan@example.com",
      customerName: o.customerName ?? "A Fan",
      quantity: o.quantity ?? 2,
      subtotalCents: o.subtotalCents ?? tickets + discount,
      discountPercent: 0,
      discountCents: discount,
      ticketsCents: tickets,
      feeCents: 150,
      totalCents: tickets + 150,
      vatCents: 0,
      status: o.status ?? "paid",
      paymentId: `ch_${++keys}`,
      idempotencyKey: `inv-${Math.random()}-${keys}`,
      createdAtMs: o.createdAtMs ?? JAN_2027 + 14 * 24 * 3_600_000,
    })
    .returning({ id: orders.id });
  return row!.id;
}

/** A fresh, empty folder the export may write into. */
export function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tb-invoices-"));
}

export const read = (file: string) => fs.readFileSync(file, "utf8");
