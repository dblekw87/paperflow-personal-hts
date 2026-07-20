import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { DomesticCandleHistorySchema } from "../src/contracts/market-history.js";
import {
  KIS_DOMESTIC_CHART_POLICY,
  KisDomesticChartClient,
} from "../src/kis/domestic-chart.js";

const intradayFixture = readFixture("domestic-intraday-candles.json");
const dailyFixture = readFixture("domestic-daily-candles.json");

describe("KIS domestic candle REST contract", () => {
  it("maps the official intraday fixture to sorted KRX 1-minute candles", async () => {
    const cursors: string[] = [];
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        expect(url.pathname).toBe(
          "/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice",
        );
        expect(url.searchParams.get("FID_COND_MRKT_DIV_CODE")).toBe("J");
        expect(url.searchParams.get("FID_INPUT_ISCD")).toBe("005930");
        cursors.push(url.searchParams.get("FID_INPUT_HOUR_1") ?? "");
        expect(url.searchParams.get("FID_PW_DATA_INCU_YN")).toBe("Y");
        const headers = new Headers(init?.headers);
        expect(headers.get("tr_id")).toBe("FHKST03010200");
        expect(headers.get("authorization")).toBe("Bearer read-only-token");
        return jsonResponse(intradayFixture);
      },
    );
    const beforeRequest = vi.fn(async () => undefined);
    const client = clientWith(fetchMock, beforeRequest);

    const history = await client.getDomesticMinuteCandles({
      symbol: "005930",
      beforeOrAt: "090230",
      maxPages: 2,
    });

    expect(DomesticCandleHistorySchema.parse(history)).toEqual(history);
    expect(history.candles.map((candle) => candle.openedAt)).toEqual([
      "2026-07-20T00:01:00.000Z",
      "2026-07-20T00:02:00.000Z",
    ]);
    expect(history.candles[0]).toMatchObject({
      state: "CLOSED",
      volume: "900",
      turnover: null,
      turnoverProvenance: "UNAVAILABLE",
      freshness: "CLOSED",
    });
    expect(history.candles[1]).toMatchObject({
      state: "FORMING",
      volume: "1200",
      freshness: "LIVE",
    });
    expect(history.quality).toMatchObject({
      coverage: "LATEST_AVAILABLE_KRX_BUSINESS_DAY_ONLY",
      turnover: "UNAVAILABLE",
    });
    expect(history.pagination).toMatchObject({
      pageSizeLimit: 30,
      pagesFetched: 2,
      complete: true,
    });
    expect(cursors).toEqual(["090230", "090000"]);
    expect(beforeRequest).toHaveBeenCalledTimes(2);
  });

  it("maps the 15:30 closing-auction candidate to the final minute and excludes indicative rows", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        rt_cd: "0",
        output2: [
          {
            ...minuteRow(15 * 60 + 30),
            stck_prpr: "244000",
            stck_oprc: "244000",
            stck_hgpr: "244000",
            stck_lwpr: "244000",
            cntg_vol: "4671204",
          },
          minuteRow(15 * 60 + 29),
        ],
      }),
    );
    const client = clientWith(
      fetchMock,
      undefined,
      () => new Date("2026-07-20T06:31:00.000Z"),
    );

    const history = await client.getDomesticMinuteCandles({
      symbol: "005930",
      beforeOrAt: "153000",
    });

    expect(history.candles[0]).toMatchObject({
      openedAt: "2026-07-20T06:29:00.000Z",
      closedAt: "2026-07-20T06:30:00.000Z",
      session: "CLOSING_AUCTION",
      close: "244000",
      volume: "4671204",
    });
    expect(history.candles).toHaveLength(1);
  });

  it("maps adjusted daily OHLCV and provider-reported turnover in KRX time", async () => {
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        expect(url.pathname).toBe(
          "/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice",
        );
        expect(url.searchParams.get("FID_INPUT_DATE_1")).toBe("20260701");
        expect(url.searchParams.get("FID_INPUT_DATE_2")).toBe("20260720");
        expect(url.searchParams.get("FID_PERIOD_DIV_CODE")).toBe("D");
        expect(url.searchParams.get("FID_ORG_ADJ_PRC")).toBe("0");
        expect(new Headers(init?.headers).get("tr_id")).toBe("FHKST03010100");
        return jsonResponse(dailyFixture);
      },
    );
    const client = clientWith(
      fetchMock,
      undefined,
      () => new Date("2026-07-20T01:01:00.000Z"),
    );

    const history = await client.getDomesticDailyCandles({
      symbol: "005930",
      startDate: "20260701",
      endDate: "20260720",
      adjusted: true,
    });

    expect(history.candles.map((candle) => candle.openedAt)).toEqual([
      "2026-07-16T00:00:00.000Z",
      "2026-07-17T00:00:00.000Z",
    ]);
    expect(history.candles[1]).toMatchObject({
      closedAt: "2026-07-17T06:30:00.000Z",
      volume: "12345678",
      turnover: "865432109876",
      turnoverProvenance: "PROVIDER_REPORTED",
      isAdjusted: true,
    });
    expect(history.quality).toEqual({
      coverage: "REQUESTED_DATE_RANGE",
      priceAdjustment: "ADJUSTED",
      volume: "PROVIDER_REPORTED",
      turnover: "PROVIDER_REPORTED",
      caveats: [],
    });
  });

  it("paginates backwards with exact provider cursors and deduplicates overlap", async () => {
    const requests: string[] = [];
    const firstPage = Array.from({ length: 30 }, (_, index) =>
      minuteRow(600 - index),
    );
    const secondPage = [minuteRow(571), minuteRow(540)];
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      const cursor = url.searchParams.get("FID_INPUT_HOUR_1") ?? "";
      requests.push(cursor);
      return jsonResponse({
        rt_cd: "0",
        output2: requests.length === 1 ? firstPage : secondPage,
      });
    });
    const client = clientWith(
      fetchMock,
      undefined,
      () => new Date("2026-07-20T01:01:00.000Z"),
    );

    const history = await client.getDomesticMinuteCandles({
      symbol: "005930",
      beforeOrAt: "100000",
      maxPages: 2,
    });

    expect(requests).toEqual(["100000", "093000"]);
    expect(history.candles).toHaveLength(31);
    expect(history.pagination).toMatchObject({
      pagesFetched: 2,
      complete: true,
      nextCursor: null,
    });
  });

  it("continues backward pagination when KIS returns a short non-boundary minute page", async () => {
    const requests: string[] = [];
    const firstPage = Array.from({ length: 20 }, (_, index) =>
      minuteRow(900 - index),
    );
    const secondPage = Array.from({ length: 20 }, (_, index) =>
      minuteRow(880 - index),
    );
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      requests.push(url.searchParams.get("FID_INPUT_HOUR_1") ?? "");
      return jsonResponse({
        rt_cd: "0",
        output2: requests.length === 1 ? firstPage : secondPage,
      });
    });
    const client = clientWith(
      fetchMock,
      undefined,
      () => new Date("2026-07-20T06:31:00.000Z"),
    );

    const history = await client.getDomesticMinuteCandles({
      symbol: "005930",
      beforeOrAt: "150000",
      maxPages: 2,
    });

    expect(requests).toEqual(["150000", "144000"]);
    expect(history.candles).toHaveLength(40);
    expect(history.candles.at(-1)?.openedAt).toBe(
      "2026-07-20T06:00:00.000Z",
    );
    expect(history.pagination.complete).toBe(false);
  });

  it("ignores previous-business-day spillover on the final intraday page", async () => {
    const currentRows = Array.from({ length: 30 }, (_, index) =>
      minuteRow(600 - index),
    );
    const previousDayRow = {
      ...minuteRow(570),
      stck_bsop_date: "20260717",
    };
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        rt_cd: "0",
        output2:
          fetchMock.mock.calls.length === 1
            ? currentRows
            : [minuteRow(570), previousDayRow],
      }),
    );
    const client = clientWith(
      fetchMock,
      undefined,
      () => new Date("2026-07-20T02:00:00.000Z"),
    );
    const history = await client.getDomesticMinuteCandles({
      symbol: "005930",
      beforeOrAt: "100000",
      maxPages: 2,
    });
    expect(history.candles).toHaveLength(31);
    expect(
      history.candles.every((candle) =>
        candle.openedAt.startsWith("2026-07-20"),
      ),
    ).toBe(true);
    expect(history.pagination.complete).toBe(true);
  });

  it("skips future-stamped pre-open minute rows and reaches the prior session", async () => {
    const requests: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      requests.push(url.searchParams.get("FID_INPUT_HOUR_1") ?? "");
      return jsonResponse({
        rt_cd: "0",
        output2:
          requests.length === 1
            ? [
                {
                  ...minuteRow(9 * 60 + 1),
                  stck_bsop_date: "20260721",
                },
              ]
            : [
                {
                  ...minuteRow(9 * 60),
                  stck_bsop_date: "20260721",
                },
                {
                  ...minuteRow(15 * 60 + 30),
                  stck_bsop_date: "20260717",
                },
              ],
      });
    });
    const client = clientWith(
      fetchMock,
      undefined,
      () => new Date("2026-07-20T22:30:00.000Z"),
    );

    const history = await client.getDomesticMinuteCandles({
      symbol: "320000",
      beforeOrAt: "153000",
      maxPages: 2,
    });

    expect(requests).toEqual(["153000", "090000"]);
    expect(history.candles).toHaveLength(1);
    expect(history.candles[0]).toMatchObject({
      instrumentId: "KRX:320000",
      openedAt: "2026-07-17T06:29:00.000Z",
      state: "CLOSED",
    });
  });

  it("excludes a future-stamped current daily row before the session opens", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        rt_cd: "0",
        output2: [dailyRow("20260721"), dailyRow("20260720")],
      }),
    );
    const client = clientWith(
      fetchMock,
      undefined,
      () => new Date("2026-07-20T22:30:00.000Z"),
    );

    const history = await client.getDomesticDailyCandles({
      symbol: "320000",
      startDate: "20260701",
      endDate: "20260721",
    });

    expect(history.candles).toHaveLength(1);
    expect(history.candles[0]?.openedAt).toBe("2026-07-20T00:00:00.000Z");
  });

  it("paginates daily history with oldest-date minus one and deduplicates overlap", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) =>
      dailyRow(providerDateDaysBefore("20260720", index)),
    );
    const oldest = firstPage.at(-1)!.stck_bsop_date;
    const nextCursor = providerDateDaysBefore(oldest, 1);
    const secondPage = [
      dailyRow(oldest),
      dailyRow(nextCursor),
    ];
    const requests: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      requests.push(url.searchParams.get("FID_INPUT_DATE_2") ?? "");
      return jsonResponse({
        rt_cd: "0",
        output2: requests.length === 1 ? firstPage : secondPage,
      });
    });
    const client = clientWith(
      fetchMock,
      undefined,
      () => new Date("2026-07-20T07:00:00.000Z"),
    );

    const history = await client.getDomesticDailyCandles({
      symbol: "005930",
      startDate: "20200101",
      endDate: "20260720",
      maxPages: 2,
    });

    expect(requests).toEqual(["20260720", nextCursor]);
    expect(history.candles).toHaveLength(101);
    expect(history.pagination).toMatchObject({
      pagesFetched: 2,
      complete: true,
      nextCursor: null,
    });
  });

  it("rejects a malformed success payload without inventing zero values", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        rt_cd: "0",
        output2: [
          {
            stck_bsop_date: "20260717",
            stck_clpr: "70100",
          },
        ],
      }),
    );
    const client = clientWith(fetchMock);

    await expect(
      client.getDomesticDailyCandles({
        symbol: "005930",
        startDate: "20260701",
        endDate: "20260720",
      }),
    ).rejects.toMatchObject({
      code: "KIS_REST_SCHEMA_MISMATCH",
      retryable: false,
    });
  });

  it("classifies rate limits as retryable and exposes a read-only policy", async () => {
    const client = clientWith(vi.fn(async () => jsonResponse({}, 429)));

    await expect(
      client.getDomesticMinuteCandles({
        symbol: "005930",
        beforeOrAt: "100000",
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        name: "KisApiError",
        message: expect.any(String),
        code: "KIS_RATE_LIMITED",
        retryable: true,
      }),
    );
    expect(KIS_DOMESTIC_CHART_POLICY).toMatchObject({
      rateLimitGroup: "KIS_DOMESTIC_QUOTATIONS_CHART",
      intradayPageSizeLimit: 30,
      dailyPageSizeLimit: 100,
      actualOrderCapability: "FORBIDDEN",
    });
  });

  it("rejects inconsistent canonical source and minute turnover quality", () => {
    const valid = {
      schemaVersion: 1,
      instrumentId: "KRX:005930",
      interval: "1m",
      exchangeTimezone: "Asia/Seoul",
      candles: [],
      source: {
        provider: "KIS",
        transport: "REST",
        dataEnvironment: "paper",
        path: "/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice",
        trId: "FHKST03010100",
        fetchedAt: "2026-07-20T00:00:00.000Z",
        officialSampleCommit:
          "885dd4e2f5c37e4f7e23dd63c15555a9967bc7bc",
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
        turnover: "PROVIDER_REPORTED",
        caveats: [],
      },
    };
    expect(() => DomesticCandleHistorySchema.parse(valid)).toThrow();
  });
});

