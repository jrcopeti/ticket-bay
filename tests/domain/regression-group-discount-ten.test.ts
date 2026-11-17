import { describe, it, expect } from "vitest";
import { buildInvoice } from "../../src/domain/invoice";
import { priceTiers } from "../../src/domain/pricing";

const NOW = 1700000000000;
const DAY = 86_400_000;
const ev = (priceCents = 5000, daysUntil = 5) => ({
  id: "e1", name: "Midnight Arcade — Neon Tour", totalSeats: 100, seatsSold: 0,
  priceCents, startMs: NOW + daysUntil * DAY,
});

// Regression: help/early-bird-and-discounts.md says "10 or more tickets: 10% off".
// The tier started at 10 but the boundary check used `>` instead of `>=`, so an
// order of exactly 10 tickets got only the 5% tier.
describe("regression — 10 tickets gets the 10% group tier", () => {
  it("gives 10% off for exactly ten tickets", () => {
    const inv = buildInvoice(ev(), 10, NOW);
    expect(inv.groupPercent).toBe(10);
    expect(inv.discountPercent).toBe(10);
    expect(inv.discountCents).toBe(5000);
  });

  it("still gives 5% for the 5-9 ticket tier", () => {
    expect(buildInvoice(ev(), 9, NOW).groupPercent).toBe(5);
  });

  it("still gives 10% above ten tickets", () => {
    expect(buildInvoice(ev(), 11, NOW).groupPercent).toBe(10);
  });

  it("advertises 10% on the 10+ price tier", () => {
    const tenPlus = priceTiers(5000).find((t) => t.minQty === 10);
    expect(tenPlus?.percent).toBe(10);
  });
});
