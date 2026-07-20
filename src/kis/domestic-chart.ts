import { z } from "zod";

import type { KisCredentials } from "../config/runtime-config.js";
import {
  DomesticCandleHistorySchema,
  type DomesticCandleHistory,
} from "../contracts/market-history.js";
import { getKisEndpoints, KIS_PATH, KIS_TR } from "./endpoints.js";
import { KisApiError } from "./errors.js";

const OFFICIAL_SAMPLE_COMMIT =
  "885dd4e2f5c37e4f7e23dd63c15555a9967bc7bc" as const;
const KRX_TIME_ZONE = "Asia/Seoul" as const;
const INTRADAY_PAGE_SIZE = 30;
const DAILY_PAGE_SIZE = 100;

const intradayRowSchema = z
  .object({
    stck_bsop_date: z.string(),
    stck_cntg_hour: z.string(),
    stck_prpr: z.string(),
    stck_oprc: z.string(),
    stck_hgpr: z.string(),
    stck_lwpr: z.string(),
    cntg_vol: z.string(),
    acml_tr_pbmn: z.string(),
  })
  .loose();

const dailyRowSchema = z
  .object({
    stck_bsop_date: z.string(),
    stck_clpr: z.string(),
    stck_oprc: z.string(),
    stck_hgpr: z.string(),
    stck_lwpr: z.string(),
    acml_vol: z.string(),
    acml_tr_pbmn: z.string(),
  })
  .loose();

function responseSchema<Row extends z.ZodType>(row: Row) {
  return z
    .object({
      rt_cd: z.string(),
      msg_cd: z.string().optional(),
      msg1: z.string().optional(),
      output2: z.array(row).optional(),
    })
    .loose();
}

type IntradayRow = z.infer<typeof intradayRowSchema>;
type DailyRow = z.infer<typeof dailyRowSchema>;
type FetchLike = typeof fetch;

export interface DomesticIntradayCandleRequest {
  symbol: string;
  beforeOrAt?: string;
  maxPages?: number;
}

export interface DomesticDailyCandleRequest {
  symbol: string;
  startDate: string;
  endDate: string;
  adjusted?: boolean;
  maxPages?: number;
}

export const KIS_DOMESTIC_CHART_POLICY = Object.freeze({
  officialSampleCommit: OFFICIAL_SAMPLE_COMMIT,
  verifiedAt: "2026-07-20",
  rateLimitGroup: "KIS_DOMESTIC_QUOTATIONS_CHART",
  cacheTtlMs: {
    intraday: 15_000,
    completedDaily: 21_600_000,
  },
  intradayPageSizeLimit: INTRADAY_PAGE_SIZE,
  dailyPageSizeLimit: DAILY_PAGE_SIZE,
  intradayCoverage: "CURRENT_KRX_BUSINESS_DAY_ONLY",
  actualOrderCapability: "FORBIDDEN",
});

export class KisDomesticChartClient {
  readonly #environment: "paper" | "prod";
  readonly #credentials: KisCredentials;
  readonly #getAccessToken: () => Promise<string>;
  readonly #fetch: FetchLike;
  readonly #beforeRequest: () => Promise<void>;
  readonly #clock: () => Date;

  constructor(options: {
    environment: "paper" | "prod";
    credentials: KisCredentials;
    getAccessToken: () => Promise<string>;
    fetch?: FetchLike;
    beforeRequest?: () => Promise<void>;
    clock?: () => Date;
  }) {
    this.#environment = options.environment;
    this.#credentials = options.credentials;
    this.#getAccessToken = options.getAccessToken;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#beforeRequest = options.beforeRequest ?? (async () => undefined);
    this.#clock = options.clock ?? (() => new Date());
  }

