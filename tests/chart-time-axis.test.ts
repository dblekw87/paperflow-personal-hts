import { describe, expect, it } from "vitest";

import {
  chartTimeAxisTickIndexes,
  formatChartTimeAxisLabel,
} from "../apps/desktop/src/renderer/features/chart/chart-time-axis.js";

describe("market chart time axis", () => {
  it("keeps first and last candles while limiting overlapping labels", () => {
    const indexes = chartTimeAxisTickIndexes(380, 8);

    expect(indexes).toHaveLength(8);
    expect(indexes[0]).toBe(0);
    expect(indexes.at(-1)).toBe(379);
  });

  it("can reduce labels for a compact right-aligned short series", () => {
    expect(chartTimeAxisTickIndexes(5, 2)).toEqual([0, 4]);
  });

  it("formats intraday ticks as KRX hour and minute", () => {
    expect(
      formatChartTimeAxisLabel(
        "2026-07-21T00:01:00.000Z",
        "1m",
        "1D",
      ),
    ).toContain("09:01");
  });

  it("switches long daily ranges to calendar-scale labels", () => {
    expect(
      formatChartTimeAxisLabel(
        "2026-07-21T00:00:00.000Z",
        "1d",
        "5Y",
      ),
    ).toContain("2026");
  });
});
