// Organizer invoice export.
//
// The organizers are the sellers of the tickets, so the invoices for the ticket
// part of every order are theirs; we prepare them monthly and the organizers'
// accountants import the CSV (the .txt is the printable copy). One line per
// paid order: net, VAT 27%, gross. Our service fee is NOT on these, we invoice
// that ourselves.
//
// Copied from the payout report and adjusted, keep the two in sync.
import fs from "fs";
import path from "path";
import { getDb, type Db } from "../db/client";

const VAT_RATE = 0.27;

interface Organizer {
  name: string;
  email: string;
  taxNo: string;
}

// organizers by venue (copy of the list in payouts.ts, TB-212)
const ORGANIZERS: Record<string, Organizer> = {
  "Budapest Park": { name: "Park Live Events Kft.", email: "finance@parklive.example", taxNo: "12345678-2-42" },
  "Zamárdi Beach": { name: "Lakeside Festivals Kft.", email: "accounts@lakeside-fest.example", taxNo: "23456789-2-14" },
  "Hungexpo Hall G": { name: "CraftConf Szervező Kft.", email: "billing@craftconf.example", taxNo: "34567890-2-41" },
  "MVM Dome": { name: "Dome Arena Productions Zrt.", email: "settlements@domearena.example", taxNo: "45678901-2-43" },
  "Kisüzem": { name: "Kisüzem Kulturális Egyesület", email: "hello@kisuzem.example", taxNo: "18765432-1-42" },
  "A38 Ship": { name: "Danube Stage Kft.", email: "finance@danubestage.example", taxNo: "56789012-2-43" },
  "Opus Jazz Club": { name: "Opus Music Kft.", email: "office@opusmusic.example", taxNo: "67890123-2-42" },
};

/** A paid order as the export query returns it; node-postgres gives BIGINT columns back as strings. */
interface OrderRow {
  id: number;
  event_id: string;
  event_name: string;
  venue: string;
  customer_name: string;
  customer_email: string;
  quantity: number;
  subtotal_cents: string;
  discount_cents: string;
  tickets_cents: string;
  created_at_ms: string;
}

export interface InvoiceLine {
  invoiceNo: string;
  orderId: number;
  orderNumber: string;
  date: string;
  customer: string;
  customerEmail: string;
  eventId: string;
  eventName: string;
  tickets: number;
  discountPercent: number;
  netCents: number;
  vatCents: number;
  grossCents: number;
}

/** One organizer's invoices in the batch, with their sums. */
export interface OrganizerInvoices {
  organizer: string;
  email: string;
  taxNo: string;
  lines: InvoiceLine[];
  netCents: number;
  vatCents: number;
  grossCents: number;
}

export interface InvoiceExport {
  batchId: string;
  month: string;
  generatedAt: string;
  organizers: OrganizerInvoices[];
  totals: { invoices: number; netCents: number; vatCents: number; grossCents: number };
  files: string[];
  emailsSent: number;
}

export interface InvoiceExportParams {
  /** one event's orders only */
  event?: string | null;
  /** "YYYY-MM"; the current month when missing */
  month?: string | null;
}

/** What the export reaches outside the database: the clock and the folder it writes to. */
export interface InvoiceExportDeps {
  /** the wall clock by default */
  now?: () => number;
  /** <cwd>/reports by default: the CSV, the printable copy and the mail outbox */
  reportsDir?: string;
}

// running invoice number, continues where the last export stopped
let invoiceSeq = 1;
export let lastInvoiceExport: InvoiceExport | null = null;

function organizerFor(venue: string): Organizer {
  const o = ORGANIZERS[venue];
  if (o) return o;
  return { name: venue, email: "invoices@ticketbay.example", taxNo: "" };
}

// ---- The month -------------------------------------------------------------

/** The month as asked for ("2027-1" stays "2027-1"), and its UTC bounds. */
interface ExportMonth {
  label: string;
  start: Date;
  end: Date;
}

function exportMonth(month: string | null | undefined, nowMs: number): ExportMonth {
  let label = month;
  if (!label) {
    const d = new Date(nowMs);
    label = d.getFullYear() + "-" + (d.getMonth() + 1);
  }
  const parts = label.split("-");
  const y = parseInt(parts[0]!);
  const m = parseInt(parts[1]!);
  return { label, start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) };
}

/** "2027-01" */
const yearMonth = (start: Date) => start.toISOString().substring(0, 7);

// ---- The money -------------------------------------------------------------

