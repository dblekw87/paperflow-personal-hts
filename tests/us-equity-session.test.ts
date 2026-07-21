import { describe, expect, it } from "vitest";
import { resolveUsEquitySession } from "../src/market-data/us-equity-session.js";

describe("US equity sessions", () => {
  it("resolves all three New York sessions across daylight saving time", () => {
    expect(resolveUsEquitySession(new Date("2026-07-20T08:00:00Z"))).toBe("PRE");
    expect(resolveUsEquitySession(new Date("2026-07-20T13:30:00Z"))).toBe("REGULAR");
    expect(resolveUsEquitySession(new Date("2026-07-20T20:00:00Z"))).toBe("AFTER");
    expect(resolveUsEquitySession(new Date("2026-01-20T09:00:00Z"))).toBe("PRE");
    expect(resolveUsEquitySession(new Date("2026-07-19T15:00:00Z"))).toBe("CLOSED");
  });
});
