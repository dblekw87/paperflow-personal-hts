import { describe, expect, it } from "vitest";
import { normalizeUsIntradayRows } from "../src/kis/us-chart.js";

describe("KIS US chart canonical adapter", () => {
  it("normalizes anonymized KST candle timestamps and exact decimals", () => {
    expect(normalizeUsIntradayRows([{ kymd: "20260721", khms: "220000", open: "226.50", high: "227.10", low: "226.40", last: "226.95", evol: "1200", eamt: "272100" }], 1)).toEqual([{
      openedAt: "2026-07-21T13:00:00.000Z", closedAt: "2026-07-21T13:01:00.000Z",
      open: "226.50", high: "227.10", low: "226.40", close: "226.95", volume: "1200", turnover: "272100",
    }]);
  });
});