  async getDomesticMinuteCandles(
    request: DomesticIntradayCandleRequest,
  ): Promise<DomesticCandleHistory> {
    assertSymbol(request.symbol);
    const maxPages = boundedMaxPages(request.maxPages, 24);
    const fetchedAt = this.#clock();
    let cursor = request.beforeOrAt ?? formatKrxTime(fetchedAt);
    assertProviderTime(cursor);

    const rows = new Map<string, IntradayRow>();
    let pagesFetched = 0;
    let complete = false;
    let observedBusinessDate: string | undefined;
    for (let page = 0; page < maxPages; page += 1) {
      const pageRows = await this.#requestRows(
        KIS_PATH.domesticIntradayCandles,
        KIS_TR.domesticIntradayCandles,
        {
          FID_COND_MRKT_DIV_CODE: "J",
          FID_INPUT_ISCD: request.symbol,
          FID_INPUT_HOUR_1: cursor,
          FID_PW_DATA_INCU_YN: "Y",
          FID_ETC_CLS_CODE: "",
        },
        intradayRowSchema,
        "minute-candle",
      );
      pagesFetched += 1;
      if (pageRows.length === 0) {
        complete = true;
        break;
      }
      const currentBusinessDayRows: IntradayRow[] = [];
      let reachedDifferentBusinessDate = false;
      for (const row of pageRows) {
        const businessDate = row.stck_bsop_date.trim();
        assertProviderDate(businessDate);
        observedBusinessDate ??= businessDate;
        if (businessDate !== observedBusinessDate) {
          // The final 09:00 boundary page can include rows from the prior
          // business day when FID_PW_DATA_INCU_YN=Y. This product contract is
          // current-day-only, so keep the observed day and discard spillover.
          reachedDifferentBusinessDate = true;
          continue;
        }
        currentBusinessDayRows.push(row);
        rows.set(
          `${row.stck_bsop_date.trim()}:${row.stck_cntg_hour.trim()}`,
          row,
        );
      }
      if (currentBusinessDayRows.length === 0) {
        complete = true;
        break;
      }
      if (reachedDifferentBusinessDate) {
        complete = true;
        break;
      }
      if (cursor === "090000") {
        // Only a provider request at the session boundary can prove whether
        // the 09:00 candle exists. A prior page ending at 09:01 is not enough.
        complete = true;
        break;
      }
      const oldest = oldestProviderTime(currentBusinessDayRows);
      const next = previousMinuteCursor(oldest);
      if (next === null || next < "090000") {
        complete = true;
        cursor = next ?? cursor;
        break;
      }
      if (next >= cursor) {
        complete = false;
        break;
      }
      cursor = next;
    }

