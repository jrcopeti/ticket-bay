import { describe, it, expect } from "vitest";
import { buildInvoice } from "../../src/domain/invoice";
import { priceTiers } from "../../src/domain/pricing";

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;
// The reported order: Midnight Arcade, €45.00 per ticket, 10 tickets, no early-bird.
const ev = (priceCents = 4500, daysUntil = 5) => ({
  id: "midnight-arcade-neon-tour",
  name: "Midnight Arcade — Neon Tour",
  totalSeats: 1000,
  seatsSold: 0,
  priceCents,
  startMs: NOW + daysUntil * DAY,
});

// Reported via a bug report: the discounts page says "10 or more tickets: 10%
// off every ticket", but a 10-ticket order was charged the 5% group discount.
describe("regression — a group of exactly 10 tickets gets 10% off", () => {
  it("applies the 10% tier at quantity 10", () => {
    const inv = buildInvoice(ev(), 10, NOW);
    expect(inv.groupPercent).toBe(10);
    expect(inv.discountPercent).toBe(10);
  });

  it("charges the reported order €417.15, not €440.33", () => {
    const inv = buildInvoice(ev(), 10, NOW);
    expect(inv.subtotalCents).toBe(45000);
    expect(inv.discountCents).toBe(4500);
    expect(inv.ticketsCents).toBe(40500);
    expect(inv.feeCents).toBe(1215);
    expect(inv.totalCents).toBe(41715);
  });

  it("advertises 10% on the 10+ price tier", () => {
    const tenPlus = priceTiers(4500).find((t) => t.minQty === 10);
    expect(tenPlus?.percent).toBe(10);
    expect(tenPlus?.unitCents).toBe(4050);
  });
});