/** The ticket amount of one order split into net and VAT; the VAT is rounded, the net is the rest. */
function vatSplit(ticketsCents: string) {
  const grossEur = parseFloat(ticketsCents) / 100;
  const netEur = grossEur / (1 + VAT_RATE);
  const vatCents = Math.round((grossEur - netEur) * 100);
  const grossCents = Number(ticketsCents);
  return { netCents: grossCents - vatCents, vatCents, grossCents };
}

function invoiceLine(o: OrderRow, start: Date): InvoiceLine {
  const { netCents, vatCents, grossCents } = vatSplit(o.tickets_cents);
  return {
    invoiceNo: "TB-" + yearMonth(start).replace("-", "") + "-" + String(invoiceSeq++).padStart(6, "0"),
    orderId: o.id,
    orderNumber: "TB-" + String(o.id).padStart(5, "0"),
    date: new Date(Number(o.created_at_ms)).toISOString().substring(0, 10),
    customer: o.customer_name,
    customerEmail: o.customer_email,
    eventId: o.event_id,
    eventName: o.event_name,
    tickets: o.quantity,
    discountPercent: Math.round((Number(o.discount_cents) / Number(o.subtotal_cents)) * 100),
    netCents,
    vatCents,
    grossCents,
  };
}

/** One group per organizer, in the order the organizers first appear in the rows. */
function groupByOrganizer(rows: OrderRow[], start: Date): OrganizerInvoices[] {
  const groups: Record<string, OrganizerInvoices> = {};
  const names: string[] = [];
  for (const o of rows) {
    const org = organizerFor(o.venue);
    if (!groups[org.name]) {
      groups[org.name] = { organizer: org.name, email: org.email, taxNo: org.taxNo, lines: [], netCents: 0, vatCents: 0, grossCents: 0 };
      names.push(org.name);
    }
    const g = groups[org.name]!;
    const line = invoiceLine(o, start);
    g.lines.push(line);
    g.netCents += line.netCents;
    g.vatCents += line.vatCents;
    g.grossCents += line.grossCents;
  }
  return names.map((name) => groups[name]!);
}

function batchTotals(organizers: OrganizerInvoices[]): InvoiceExport["totals"] {
  const totals = { invoices: 0, netCents: 0, vatCents: 0, grossCents: 0 };
  for (const g of organizers) {
    totals.invoices += g.lines.length;
    totals.netCents += g.netCents;
    totals.vatCents += g.vatCents;
    totals.grossCents += g.grossCents;
  }
  return totals;
}

// ---- The outputs -----------------------------------------------------------

// right-align an amount in a fixed-width column of the printable invoice
function col(eur: number, width: number) {
  const digits = Math.floor(Math.log10(eur)) + 1;
  const pad = Math.max(width - digits - 3, 0);
  return " ".repeat(pad) + eur.toFixed(2);
}

function left(s: string, width: number) {
  if (s.length > width) return s.substring(0, width - 1) + "…";
  return s + " ".repeat(width - s.length);
}

const eur = (cents: number) => (cents / 100).toFixed(2);

function q(value: string | number) {
  const s = String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) return '"' + s.split('"').join('""') + '"';
  return s;
}

/** The CSV for the accountants: one row per invoice. */
function renderCsv(batchId: string, organizers: OrganizerInvoices[]): string {
  let csv = "batch_id,invoice_no,order_no,date,organizer,organizer_tax_no,customer,event,tickets,discount_pct,net_eur,vat_eur,gross_eur,vat_rate\n";
  for (const g of organizers) {
    for (const l of g.lines) {
      csv +=
        [
          batchId,
          l.invoiceNo,
          l.orderNumber,
          l.date,
          q(g.organizer),
          q(g.taxNo),
          q(l.customer),
          q(l.eventName),
          l.tickets,
          l.discountPercent,
          eur(l.netCents),
          eur(l.vatCents),
          eur(l.grossCents),
          "27%",
        ].join(",") + "\n";
    }
  }
  return csv;
}

/** The printable copy: one block per organizer. */
function renderTxt(monthLabel: string, batchId: string, generatedAt: string, organizers: OrganizerInvoices[]): string {
  const amounts = (x: { netCents: number; vatCents: number; grossCents: number }) =>
    col(x.netCents / 100, 12) + col(x.vatCents / 100, 12) + col(x.grossCents / 100, 12);
  let txt = "TICKETBAY - ORGANIZER INVOICES " + monthLabel + "\nBatch " + batchId + "   generated " + generatedAt + "\n\n";
  for (const g of organizers) {
    txt += "=".repeat(96) + "\n";
    txt += "Seller: " + g.organizer + (g.taxNo ? "  (tax no. " + g.taxNo + ")" : "") + "\n";
    txt += "=".repeat(96) + "\n";
    txt += left("Invoice", 20) + left("Order", 10) + left("Customer", 24) + left("Qty", 5) + "         Net" + "         VAT" + "       Gross\n";
    for (const l of g.lines) {
      txt += left(l.invoiceNo, 20) + left(l.orderNumber, 10) + left(l.customer, 24) + left(String(l.tickets), 5) + amounts(l) + "\n";
    }
    txt += "-".repeat(96) + "\n";
    txt += left("Total", 59) + amounts(g) + "\n";
    txt += "VAT 27% included in the gross amounts.\n\n";
  }
  return txt;
}

