import { describe, it, expect } from "vitest";
import { money } from "../../lib/format";
import { serviceFee } from "../../src/domain/fees";

// A customer bought 3 tickets for €135.00. The service fee is 3% = 405 cents and
// they were charged 13,905 cents, but checkout showed "€4.50" and "Pay €139.50":
// amounts with fewer than 10 cents were displayed with the cent digit in the tens place.

describe("money shows single-digit cents correctly", () => {
  it("shows the 3% service fee on €135.00 as €4.05", () => {
    expect(money(serviceFee(13_500))).toBe("€4.05");
  });

  it("shows the order total €139.05 as charged, not €139.50", () => {
    expect(money(13_500 + serviceFee(13_500))).toBe("€139.05");
  });

  it("pads every cent value from 1 to 9 with a leading zero", () => {
    for (let c = 1; c <= 9; c++) expect(money(100 + c)).toBe(`€1.0${c}`);
    expect(money(-5)).toBe("−€0.05");
  });
});
