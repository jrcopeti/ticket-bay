// Regression: a booking of exactly ten tickets must get the 10% group tier.
// help/early-bird-and-discounts.md: "10 or more tickets: 10% off every ticket".
// The reporter (Midnight Arcade — Neon Tour, 10 tickets, €45.00 each) was
// charged €440.33 because ten tickets fell through to the 5% tier; with the
// 10% discount the same order is €417.15.
import { describe, it, expect } from "vitest";
import { groupDiscount } from "../../src/domain/booking";
import { buildInvoice } from "../../src/domain/invoice";

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;
// Midnight Arcade — Neon Tour: 12 days out, so no early-bird on top.
const ev = { id: "midnight-arcade-neon-tour", name: "Midnight Arcade", totalSeats: 300, seatsSold: 0, priceCents: 4500, startMs: NOW + 12 * DAY };

describe("regression — ten tickets get the 10% group tier", () => {
  it("gives 10% for a group of exactly ten", () => {
    expect(groupDiscount(10)).toBe(10);
  });

  it("keeps ten-plus groups on the 10% tier", () => {
    expect(groupDiscount(11)).toBe(10);
  });

  it("prices ten tickets at the 10% group discount", () => {
    const inv = buildInvoice(ev, 10, NOW);
    expect(inv.groupPercent).toBe(10);
    expect(inv.discountPercent).toBe(10);
    expect(inv.totalCents).toBe(41715);
  });
});
