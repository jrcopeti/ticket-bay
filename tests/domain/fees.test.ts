import { describe, it, expect } from "vitest";
import { serviceFee, vatPortion } from "../../src/domain/fees";

describe("serviceFee", () => {
  it("charges 3% on a normal order", () => {
    expect(serviceFee(10000)).toBe(300);
  });

  it("charges the 100-cent minimum on a small order", () => {
    // 3% of €10 is 30 cents
    expect(serviceFee(1000)).toBe(100);
  });

  it("charges the minimum when 3% comes to 99 cents, one short of it", () => {
    // 3% of €33 is 99 cents
    expect(serviceFee(3300)).toBe(100);
  });

  it("caps the fee at 2000 cents on a large order", () => {
    // 3% of €1,000 is 3000 cents
    expect(serviceFee(100000)).toBe(2000);
  });

  it("caps the fee when 3% comes to 2001 cents, one over the cap", () => {
    // 3% of €667 is 2001 cents
    expect(serviceFee(66700)).toBe(2000);
  });
});

describe("vatPortion", () => {
  it("extracts 27% VAT from a gross price", () => {
    expect(vatPortion(12700, 27)).toBe(2700);
  });
});
