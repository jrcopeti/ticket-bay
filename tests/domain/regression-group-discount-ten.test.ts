// Regression: an order of exactly ten tickets was charged the 5% group tier
// instead of the 10% tier the help pages promise (help/early-bird-and-discounts.md:
// "10 or more tickets: 10% off every ticket").
import { describe, it, expect } from "vitest";
import { groupDiscount } from "../../src/domain/booking";
import { buildInvoice } from "../../src/domain/invoice";

const DAY = 86_400_000;
const NOW = 1_800_000_000_000;

// Midnight Arcade — Neon Tour, €45 a ticket, booked 5 days out (no early-bird).
const event = {
  id: "midnight-arcade-neon-tour",
  name: "Midnight Arcade — Neon Tour",
  totalSeats: 300,
  seatsSold: 0,
  priceCents: 4500,
  startMs: NOW + 5 * DAY,
};

describe("regression: group discount at exactly ten tickets", () => {
  it("puts an order of ten tickets on the 10% tier", () => {
    expect(groupDiscount(10)).toBe(10);
  });

  it("charges ten tickets 10% off, as the help pages promise", () => {
    const inv = buildInvoice(event, 10, NOW);
    expect(inv.groupPercent).toBe(10);
    expect(inv.subtotalCents).toBe(45_000); // 10 × €45.00
    expect(inv.discountCents).toBe(4_500); // 10% of €450.00
    expect(inv.ticketsCents).toBe(40_500);
    expect(inv.totalCents).toBe(41_715); // €417.15, not the €440.33 the reporter paid
  });
});