    const candles = [...rows.values()]
      .filter((row) => {
        const time = row.stck_cntg_hour.trim();
        return !(
          sessionForTime(time) === "CLOSING_AUCTION" &&
          time !== "153000"
        );
      })
      .map((row) => toMinuteCandle(request.symbol, row, fetchedAt))
      .sort((left, right) => left.openedAt.localeCompare(right.openedAt));
    return DomesticCandleHistorySchema.parse({
      schemaVersion: 1,
      instrumentId: `KRX:${request.symbol}`,
      interval: "1m",
      exchangeTimezone: KRX_TIME_ZONE,
      candles,
      source: {
        provider: "KIS",
        transport: "REST",
        dataEnvironment: this.#environment,
        path: KIS_PATH.domesticIntradayCandles,
        trId: KIS_TR.domesticIntradayCandles,
        fetchedAt: fetchedAt.toISOString(),
        officialSampleCommit: OFFICIAL_SAMPLE_COMMIT,
      },
      pagination: {
        strategy: "TIME_CURSOR_BACKWARD_WITH_DEDUPLICATION",
        pageSizeLimit: INTRADAY_PAGE_SIZE,
        pagesFetched,
        maxPages,
        complete,
        nextCursor: complete ? null : cursor,
      },
      quality: {
        coverage: "CURRENT_KRX_BUSINESS_DAY_ONLY",
        priceAdjustment: "CURRENT_SESSION_ORIGINAL",
        volume: "PROVIDER_REPORTED",
        turnover: "UNAVAILABLE",
        caveats: [
          "LATEST_MINUTE_VOLUME_MAY_CARRY_PREVIOUS_MINUTE_UNTIL_FIRST_TRADE",
          "MINUTE_TURNOVER_IS_UNAVAILABLE_BECAUSE_KIS_REPORTS_CUMULATIVE_TURNOVER",
          "MINUTE_ENDPOINT_DOES_NOT_PROVIDE_PRIOR_BUSINESS_DAYS",
          "CLOSING_AUCTION_INDICATIVE_ROWS_EXCLUDED",
        ],
      },
    });
  }

  async getDomesticDailyCandles(
    request: DomesticDailyCandleRequest,
  ): Promise<DomesticCandleHistory> {
    assertSymbol(request.symbol);
    assertProviderDate(request.startDate);
    assertProviderDate(request.endDate);
    if (request.startDate > request.endDate) {
      throw new TypeError("startDate must not be later than endDate");
    }
    const maxPages = boundedMaxPages(request.maxPages, 20);
    const adjusted = request.adjusted ?? true;
    const fetchedAt = this.#clock();
    let endCursor = request.endDate;
    const rows = new Map<string, DailyRow>();
    let pagesFetched = 0;
    let complete = false;

    for (let page = 0; page < maxPages; page += 1) {
      const pageRows = await this.#requestRows(
        KIS_PATH.domesticDailyCandles,
        KIS_TR.domesticDailyCandles,
        {
          FID_COND_MRKT_DIV_CODE: "J",
          FID_INPUT_ISCD: request.symbol,
          FID_INPUT_DATE_1: request.startDate,
          FID_INPUT_DATE_2: endCursor,
          FID_PERIOD_DIV_CODE: "D",
          FID_ORG_ADJ_PRC: adjusted ? "0" : "1",
        },
        dailyRowSchema,
        "daily-candle",
      );
      pagesFetched += 1;
      if (pageRows.length === 0) {
        complete = true;
        break;
      }
      for (const row of pageRows) {
        rows.set(row.stck_bsop_date.trim(), row);
      }
      const oldest = pageRows
        .map((row) => row.stck_bsop_date.trim())
        .sort()[0];
      if (oldest === undefined) {
        complete = true;
        break;
      }
      assertProviderDate(oldest);
      const next = previousProviderDate(oldest);
      if (
        oldest <= request.startDate ||
        next < request.startDate ||
        pageRows.length < DAILY_PAGE_SIZE
      ) {
        complete = true;
        endCursor = next;
        break;
      }
      if (next >= endCursor) {
        complete = false;
        break;
      }
      endCursor = next;
    }

    const candles = [...rows.values()]
      .map((row) => toDailyCandle(request.symbol, row, fetchedAt, adjusted))
      .sort((left, right) => left.openedAt.localeCompare(right.openedAt));
    return DomesticCandleHistorySchema.parse({
      schemaVersion: 1,
      instrumentId: `KRX:${request.symbol}`,
      interval: "1d",
      exchangeTimezone: KRX_TIME_ZONE,
      candles,
      source: {
        provider: "KIS",
        transport: "REST",
        dataEnvironment: this.#environment,
        path: KIS_PATH.domesticDailyCandles,
        trId: KIS_TR.domesticDailyCandles,
        fetchedAt: fetchedAt.toISOString(),
        officialSampleCommit: OFFICIAL_SAMPLE_COMMIT,
      },
      pagination: {
        strategy: "DATE_WINDOW_BACKWARD_WITH_DEDUPLICATION",
        pageSizeLimit: DAILY_PAGE_SIZE,
        pagesFetched,
        maxPages,
        complete,
        nextCursor: complete ? null : endCursor,
      },
      quality: {
        coverage: "REQUESTED_DATE_RANGE",
        priceAdjustment: adjusted ? "ADJUSTED" : "ORIGINAL",
        volume: "PROVIDER_REPORTED",
        turnover: "PROVIDER_REPORTED",
        caveats: [],
      },
    });
  }

  async #requestRows<Row extends z.ZodType>(
    path: string,
    trId: string,
    parameters: Record<string, string>,
    rowSchema: Row,
    operation: string,
  ): Promise<z.infer<Row>[]> {
    await this.#beforeRequest();
    const endpoint = getKisEndpoints(this.#environment);
    const url = new URL(`${endpoint.restBaseUrl}${path}`);
    url.search = new URLSearchParams(parameters).toString();
    const accessToken = await this.#getAccessToken();

    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: "GET",
        headers: {
          "content-type": "application/json; charset=utf-8",
          authorization: `Bearer ${accessToken}`,
          appkey: this.#credentials.appKey,
          appsecret: this.#credentials.appSecret,
          tr_id: trId,
          custtype: "P",
        },
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      throw new KisApiError({
        code: "KIS_NETWORK_ERROR",
        message: `KIS ${operation} endpoint is unreachable`,
        retryable: true,
        cause: error,
      });
    }

    const payload: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      throw new KisApiError({
        code: response.status === 429 ? "KIS_RATE_LIMITED" : "KIS_REST_FAILED",
        message: `KIS ${operation} request failed with HTTP ${response.status}`,
        retryable: response.status >= 500 || response.status === 429,
        status: response.status,
      });
    }
    const parsed = responseSchema(rowSchema).safeParse(payload);
    if (!parsed.success) {
      throw new KisApiError({
        code: "KIS_REST_SCHEMA_MISMATCH",
        message: `KIS ${operation} response did not match the expected contract`,
        retryable: false,
      });
    }
    if (parsed.data.rt_cd !== "0") {
      throw new KisApiError({
        code: parsed.data.msg_cd ?? "KIS_BUSINESS_ERROR",
        message: parsed.data.msg1 ?? `KIS rejected the ${operation} request`,
        retryable: parsed.data.msg_cd === "EGW00201",
      });
    }
    if (parsed.data.output2 === undefined) {
      throw new KisApiError({
        code: "KIS_REST_SCHEMA_MISMATCH",
        message: `KIS ${operation} success response omitted output2`,
        retryable: false,
      });
    }
    return parsed.data.output2;
  }
}

