// Regression for a bug report: a 10-ticket order was charged the 5% group tier
// instead of 10%. help/early-bird-and-discounts.md promises "10 or more tickets:
// 10% off every ticket", so the ten-ticket boundary is inclusive.
import { describe, it, expect } from "vitest";
import { groupDiscount } from "../../src/domain/booking";
import { buildInvoice, EARLY_BIRD_DAYS } from "../../src/domain/invoice";

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;

describe("regression: a group of ten gets the 10% tier", () => {
  it("gives 10% at the ten-ticket boundary", () => {
    expect(groupDiscount(10)).toBe(10);
  });

  it("prices the reporter's ten-ticket order at 10% off the tickets", () => {
    // Reporter's order: 10 x €79.00, no early-bird, no discount code.
    const ev = {
      id: "e1",
      name: "Nova Kings — Arena Show",
      totalSeats: 100,
      seatsSold: 0,
      priceCents: 7900,
      startMs: NOW + (EARLY_BIRD_DAYS - 1) * DAY,
    };
    const inv = buildInvoice(ev, 10, NOW);
    expect(inv.groupPercent).toBe(10);
    expect(inv.discountCents).toBe(7900); // 10% of €790.00, not the 5% (€39.50) charged
  });
});
