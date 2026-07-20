import { describe, expect, it } from "vitest";

import {
  InstrumentChartProjectionSchema,
  InstrumentChartSettingsSchema,
  InstrumentWorkspaceVisibilitySchema,
} from "../src/contracts/instrument-chart.js";

const candle = {
  instrumentId: "KRX:005930",
  interval: "1m" as const,
  session: "REGULAR" as const,
  openedAt: "2026-07-20T00:00:00+00:00",
  closedAt: "2026-07-20T00:01:00+00:00",
  state: "CLOSED" as const,
  open: "70000",
  high: "70500",
  low: "69900",
  close: "70400",
  volume: "120000",
  volumeProvenance: "PROVIDER_REPORTED" as const,
  turnover: "8424000000",
  turnoverProvenance: "PROVIDER_REPORTED" as const,
  turnoverCalculation: null,
  currency: "KRW" as const,
  source: "KIS_CANONICAL_MARKET_DATA" as const,
  freshness: "LIVE" as const,
  isAdjusted: true,
};

const settings = {
  movingAverages: [
    { period: 5, basis: "CLOSE" as const, kind: "SMA" as const, visible: true },
    {
      period: 20,
      basis: "CLOSE" as const,
      kind: "EMA" as const,
      visible: true,
    },
  ],
  showVolume: true,
  showTurnover: true,
  showPaperFillMarkers: true,
  timeZone: "ASIA_SEOUL" as const,
  includeExtendedHours: false,
};

describe("instrument chart contract", () => {
  it("keeps canonical candles and local paper fills in separate sources", () => {
    const projection = InstrumentChartProjectionSchema.parse({
      instrumentId: "KRX:005930",
      asOf: "2026-07-20T00:02:00+00:00",
      interval: "1m",
      candles: [candle],
      paperFillMarkers: [
        {
          markerId: "marker-1",
          localOrderId: "order-1",
          localFillId: "fill-1",
          instrumentId: "KRX:005930",
          side: "BUY",
          fillState: "PARTIAL_FILL",
          filledAt: "2026-07-20T00:00:30+00:00",
          price: "70100",
          quantity: "3",
          source: "LOCAL_PAPER_FILL",
        },
      ],
      settings,
    });

    expect(projection.candles[0]?.source).toBe("KIS_CANONICAL_MARKET_DATA");
    expect(projection.paperFillMarkers[0]?.source).toBe("LOCAL_PAPER_FILL");
    expect(projection.settings.showTurnover).toBe(true);
  });

  it("rejects impossible OHLC and cross-instrument fill markers", () => {
    expect(() =>
      InstrumentChartProjectionSchema.parse({
        instrumentId: "KRX:005930",
        asOf: "2026-07-20T00:02:00+00:00",
        interval: "1m",
        candles: [{ ...candle, high: "69800" }],
        paperFillMarkers: [
          {
            markerId: "marker-1",
            localOrderId: "order-1",
            localFillId: "fill-1",
            instrumentId: "KRX:000660",
            side: "SELL",
            fillState: "FULL_FILL",
            filledAt: "2026-07-20T00:00:30+00:00",
            price: "70100",
            quantity: "1",
            source: "LOCAL_PAPER_FILL",
          },
        ],
        settings,
      }),
    ).toThrow();
  });

  it("rejects duplicate indicator settings", () => {
    expect(() =>
      InstrumentChartSettingsSchema.parse({
        ...settings,
        movingAverages: [
          settings.movingAverages[0],
          settings.movingAverages[0],
        ],
      }),
    ).toThrow(/Duplicate moving-average/);
  });

  it("distinguishes zero from unavailable and validates turnover provenance", () => {
    expect(
      InstrumentChartProjectionSchema.parse({
        instrumentId: "KRX:005930",
        asOf: "2026-07-20T00:02:00+00:00",
        interval: "1m",
        candles: [
          {
            ...candle,
            volume: null,
            volumeProvenance: "UNAVAILABLE",
            turnover: "0",
          },
        ],
        paperFillMarkers: [],
        settings,
      }).candles[0]?.volume,
    ).toBeNull();

    expect(() =>
      InstrumentChartProjectionSchema.parse({
        instrumentId: "KRX:005930",
        asOf: "2026-07-20T00:02:00+00:00",
        interval: "1m",
        candles: [
          {
            ...candle,
            turnoverProvenance: "LOCAL_TRADE_AGGREGATE",
            turnoverCalculation: null,
          },
        ],
        paperFillMarkers: [],
        settings,
      }),
    ).toThrow(/Local turnover requires/);
  });

  it("rejects a closed candle that ends after projection asOf", () => {
    expect(() =>
      InstrumentChartProjectionSchema.parse({
        instrumentId: "KRX:005930",
        asOf: "2026-07-20T00:00:30+00:00",
        interval: "1m",
        candles: [candle],
        paperFillMarkers: [],
        settings,
      }),
    ).toThrow(/ends after projection asOf/);
  });

  it("makes same-page chart and orderbook visibility an invariant", () => {
    expect(
      InstrumentWorkspaceVisibilitySchema.parse({
        instrumentId: "KRX:005930",
        chart: "VISIBLE",
        orderBook: "VISIBLE",
        samePage: true,
      }),
    ).toBeTruthy();
    expect(() =>
      InstrumentWorkspaceVisibilitySchema.parse({
        instrumentId: "KRX:005930",
        chart: "VISIBLE",
        orderBook: "HIDDEN",
        samePage: false,
      }),
    ).toThrow();
  });
});
