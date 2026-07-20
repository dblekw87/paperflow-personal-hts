import { describe, expect, it } from "vitest";

import {
  MAX_RENDERED_CHART_CANDLES,
  MAX_RENDERED_ONE_MINUTE_CANDLES,
  downsampleCandlesForView,
} from "../apps/desktop/src/renderer/features/chart/chart-view-sampling.js";

describe("long-range chart view sampling", () => {
  it("caps a five-year-sized series while preserving bucket OHLC and measures", () => {
    const candles = Array.from({ length: 1_250 }, (_, index) => ({
      id: `candle-${index}`,
      openedAt: new Date(Date.UTC(2021, 0, 1 + index)).toISOString(),
      open: String(100 + index),
      high: String(110 + index),
      low: String(90 + index),
      close: String(105 + index),
      volume: "9007199254740993",
      turnover: String(1_000 + index),
      forming: index === 1_249,
    }));

    const buckets = downsampleCandlesForView(candles);

    expect(buckets).toHaveLength(MAX_RENDERED_CHART_CANDLES);
    expect(buckets[0]).toMatchObject({
      sourceStartIndex: 0,
      sourceEndIndex: 2,
      candle: {
        open: "100",
        high: "112",
        low: "90",
        close: "107",
        volume: "27021597764222979",
      },
    });
    expect(buckets.at(-1)).toMatchObject({
      sourceEndIndex: 1_249,
      candle: {
        close: "1354",
        forming: true,
      },
    });
  });

  it("keeps a short series one-to-one and rejects an invalid cap", () => {
    const candle = {
      id: "one",
      openedAt: "2026-07-20T00:00:00.000Z",
      open: "100",
      high: "101",
      low: "99",
      close: "100",
      volume: null,
      turnover: null,
    };
    expect(downsampleCandlesForView([candle], 10)).toEqual([
      {
        candle,
        sourceStartIndex: 0,
        sourceEndIndex: 0,
      },
    ]);
    expect(() => downsampleCandlesForView([candle], 0)).toThrow(
      /positive integer/,
    );
  });

  it("keeps a complete KRX one-minute session one-to-one", () => {
    const candles = Array.from({ length: 380 }, (_, index) => ({
      id: `minute-${index}`,
      openedAt: new Date(
        Date.parse("2026-07-20T00:00:00.000Z") + index * 60_000,
      ).toISOString(),
      open: String(100 + index),
      high: String(101 + index),
      low: String(99 + index),
      close: String(100 + index),
      volume: String(index),
      turnover: null,
    }));

    const buckets = downsampleCandlesForView(
      candles,
      MAX_RENDERED_ONE_MINUTE_CANDLES,
    );

    expect(buckets).toHaveLength(380);
    expect(
      buckets.every(
        (bucket) => bucket.sourceStartIndex === bucket.sourceEndIndex,
      ),
    ).toBe(true);
    expect(buckets[200]?.candle).toEqual(candles[200]);
  });
});
