import { describe, expect, it } from "vitest";

import type { z } from "zod";

import type { ChartCandleSchema } from "../src/contracts/instrument-chart.js";
import {
  AggregatedDomesticCandleHistorySchema,
  type DomesticCandleHistory,
} from "../src/contracts/market-history.js";
import { aggregateDomesticCandleHistory } from "../src/market-data/domestic-candle-aggregation.js";

type ChartCandle = z.infer<typeof ChartCandleSchema>;

describe("domestic candle aggregation", () => {
  it("aggregates observed 1-minute candles into an exact KST 5-minute bucket", () => {
    const history = minuteHistory(
      [
        minuteCandle("09:00", {
          open: "100.10",
          high: "101.20",
          low: "99.90",
          close: "100.50",
          volume: "9007199254740993",
        }),
        minuteCandle("09:01", {
          open: "100.50",
          high: "103.25",
          low: "100.20",
          close: "102.00",
          volume: "2",
        }),
        minuteCandle("09:04", {
          open: "102.00",
          high: "102.10",
          low: "98.75",
          close: "99.25",
          volume: "0.5",
        }),
        minuteCandle(
          "09:05",
          {
            open: "99.25",
            high: "100.00",
            low: "99.00",
            close: "99.75",
            volume: "4",
          },
          "FORMING",
        ),
      ],
      "2026-07-20T00:05:30.000Z",
    );

    const aggregated = aggregateDomesticCandleHistory(history, "5m");

    expect(AggregatedDomesticCandleHistorySchema.parse(aggregated)).toEqual(
      aggregated,
    );
    expect(aggregated.source).toMatchObject({
      inputInterval: "1m",
      bucketPolicy: "DOMESTIC_INTEGRATED_SESSION_ANCHORED_KST",
      gapPolicy: "OBSERVED_CANDLES_ONLY",
    });
    expect(aggregated.candles).toHaveLength(2);
    expect(aggregated.candles[0]).toMatchObject({
      openedAt: "2026-07-20T00:00:00.000Z",
      closedAt: "2026-07-20T00:05:00.000Z",
      state: "CLOSED",
      open: "100.10",
      high: "103.25",
      low: "98.75",
      close: "99.25",
      volume: "9007199254740995.5",
      volumeProvenance: "PROVIDER_REPORTED",
      turnover: null,
      turnoverProvenance: "UNAVAILABLE",
    });
    expect(aggregated.candles[1]).toMatchObject({
      openedAt: "2026-07-20T00:05:00.000Z",
      closedAt: "2026-07-20T00:10:00.000Z",
      state: "FORMING",
      freshness: "LIVE",
    });
    expect(aggregated.quality.turnover).toBe("UNAVAILABLE");
  });

  it("does not fabricate empty interval buckets across input gaps", () => {
    const history = minuteHistory(
      [minuteCandle("09:00"), minuteCandle("09:10")],
      "2026-07-20T00:20:00.000Z",
    );

    const aggregated = aggregateDomesticCandleHistory(history, "5m");

    expect(aggregated.candles.map((candle) => candle.openedAt)).toEqual([
      "2026-07-20T00:00:00.000Z",
      "2026-07-20T00:10:00.000Z",
    ]);
  });

  it("clips intraday buckets at KRX session boundaries and never merges sessions", () => {
    const history = minuteHistory(
      [
        minuteCandle("15:19", {}, "CLOSED", "REGULAR"),
        minuteCandle("15:20", {}, "FORMING", "CLOSING_AUCTION"),
      ],
      "2026-07-20T06:20:30.000Z",
    );

    const aggregated = aggregateDomesticCandleHistory(history, "60m");

    expect(aggregated.candles).toHaveLength(2);
    expect(aggregated.candles[0]).toMatchObject({
      session: "REGULAR",
      openedAt: "2026-07-20T06:00:00.000Z",
      closedAt: "2026-07-20T06:20:00.000Z",
      state: "CLOSED",
    });
    expect(aggregated.candles[1]).toMatchObject({
      session: "CLOSING_AUCTION",
      openedAt: "2026-07-20T06:20:00.000Z",
      closedAt: "2026-07-20T06:30:00.000Z",
      state: "FORMING",
    });
  });

  it("anchors integrated domestic premarket and after-hours buckets to NXT sessions", () => {
    const history = minuteHistory(
      [
        minuteCandle("08:00", { open: "100", close: "101" }, "CLOSED", "PRE_MARKET"),
        minuteCandle("08:49", { high: "105", close: "104" }, "CLOSED", "PRE_MARKET"),
        minuteCandle(
          "15:40",
          { open: "110", high: "112", low: "109", close: "111" },
          "CLOSED",
          "AFTER_MARKET",
        ),
        minuteCandle(
          "19:59",
          { open: "118", high: "120", low: "117", close: "119" },
          "FORMING",
          "AFTER_MARKET",
        ),
      ],
      "2026-07-20T10:59:30.000Z",
    );

    const aggregated = aggregateDomesticCandleHistory(history, "60m");

    expect(aggregated.candles).toHaveLength(3);
    expect(aggregated.candles[0]).toMatchObject({
      session: "PRE_MARKET",
      openedAt: "2026-07-19T23:00:00.000Z",
      closedAt: "2026-07-19T23:50:00.000Z",
      open: "100",
      close: "104",
    });
    expect(aggregated.candles[1]).toMatchObject({
      session: "AFTER_MARKET",
      openedAt: "2026-07-20T06:40:00.000Z",
      closedAt: "2026-07-20T07:40:00.000Z",
      open: "110",
      close: "111",
    });
    expect(aggregated.candles[2]).toMatchObject({
      session: "AFTER_MARKET",
      openedAt: "2026-07-20T10:40:00.000Z",
      closedAt: "2026-07-20T11:00:00.000Z",
      close: "119",
      state: "FORMING",
    });
  });

  it("builds regular-session 4-hour candles and clips the final bucket", () => {
    const history = minuteHistory(
      [
        minuteCandle("09:00", { open: "100", close: "101" }),
        minuteCandle("12:59", { high: "110", close: "109" }),
        minuteCandle("13:00", {
          open: "109",
          high: "109",
          low: "107",
          close: "108",
        }),
        minuteCandle("15:19", { low: "90", close: "95" }),
        minuteCandle(
          "15:29",
          {
            open: "94",
            high: "94",
            low: "94",
            close: "94",
            volume: "1000",
          },
          "CLOSED",
          "CLOSING_AUCTION",
        ),
      ],
      "2026-07-20T06:31:00.000Z",
    );

    const aggregated = aggregateDomesticCandleHistory(history, "4h");

    expect(aggregated.candles).toHaveLength(3);
    expect(aggregated.candles[0]).toMatchObject({
      interval: "4h",
      session: "REGULAR",
      openedAt: "2026-07-20T00:00:00.000Z",
      closedAt: "2026-07-20T04:00:00.000Z",
      open: "100",
      high: "110",
      close: "109",
    });
    expect(aggregated.candles[1]).toMatchObject({
      interval: "4h",
      session: "REGULAR",
      openedAt: "2026-07-20T04:00:00.000Z",
      closedAt: "2026-07-20T06:20:00.000Z",
      open: "109",
      low: "90",
      close: "95",
    });
    expect(aggregated.candles[2]).toMatchObject({
      interval: "4h",
      session: "CLOSING_AUCTION",
      openedAt: "2026-07-20T06:20:00.000Z",
      closedAt: "2026-07-20T06:30:00.000Z",
      close: "94",
      volume: "1000",
    });
  });

  it("aggregates daily candles into Monday-to-Friday KRX weeks without filling holidays", () => {
    const history = dailyHistory(
      [
        dailyCandle("2026-07-17", "CLOSED", {
          open: "80000",
          high: "81000",
          low: "79000",
          close: "80500",
          volume: "10",
          turnover: "800000",
        }),
        dailyCandle("2026-07-21", "CLOSED", {
          open: "81000",
          high: "82000",
          low: "80500",
          close: "81500",
          volume: "20",
          turnover: "1620000",
        }),
        dailyCandle("2026-07-22", "FORMING", {
          open: "81500",
          high: "83000",
          low: "81200",
          close: "82500",
          volume: "30",
          turnover: "2475000",
        }),
      ],
      "2026-07-22T01:00:00.000Z",
    );

    const aggregated = aggregateDomesticCandleHistory(history, "1w");

    expect(aggregated.candles).toHaveLength(2);
    expect(aggregated.candles[0]).toMatchObject({
      openedAt: "2026-07-13T00:00:00.000Z",
      closedAt: "2026-07-17T06:30:00.000Z",
      state: "CLOSED",
      volume: "10",
      turnover: "800000",
    });
    expect(aggregated.candles[1]).toMatchObject({
      openedAt: "2026-07-20T00:00:00.000Z",
      closedAt: "2026-07-24T06:30:00.000Z",
      state: "FORMING",
      open: "81000",
      high: "83000",
      low: "80500",
      close: "82500",
      volume: "50",
      turnover: "4095000",
      volumeProvenance: "PROVIDER_REPORTED",
      turnoverProvenance: "PROVIDER_REPORTED",
      freshness: "LIVE",
    });
  });

  it("rejects incompatible source intervals and mixed adjustment states", () => {
    expect(() =>
      aggregateDomesticCandleHistory(
        minuteHistory(
          [minuteCandle("09:00")],
          "2026-07-20T00:01:00.000Z",
        ),
        "1w",
      ),
    ).toThrow(/requires canonical 1d input/);

    const mixed = dailyHistory(
      [
        dailyCandle("2026-07-20", "CLOSED"),
        { ...dailyCandle("2026-07-21", "CLOSED"), isAdjusted: false },
      ],
      "2026-07-25T00:00:00.000Z",
    );
    expect(() => aggregateDomesticCandleHistory(mixed, "1w")).toThrow(
      /adjusted and original/,
    );
  });
});

