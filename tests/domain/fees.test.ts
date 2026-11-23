import { describe, it, expect } from "vitest";
import { serviceFee } from "../../src/domain/fees";

describe("serviceFee", () => {
  it("charges 3% on a normal order", () => {
    expect(serviceFee(10000)).toBe(300);
  });
  it("applies the minimum fee on small orders", () => {
    expect(serviceFee(1000)).toBe(100);
  });
  it("caps the fee on huge orders", () => {
    expect(serviceFee(100000)).toBe(2000);
  });
  it("charges the minimum when 3% comes to 99 cents", () => {
    expect(serviceFee(3300)).toBe(100);
  });
  it("caps the fee when 3% comes to 2001 cents", () => {
    expect(serviceFee(66700)).toBe(2000);
  });
});