function toMinuteCandle(symbol: string, row: IntradayRow, asOf: Date) {
  const date = row.stck_bsop_date.trim();
  const time = row.stck_cntg_hour.trim();
  const opened = providerInstant(
    date,
    time === "153000" ? "152900" : `${time.slice(0, 4)}00`,
  );
  const closed = new Date(opened.getTime() + 60_000);
  const forming = opened.getTime() <= asOf.getTime() && asOf < closed;
  return {
    instrumentId: `KRX:${symbol}`,
    interval: "1m" as const,
    session: sessionForTime(time),
    openedAt: opened.toISOString(),
    closedAt: closed.toISOString(),
    state: forming ? ("FORMING" as const) : ("CLOSED" as const),
    open: positiveDecimal(row.stck_oprc, "stck_oprc"),
    high: positiveDecimal(row.stck_hgpr, "stck_hgpr"),
    low: positiveDecimal(row.stck_lwpr, "stck_lwpr"),
    close: positiveDecimal(row.stck_prpr, "stck_prpr"),
    volume: unsignedDecimal(row.cntg_vol, "cntg_vol"),
    volumeProvenance: "PROVIDER_REPORTED" as const,
    turnover: null,
    turnoverProvenance: "UNAVAILABLE" as const,
    turnoverCalculation: null,
    currency: "KRW" as const,
    source: "KIS_CANONICAL_MARKET_DATA" as const,
    freshness: forming ? ("LIVE" as const) : ("CLOSED" as const),
    isAdjusted: false,
  };
}

function toDailyCandle(
  symbol: string,
  row: DailyRow,
  asOf: Date,
  adjusted: boolean,
) {
  const date = row.stck_bsop_date.trim();
  const opened = providerInstant(date, "090000");
  const closed = providerInstant(date, "153000");
  const forming = opened.getTime() <= asOf.getTime() && asOf < closed;
  return {
    instrumentId: `KRX:${symbol}`,
    interval: "1d" as const,
    session: "REGULAR" as const,
    openedAt: opened.toISOString(),
    closedAt: closed.toISOString(),
    state: forming ? ("FORMING" as const) : ("CLOSED" as const),
    open: positiveDecimal(row.stck_oprc, "stck_oprc"),
    high: positiveDecimal(row.stck_hgpr, "stck_hgpr"),
    low: positiveDecimal(row.stck_lwpr, "stck_lwpr"),
    close: positiveDecimal(row.stck_clpr, "stck_clpr"),
    volume: unsignedDecimal(row.acml_vol, "acml_vol"),
    volumeProvenance: "PROVIDER_REPORTED" as const,
    turnover: unsignedDecimal(row.acml_tr_pbmn, "acml_tr_pbmn"),
    turnoverProvenance: "PROVIDER_REPORTED" as const,
    turnoverCalculation: null,
    currency: "KRW" as const,
    source: "KIS_CANONICAL_MARKET_DATA" as const,
    freshness: forming ? ("LIVE" as const) : ("CLOSED" as const),
    isAdjusted: adjusted,
  };
}