function minuteHistory(
  candles: ChartCandle[],
  fetchedAt: string,
): DomesticCandleHistory {
  return {
    schemaVersion: 1,
    instrumentId: "KRX:005930",
    interval: "1m",
    exchangeTimezone: "Asia/Seoul",
    candles,
    source: {
      provider: "KIS",
      transport: "REST",
      dataEnvironment: "paper",
      path: "/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice",
      trId: "FHKST03010200",
      fetchedAt,
      officialSampleCommit: "885dd4e2f5c37e4f7e23dd63c15555a9967bc7bc",
    },
    pagination: {
      strategy: "TIME_CURSOR_BACKWARD_WITH_DEDUPLICATION",
      pageSizeLimit: 30,
      pagesFetched: 1,
      maxPages: 1,
      complete: true,
      nextCursor: null,
    },
    quality: {
      coverage: "CURRENT_KRX_BUSINESS_DAY_ONLY",
      priceAdjustment: "CURRENT_SESSION_ORIGINAL",
      volume: "PROVIDER_REPORTED",
      turnover: "UNAVAILABLE",
      caveats: [
        "MINUTE_TURNOVER_IS_UNAVAILABLE_BECAUSE_KIS_REPORTS_CUMULATIVE_TURNOVER",
      ],
    },
  };
}

