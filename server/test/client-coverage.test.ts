import { describe, expect, it } from "vitest";
import { carriersByState, parseStatePlans } from "../src/lib/client-coverage";

describe("parseStatePlans", () => {
  it("returns undefined when the key is absent, so existing callers are untouched", () => {
    expect(parseStatePlans(undefined)).toBeUndefined();
  });

  it("accepts valid entries and dedupes plans", () => {
    const r = parseStatePlans([{ state: "Texas", carrier: " Aetna ", plans: ["LEVEL", "LEVEL", "GI"] }]);
    expect(r).toEqual({ value: [{ state: "Texas", carrier: "Aetna", plans: ["LEVEL", "GI"] }] });
  });

  it("keeps a carrier with no plans ticked (available, nothing set yet)", () => {
    const r = parseStatePlans([{ state: "Ohio", carrier: "AIG", plans: [] }]);
    expect(r).toEqual({ value: [{ state: "Ohio", carrier: "AIG", plans: [] }] });
  });

  it("drops a duplicate state + carrier case-insensitively", () => {
    const r = parseStatePlans([
      { state: "Texas", carrier: "Aetna", plans: ["LEVEL"] },
      { state: "Texas", carrier: "AETNA", plans: ["GI"] },
    ]);
    expect(r).toEqual({ value: [{ state: "Texas", carrier: "Aetna", plans: ["LEVEL"] }] });
  });

  it("rejects an unknown state, an unknown plan, and non-list input", () => {
    expect(parseStatePlans([{ state: "Narnia", carrier: "A", plans: [] }])).toHaveProperty("error");
    expect(parseStatePlans([{ state: "Texas", carrier: "A", plans: ["PLATINUM"] }])).toHaveProperty("error");
    expect(parseStatePlans("nope")).toHaveProperty("error");
    expect(parseStatePlans([null])).toHaveProperty("error");
  });
});

describe("carriersByState", () => {
  it("groups carriers under their state in input order", () => {
    expect(
      carriersByState([
        { state: "Texas", carrier: "Aetna", plans: ["LEVEL"] },
        { state: "Texas", carrier: "AIG", plans: [] },
        { state: "Ohio", carrier: "Gerber", plans: ["GI"] },
      ]),
    ).toEqual([
      { state: "Texas", carriers: ["Aetna", "AIG"] },
      { state: "Ohio", carriers: ["Gerber"] },
    ]);
  });
});
