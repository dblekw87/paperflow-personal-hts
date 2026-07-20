import { describe, expect, it } from "vitest";

import {
  desktopChartCacheTtlMs,
  resolveDesktopChartRange,
  resolveDesktopIntradayCursor,
} from "../apps/desktop/src/main/desktop-runtime.js";

describe("desktop chart calendar ranges", () => {
  const now = new Date("2026-07-20T03:00:00.000Z");

  it("maps 6 months, 1 year, and 5 years to bounded KIS page plans", () => {
    expect(resolveDesktopChartRange("6M", now)).toEqual({
      startDate: "20260120",
      endDate: "20260720",
      maxPages: 2,
    });
    expect(resolveDesktopChartRange("1Y", now)).toEqual({
      startDate: "20250720",
      endDate: "20260720",
      maxPages: 4,
    });
    expect(resolveDesktopChartRange("5Y", now)).toEqual({
      startDate: "20210720",
      endDate: "20260720",
      maxPages: 15,
    });
  });

  it("clamps a month-end date instead of overflowing into March", () => {
    expect(
      resolveDesktopChartRange(
        "6M",
        new Date("2024-08-31T03:00:00.000Z"),
      ).startDate,
    ).toBe("20240229");
  });

  it("uses the Asia/Seoul business date near a UTC day boundary", () => {
    expect(
      resolveDesktopChartRange(
        "1Y",
        new Date("2026-07-19T16:00:00.000Z"),
      ).endDate,
    ).toBe("20260720");
  });

  it("caps an after-hours intraday request at the 15:30 KRX close", () => {
    expect(
      resolveDesktopIntradayCursor(
        new Date("2026-07-20T08:30:00.000Z"),
      ),
    ).toBe("153000");
    expect(
      resolveDesktopIntradayCursor(
        new Date("2026-07-20T05:05:06.000Z"),
      ),
    ).toBe("140506");
    expect(
      resolveDesktopIntradayCursor(
        new Date("2026-07-19T17:05:06.000Z"),
      ),
    ).toBe("153000");
  });

  it("uses a short cache for forming daily and weekly candles", () => {
    expect(desktopChartCacheTtlMs("1m", false)).toBe(15_000);
    expect(desktopChartCacheTtlMs("1d", true)).toBe(15_000);
    expect(desktopChartCacheTtlMs("1w", true)).toBe(15_000);
    expect(desktopChartCacheTtlMs("1d", false)).toBe(21_600_000);
  });
});