function dailyHistory(
  candles: ChartCandle[],
  fetchedAt: string,
): DomesticCandleHistory {
  return {
    schemaVersion: 1,
    instrumentId: "KRX:005930",
    interval: "1d",
    exchangeTimezone: "Asia/Seoul",
    candles,
    source: {
      provider: "KIS",
      transport: "REST",
      dataEnvironment: "paper",
      path: "/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice",
      trId: "FHKST03010100",
      fetchedAt,
      officialSampleCommit: "885dd4e2f5c37e4f7e23dd63c15555a9967bc7bc",
    },
    pagination: {
      strategy: "DATE_WINDOW_BACKWARD_WITH_DEDUPLICATION",
      pageSizeLimit: 100,
      pagesFetched: 1,
      maxPages: 1,
      complete: true,
      nextCursor: null,
    },
    quality: {
      coverage: "REQUESTED_DATE_RANGE",
      priceAdjustment: "ADJUSTED",
      volume: "PROVIDER_REPORTED",
      turnover: "PROVIDER_REPORTED",
      caveats: [],
    },
  };
}

function minuteCandle(
  time: string,
  values: Partial<
    Pick<
      ChartCandle,
      "open" | "high" | "low" | "close" | "volume" | "turnover"
    >
  > = {},
  state: ChartCandle["state"] = "CLOSED",
  session: ChartCandle["session"] = "REGULAR",
): ChartCandle {
  const opened = new Date(`2026-07-20T${time}:00+09:00`);
  return {
    instrumentId: "KRX:005930",
    interval: "1m",
    session,
    openedAt: opened.toISOString(),
    closedAt: new Date(opened.getTime() + 60_000).toISOString(),
    state,
    open: values.open ?? "100",
    high: values.high ?? "101",
    low: values.low ?? "99",
    close: values.close ?? "100",
    volume: values.volume ?? "1",
    volumeProvenance: "PROVIDER_REPORTED",
    turnover: null,
    turnoverProvenance: "UNAVAILABLE",
    turnoverCalculation: null,
    currency: "KRW",
    source: "KIS_CANONICAL_MARKET_DATA",
    freshness: state === "FORMING" ? "LIVE" : "CLOSED",
    isAdjusted: false,
  };
}

function dailyCandle(
  date: string,
  state: ChartCandle["state"],
  values: Partial<
    Pick<
      ChartCandle,
      "open" | "high" | "low" | "close" | "volume" | "turnover"
    >
  > = {},
): ChartCandle {
  return {
    instrumentId: "KRX:005930",
    interval: "1d",
    session: "REGULAR",
    openedAt: new Date(`${date}T09:00:00+09:00`).toISOString(),
    closedAt: new Date(`${date}T15:30:00+09:00`).toISOString(),
    state,
    open: values.open ?? "80000",
    high: values.high ?? "81000",
    low: values.low ?? "79000",
    close: values.close ?? "80500",
    volume: values.volume ?? "10",
    volumeProvenance: "PROVIDER_REPORTED",
    turnover: values.turnover ?? "800000",
    turnoverProvenance: "PROVIDER_REPORTED",
    turnoverCalculation: null,
    currency: "KRW",
    source: "KIS_CANONICAL_MARKET_DATA",
    freshness: state === "FORMING" ? "LIVE" : "CLOSED",
    isAdjusted: true,
  };
}
