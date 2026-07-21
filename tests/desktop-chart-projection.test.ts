import { describe, expect, it } from "vitest";

import {
  isDesktopChartProjection,
  type DesktopChartProjection,
} from "../apps/desktop/src/shared/desktop-contracts.js";

function minuteProjection(): DesktopChartProjection {
  return {
    schemaVersion: 1,
    instrumentId: "KRX:005930",
    interval: "1m",
    range: "1D",
    state: "READY",
    candles: [
      {
        id: "KRX:005930:1m:2026-07-20T01:00:00.000Z",
        openedAt: "2026-07-20T01:00:00.000Z",
        closedAt: "2026-07-20T01:01:00.000Z",
        open: "70000",
        high: "70100",
        low: "69900",
        close: "70050",
        volume: "1200",
        turnover: null,
        forming: false,
      },
    ],
    source: "KIS_REST",
    turnoverQuality: "UNAVAILABLE",
    paginationComplete: false,
    fetchedAt: "2026-07-20T01:01:01.000Z",
    statusMessage: "KIS 최근 1분봉 · 1개 · 부분 조회 · 거래대금 미제공",
  };
}

describe("desktop chart IPC projection guard", () => {
  it("accepts a US ticker and exact USD decimal candles", () => {
    const projection = minuteProjection();
    expect(isDesktopChartProjection({
      ...projection,
      instrumentId: "NASDAQ:AAPL",
      turnoverQuality: "PROVIDER_REPORTED",
      candles: [{
        ...projection.candles[0],
        id: "NASDAQ:AAPL:1m:2026-07-20T01:00:00.000Z",
        open: "325.1200",
        high: "325.4500",
        low: "325.0100",
        close: "325.3000",
        volume: "1200",
        turnover: "390360.0000",
      }],
    })).toBe(true);
  });
  it("accepts a bounded canonical KIS minute projection", () => {
    expect(isDesktopChartProjection(minuteProjection())).toBe(true);
  });

  it("rejects cumulative turnover disguised as minute turnover", () => {
    const projection = minuteProjection();
    const candle = projection.candles[0]!;
    expect(
      isDesktopChartProjection({
        ...projection,
        candles: [{ ...candle, turnover: "123456789" }],
      }),
    ).toBe(false);
  });

  it("rejects mismatched candle identity and invalid OHLC", () => {
    const projection = minuteProjection();
    const candle = projection.candles[0]!;
    expect(
      isDesktopChartProjection({
        ...projection,
        candles: [
          {
            ...candle,
            id: "KRX:000660:1m:2026-07-20T01:00:00.000Z",
            high: "69000",
          },
        ],
      }),
    ).toBe(false);
  });

  it("accepts a locally aggregated KIS intraday projection", () => {
    const projection = minuteProjection();
    const candle = projection.candles[0]!;
    expect(
      isDesktopChartProjection({
        ...projection,
        interval: "5m",
        source: "KIS_REST_AGGREGATED",
        candles: [
          {
            ...candle,
            id: "KRX:005930:5m:2026-07-20T01:00:00.000Z",
            closedAt: "2026-07-20T01:05:00.000Z",
          },
        ],
      }),
    ).toBe(true);
  });

  it("accepts a same-day 4-hour projection and rejects an invalid long range", () => {
    const projection = minuteProjection();
    const candle = projection.candles[0]!;
    const fourHour = {
      ...projection,
      interval: "4h",
      source: "KIS_REST_AGGREGATED",
      candles: [
        {
          ...candle,
          id: "KRX:005930:4h:2026-07-20T01:00:00.000Z",
          closedAt: "2026-07-20T05:00:00.000Z",
        },
      ],
    };
    expect(isDesktopChartProjection(fourHour)).toBe(true);
    expect(
      isDesktopChartProjection({ ...fourHour, range: "5Y" }),
    ).toBe(false);
  });

  it("accepts a five-year daily projection combination", () => {
    const candles = Array.from({ length: 401 }, (_, index) => {
      const openedAt = new Date(
        Date.UTC(2025, 0, 1 + index, 0, 0, 0),
      ).toISOString();
      const closedAt = new Date(
        Date.parse(openedAt) + 6.5 * 60 * 60 * 1_000,
      ).toISOString();
      return {
        id: `KRX:005930:1d:${openedAt}`,
        openedAt,
        closedAt,
        open: "70000",
        high: "70100",
        low: "69900",
        close: "70050",
        volume: "1200",
        turnover: "84060000",
        forming: false,
      };
    });
    expect(
      isDesktopChartProjection({
        ...minuteProjection(),
        interval: "1d",
        range: "5Y",
        source: "KIS_REST",
        turnoverQuality: "PROVIDER_REPORTED",
        candles,
      }),
    ).toBe(true);
  });
});