function clientWith(
  fetchMock: ReturnType<typeof vi.fn>,
  beforeRequest?: () => Promise<void>,
  clock: () => Date = () => new Date("2026-07-20T00:02:30.000Z"),
) {
  const options = {
    environment: "paper",
    credentials: {
      appKey: "a".repeat(20),
      appSecret: "s".repeat(20),
    },
    getAccessToken: async () => "read-only-token",
    fetch: fetchMock as typeof fetch,
    clock,
  } as const;
  return new KisDomesticChartClient(
    beforeRequest === undefined
      ? options
      : {
          ...options,
          beforeRequest,
        },
  );
}

function minuteRow(minuteOfDay: number) {
  const time = `${String(Math.floor(minuteOfDay / 60)).padStart(2, "0")}${String(minuteOfDay % 60).padStart(2, "0")}`;
  return {
    stck_bsop_date: "20260720",
    stck_cntg_hour: `${time}00`,
    stck_prpr: "70000",
    stck_oprc: "70000",
    stck_hgpr: "70100",
    stck_lwpr: "69900",
    cntg_vol: "100",
    acml_tr_pbmn: "7000000",
  };
}

function dailyRow(date: string) {
  return {
    stck_bsop_date: date,
    stck_clpr: "70000",
    stck_oprc: "69500",
    stck_hgpr: "70500",
    stck_lwpr: "69000",
    acml_vol: "1000",
    acml_tr_pbmn: "70000000",
  };
}

function providerDateDaysBefore(value: string, days: number): string {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day - days));
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;
}

function readFixture(name: string): unknown {
  return JSON.parse(
    readFileSync(join(process.cwd(), "tests", "fixtures", "kis", name), "utf8"),
  ) as unknown;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