/** The mail that tells one organizer about its invoices. */
function renderMail(monthLabel: string, g: OrganizerInvoices): string {
  let body = "Dear " + g.organizer + ",\n\nattached are the ticket invoices TicketBay issued in your name for " + monthLabel + ".\n\n";
  body += "  invoices:  " + g.lines.length + "\n";
  body += "  net:       " + col(g.netCents / 100, 12) + " EUR\n";
  body += "  VAT 27%:   " + col(g.vatCents / 100, 12) + " EUR\n";
  body += "  gross:     " + col(g.grossCents / 100, 12) + " EUR\n\n";
  body += "First invoice: " + g.lines[0]!.invoiceNo + ", last invoice: " + g.lines[g.lines.length - 1]!.invoiceNo + "\n";
  body += "\nThanks,\nTicketBay Finance\n";
  return body;
}

// ---- The edges -------------------------------------------------------------

async function paidOrders(db: Db, month: ExportMonth, event: string | null | undefined): Promise<OrderRow[]> {
  let sql =
    "SELECT o.*, e.name AS event_name, e.venue AS venue FROM orders o JOIN events e ON e.id = o.event_id " +
    "WHERE o.status = 'paid' AND o.created_at_ms >= $1 AND o.created_at_ms < $2";
  const args: unknown[] = [month.start.getTime(), month.end.getTime()];
  if (event) {
    sql += " AND o.event_id = $3";
    args.push(event);
  }
  sql += " ORDER BY e.venue, o.id";
  const res = await db.$client.query<OrderRow>(sql, args);
  return res.rows;
}

// same fake transport as the payout report, the accountants read the outbox file
function sendMail(dir: string, nowMs: number, to: string, subject: string, body: string) {
  console.log("[invoices] mail -> " + to + " (" + subject + ")");
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(
      path.join(dir, "outbox.log"),
      "To: " + to + "\nSubject: " + subject + "\nDate: " + new Date(nowMs).toUTCString() + "\n\n" + body + "\n-----\n",
    );
  } catch (e) {
    console.log("[invoices] could not write outbox", e);
  }
}

export async function invoiceExport(params: InvoiceExportParams, deps: InvoiceExportDeps = {}): Promise<InvoiceExport> {
  const db = getDb();
  const now = deps.now ?? (() => Date.now());
  const dir = deps.reportsDir ?? path.join(process.cwd(), "reports");

  const month = exportMonth(params.month, now());
  console.log("[invoices] export " + month.label + " (" + month.start.toISOString() + " - " + month.end.toISOString() + ") event=" + params.event);
  const rows = await paidOrders(db, month, params.event);
  console.log("[invoices] " + rows.length + " paid orders");

  // batch id: the month plus the first order in it, so finance can tell exports apart
  const batchId = "INV-" + yearMonth(month.start) + "-" + rows[0]!.id;
  const organizers = groupByOrganizer(rows, month.start);

  const csv = renderCsv(batchId, organizers);
  const txt = renderTxt(month.label, batchId, new Date(now()).toISOString(), organizers);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
  const csvFile = path.join(dir, "invoices-" + yearMonth(month.start) + ".csv");
  const txtFile = path.join(dir, "invoices-" + yearMonth(month.start) + ".txt");
  fs.writeFileSync(csvFile, csv);
  fs.writeFileSync(txtFile, txt);
  console.log("[invoices] wrote " + csvFile + " and " + txtFile);

  for (const g of organizers) {
    sendMail(dir, now(), g.email, "TicketBay invoices " + month.label + " (" + batchId + ")", renderMail(month.label, g));
  }

  const result: InvoiceExport = {
    batchId,
    month: yearMonth(month.start),
    generatedAt: new Date(now()).toISOString(),
    organizers,
    totals: batchTotals(organizers),
    files: [path.relative(process.cwd(), csvFile), path.relative(process.cwd(), txtFile)],
    emailsSent: organizers.length,
  };
  lastInvoiceExport = result;
  return result;
}