function boundedMaxPages(value: number | undefined, fallback: number): number {
  const maxPages = value ?? 1;
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > fallback) {
    throw new TypeError(`maxPages must be an integer between 1 and ${fallback}`);
  }
  return maxPages;
}

function assertSymbol(symbol: string): void {
  if (!/^[0-9A-Z]{6,7}$/.test(symbol)) {
    throw new TypeError("Expected a six or seven character domestic symbol");
  }
}

function assertProviderDate(value: string): void {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (!match) throw new TypeError("Expected KIS provider date YYYYMMDD");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const verified = new Date(Date.UTC(year, month - 1, day));
  if (
    verified.getUTCFullYear() !== year ||
    verified.getUTCMonth() !== month - 1 ||
    verified.getUTCDate() !== day
  ) {
    throw new TypeError("Expected a valid KIS provider date");
  }
}

function assertProviderTime(value: string): void {
  if (!/^\d{6}$/.test(value)) {
    throw new TypeError("Expected KIS provider time HHMMSS");
  }
  const hour = Number(value.slice(0, 2));
  const minute = Number(value.slice(2, 4));
  const second = Number(value.slice(4, 6));
  if (hour > 23 || minute > 59 || second > 59) {
    throw new TypeError("Expected a valid KIS provider time");
  }
}

function providerInstant(date: string, time: string): Date {
  assertProviderDate(date);
  assertProviderTime(time);
  return new Date(
    `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}+09:00`,
  );
}

function sessionForTime(time: string) {
  assertProviderTime(time);
  const hhmm = Number(time.slice(0, 4));
  if (hhmm < 900) return "PRE_MARKET" as const;
  if (hhmm < 1520) return "REGULAR" as const;
  // KIS stamps the finalized closing-auction print at exactly 15:30:00.
  if (hhmm <= 1530) return "CLOSING_AUCTION" as const;
  return "AFTER_MARKET" as const;
}

function formatKrxTime(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: KRX_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.hour ?? "00"}${values.minute ?? "00"}${values.second ?? "00"}`;
}

function oldestProviderTime(rows: IntradayRow[]): string {
  const oldest = rows.map((row) => row.stck_cntg_hour.trim()).sort()[0];
  if (oldest === undefined) {
    throw new TypeError("Expected at least one intraday row");
  }
  assertProviderTime(oldest);
  return oldest;
}

function previousMinuteCursor(time: string): string | null {
  assertProviderTime(time);
  const totalSeconds =
    Number(time.slice(0, 2)) * 3600 +
    Number(time.slice(2, 4)) * 60 +
    Number(time.slice(4, 6));
  if (totalSeconds < 60) return null;
  const previous = totalSeconds - 60;
  return `${String(Math.floor(previous / 3600)).padStart(2, "0")}${String(Math.floor((previous % 3600) / 60)).padStart(2, "0")}00`;
}

function previousProviderDate(date: string): string {
  assertProviderDate(date);
  const value = new Date(
    Date.UTC(
      Number(date.slice(0, 4)),
      Number(date.slice(4, 6)) - 1,
      Number(date.slice(6, 8)),
    ),
  );
  value.setUTCDate(value.getUTCDate() - 1);
  return `${value.getUTCFullYear()}${String(value.getUTCMonth() + 1).padStart(2, "0")}${String(value.getUTCDate()).padStart(2, "0")}`;
}

function canonicalUnsigned(value: string, field: string): string {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new KisApiError({
      code: "KIS_REST_SCHEMA_MISMATCH",
      message: `KIS candle field ${field} is not an unsigned decimal`,
      retryable: false,
    });
  }
  return trimmed.replace(/^0+(?=\d)/, "");
}

function unsignedDecimal(value: string, field: string): string {
  return canonicalUnsigned(value, field);
}

function positiveDecimal(value: string, field: string): string {
  const canonical = canonicalUnsigned(value, field);
  if (canonical === "0") {
    throw new KisApiError({
      code: "KIS_REST_SCHEMA_MISMATCH",
      message: `KIS candle field ${field} must be positive`,
      retryable: false,
    });
  }
  return canonical;
}
