import { describe, it, expect } from "vitest";
import { formatCurrency, formatInteger } from "./format";

describe("formatCurrency", () => {
  it("formats positive value", () => {
    expect(formatCurrency(1247.83)).toBe("$1,247.83");
  });

  it("formats negative value without showSign", () => {
    expect(formatCurrency(-42.1)).toBe("$42.10");
  });

  it("formats zero", () => {
    expect(formatCurrency(0)).toBe("$0.00");
  });

  it("formats with showSign positive", () => {
    expect(formatCurrency(1247.83, true)).toBe("+$1,247.83");
  });

  it("formats with showSign negative", () => {
    expect(formatCurrency(-42.1, true)).toBe("-$42.10");
  });

  it("formats with showSign zero", () => {
    expect(formatCurrency(0, true)).toBe("$0.00");
  });

  it("formats large numbers with commas", () => {
    expect(formatCurrency(1000000)).toBe("$1,000,000.00");
  });

  it("rounds to 2 decimal places", () => {
    expect(formatCurrency(1.999)).toBe("$2.00");
  });
});

describe("formatInteger", () => {
  it("formats with commas", () => {
    expect(formatInteger(1000)).toBe("1,000");
  });

  it("formats zero", () => {
    expect(formatInteger(0)).toBe("0");
  });

  it("formats large numbers", () => {
    expect(formatInteger(1000000)).toBe("1,000,000");
  });
});
