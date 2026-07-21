import type Database from "better-sqlite3";
import { createHash } from "node:crypto";

import {
  loadRuntimeConfig,
  requireKisCredentialsForEnvironment,
  publicConfig,
  requireOpenDartCredentials,
  requirePublicDataPortalCredentials,
  requireFinnhubApiKey,
  requireSecRequestIdentity,
  hasKrxOpenApiCredentials,
  requireKrxOpenApiCredentials,
  assertLiveReadOnlyAcknowledgement,
} from "../../../../src/config/runtime-config.js";
import {
  AdvancedQueueStateSchema,
  PaperExecutionPlanSchema,
  type AdvancedQueueDecision,
  type AdvancedQueueState,
  type CanonicalOrderBookEvent,
  type CanonicalTradeEvent,
  type OpenPaperOrder,
  type PaperExecutionPlan,
  type PaperFillPolicy,
  type PaperOrderCommand,
} from "../../../../src/contracts/paper-order.js";
import type {
  AggregatedDomesticCandleHistory,
  DomesticCandleHistory,
} from "../../../../src/contracts/market-history.js";
import { KisAuthClient } from "../../../../src/kis/auth.js";
import { KisDomesticChartClient } from "../../../../src/kis/domestic-chart.js";
import { KisUsChartClient } from "../../../../src/kis/us-chart.js";
import { KisUsRankingClient } from "../../../../src/kis/us-ranking.js";
import {
  compareDailyVolumeRatioDescending,
  isUsableDailyRankingItem,
  KisDomesticRankingClient,
} from "../../../../src/kis/domestic-ranking.js";
import {
  isUsableDailyFluctuationItem,
  KisDomesticFluctuationClient,
  type DomesticFluctuationItem,
} from "../../../../src/kis/domestic-fluctuation.js";
import {
  isSearchableDomesticInstrumentQuery,
  KisDomesticInstrumentMaster,
} from "../../../../src/kis/domestic-instrument-master.js";
import {
  isSearchableUsInstrumentQuery,
  KisUsInstrumentMaster,
} from "../../../../src/kis/us-instrument-master.js";
import { KisProdNewsClient } from "../../../../src/kis/news-headlines.js";
import { FinnhubNewsClient } from "../../../../src/news/finnhub-client.js";
import {
  KIS_DOMESTIC_INDEX_SELECTIONS,
  KIS_US_MARKET_PROXY_SELECTIONS,
  KisMarketContextClient,
  type KisMarketContextSnapshot,
} from "../../../../src/kis/market-context.js";
import {
  SecEdgarClient,
  findSecIssuerMappings,
} from "../../../../src/disclosures/sec-client.js";
import {
  OpenDartClient,
  type OpenDartCorpCode,
} from "../../../../src/disclosures/open-dart-client.js";
import { FederalReserveFomcCalendarClient } from "../../../../src/calendar/federal-reserve-fomc-client.js";
import { BlsReleaseCalendarClient } from "../../../../src/calendar/bls-release-calendar-client.js";
import { BeaReleaseScheduleClient } from "../../../../src/calendar/bea-release-schedule-client.js";
import { KsdRightsScheduleClient } from "../../../../src/calendar/ksd-rights-schedule-client.js";
import { KindListingScheduleClient } from "../../../../src/calendar/kind-listing-schedule-client.js";
import { openDartFilingsToCalendarEvents } from "../../../../src/calendar/open-dart-calendar-adapter.js";
import { KisRestClient } from "../../../../src/kis/rest-client.js";
import { KisDomesticInvestorFlowClient } from "../../../../src/kis/domestic-investor-flow.js";
import { KrxOpenApiClient } from "../../../../src/krx/openapi-client.js";
import { KrxDailyStockTradeClient } from "../../../../src/krx/daily-stock-trade.js";
import { KrxInvestorFlowClient } from "../../../../src/krx/investor-flow.js";
import { KrxShortSellingClient } from "../../../../src/krx/short-selling.js";
import { DomesticKisLiveStream } from "../../../../src/kis/ws/live-stream.js";
import { domesticSessionFromProviderTime } from "../../../../src/kis/ws/normalize.js";
import type { MarketLiveProjection } from "../../../../src/contracts/market-live-projection.js";
import { aggregateDomesticCandleHistory } from "../../../../src/market-data/domestic-candle-aggregation.js";
import {
  acceptAdvancedQueueEstimate,
  planImmediateBookFills,
  planAdvancedQueueProgress,
  planPassiveObservedTradeFill,
} from "../../../../src/simulation/orderbook-paper-engine.js";
import { openUserDataDatabase } from "../../../../src/storage/database.js";
import { LocalPaperTradingRepository } from "../../../../src/storage/paper-repository.js";
import { LocalInformationRepository } from "../../../../src/storage/information-repository.js";
import { LocalMarketCalendarRepository } from "../../../../src/storage/market-calendar-repository.js";
import { LocalMarketSnapshotRepository } from "../../../../src/storage/market-snapshot-repository.js";
import { LocalSimulationRepository } from "../../../../src/storage/repository.js";
import type {
  CashLedgerEntryInput,
  PaperAccountSummary,
  StoredPaperOrder,
} from "../../../../src/storage/contracts.js";
import type {
  DesktopAccountProjection,
  DesktopBootstrapProjection,
  DesktopChartInterval,
  DesktopChartProjection,
  DesktopChartRange,
  DesktopConnectionState,
  DesktopMarketProjection,
  DesktopMarketSession,
  DesktopInformationFeedProjection,
  DesktopInformationItemProjection,
  DesktopInvestorFlowProjection,
  DesktopInstrumentSearchProjection,
  DesktopMarketCalendarProjection,
  DesktopMarketCalendarSourceProjection,
  DesktopMarketContextItemProjection,
  DesktopMarketContextProjection,
  DesktopPaperOrderRequest,
  DesktopPaperOrderResult,
  DesktopRankingProjection,
  DesktopRankingSort,
  DesktopShortSellingProjection,
} from "../shared/desktop-contracts.js";
import { averagePaperPositionPrice } from "../shared/paper-valuation.js";

const ACCOUNT_ID = "personal-paper-account";
const DEFAULT_INITIAL_CASH_MINOR = "100000000";
const DEFAULT_INITIAL_USD_CASH_MINOR = "10000000";
const INSTRUMENT_NAME = "삼성전자";
const FEE_RATE_PPM = 150n;
const SELL_TAX_RATE_PPM = 1_500n;
const ONE_MILLION = 1_000_000n;
const MAX_EXECUTION_MARKET_AGE_MS = 5_000;
const MINUTE_CHART_CACHE_TTL_MS = 15_000;
const DAILY_CHART_CACHE_TTL_MS = 6 * 60 * 60 * 1_000;
// KIS explicitly applies a lower REST quota to paper accounts. Keep chart
// pagination at one request per second so a 4h/5Y backfill does not burst.
const CHART_REQUEST_MINIMUM_GAP_MS = 1_000;
const INFORMATION_CACHE_TTL_MS = 30_000;
const MARKET_CONTEXT_CACHE_TTL_MS = 15_000;
const MARKET_CONTEXT_REQUEST_GAP_MS = 120;
const MARKET_CALENDAR_CACHE_TTL_MS = 5 * 60_000;

function fixtureMarketCalendarProjection(): DesktopMarketCalendarProjection {
  const detectedAt = "2026-07-22T00:00:00.000Z";
  return {
    schemaVersion: 1,
    state: "READY",
    source: "FIXTURE",
    fetchedAt: new Date().toISOString(),
    statusMessage:
      "캘린더 provider adapter 연결 전 fixture projection입니다. 실제 일정은 provider 연결 후 교체됩니다.",
    sources: [
      {
        provider: "OTHER_OFFICIAL",
        state: "READY",
        itemCount: 8,
        insertedCount: 8,
        dataQuality: "UNSUPPORTED",
        fetchedAt: detectedAt,
        message: "캘린더 UI fixture",
      },
    ],
    events: [
      {
        id: "calendar-kr-samsung-earnings-2026-q2",
        kind: "EARNINGS",
        marketScope: "KR",
        affectedMarkets: ["KR"],
        instrumentIds: ["KRX:005930"],
        titleKo: "삼성전자 2분기 실적 발표 예정",
        titleOriginal: null,
        scheduledAt: "2026-07-22T00:00:00.000Z",
        localDate: "2026-07-22",
        timezone: "Asia/Seoul",
        status: "SCHEDULED",
        importance: "HIGH",
        provider: "OTHER_OFFICIAL",
        sourceEventId: "fixture-samsung-ir-2026-q2",
        sourceUrl: null,
        dataQuality: "ISSUER_PRIMARY",
        metrics: [
          {
            name: "REVENUE",
            value: "74000000000000",
            unit: "KRW",
            currency: "KRW",
            evidenceId: "fixture-evidence-samsung-ir",
          },
        ],
        evidenceIds: ["fixture-evidence-samsung-ir"],
        supersedesEventId: null,
        detectedAt,
        updatedAt: detectedAt,
        payloadVersion: 1,
      },
      {
        id: "calendar-kr-rights-exdate-005930",
        kind: "EX_DIVIDEND",
        marketScope: "KR",
        affectedMarkets: ["KR"],
        instrumentIds: ["KRX:005930"],
        titleKo: "삼성전자 분기배당 권리락",
        titleOriginal: null,
        scheduledAt: "2026-07-22T00:00:00.000Z",
        localDate: "2026-07-22",
        timezone: "Asia/Seoul",
        status: "CONFIRMED",
        importance: "MEDIUM",
        provider: "KSD_RIGHTS_SCHEDULE",
        sourceEventId: "fixture-ksd-005930-exdiv",
        sourceUrl: null,
        dataQuality: "DELAYED",
        metrics: [
          {
            name: "DPS",
            value: "361",
            unit: "KRW/share",
            currency: "KRW",
            evidenceId: "fixture-evidence-ksd-rights",
          },
        ],
        evidenceIds: ["fixture-evidence-ksd-rights"],
        supersedesEventId: null,
        detectedAt,
        updatedAt: detectedAt,
        payloadVersion: 1,
      },
      {
        id: "calendar-us-nvda-earnings",
        kind: "EARNINGS",
        marketScope: "US",
        affectedMarkets: ["US"],
        instrumentIds: ["NASDAQ:NVDA"],
        titleKo: "NVIDIA 실적 발표",
        titleOriginal: "NVIDIA earnings release",
        scheduledAt: "2026-07-22T20:05:00.000Z",
        localDate: "2026-07-22",
        timezone: "America/New_York",
        status: "SCHEDULED",
        importance: "CRITICAL",
        provider: "FINANCIAL_MODELING_PREP",
        sourceEventId: "fixture-fmp-nvda-earnings",
        sourceUrl: null,
        dataQuality: "AGGREGATED",
        metrics: [
          {
            name: "EPS",
            value: "0.93",
            unit: "USD/share",
            currency: "USD",
            evidenceId: "fixture-evidence-fmp-earnings",
          },
          {
            name: "CONSENSUS",
            value: "0.91",
            unit: "USD/share",
            currency: "USD",
            evidenceId: "fixture-evidence-fmp-earnings",
          },
        ],
        evidenceIds: ["fixture-evidence-fmp-earnings"],
        supersedesEventId: null,
        detectedAt,
        updatedAt: detectedAt,
        payloadVersion: 1,
      },
      {
        id: "calendar-us-aapl-exdiv",
        kind: "EX_DIVIDEND",
        marketScope: "US",
        affectedMarkets: ["US"],
        instrumentIds: ["NASDAQ:AAPL"],
        titleKo: "Apple ex-dividend",
        titleOriginal: "Apple ex-dividend date",
        scheduledAt: "2026-07-22T13:30:00.000Z",
        localDate: "2026-07-22",
        timezone: "America/New_York",
        status: "CONFIRMED",
        importance: "MEDIUM",
        provider: "NASDAQ_DAILY_LIST",
        sourceEventId: "fixture-nasdaq-aapl-exdiv",
        sourceUrl: null,
        dataQuality: "REGULATOR_EXCHANGE",
        metrics: [
          {
            name: "DPS",
            value: "0.26",
            unit: "USD/share",
            currency: "USD",
            evidenceId: "fixture-evidence-nasdaq-daily-list",
          },
        ],
        evidenceIds: ["fixture-evidence-nasdaq-daily-list"],
        supersedesEventId: null,
        detectedAt,
        updatedAt: detectedAt,
        payloadVersion: 1,
      },
      {
        id: "calendar-global-us-cpi-2026-08",
        kind: "CPI",
        marketScope: "GLOBAL",
        affectedMarkets: ["GLOBAL", "KR", "US"],
        instrumentIds: [],
        titleKo: "미국 CPI 발표",
        titleOriginal: "Consumer Price Index",
        scheduledAt: "2026-08-12T12:30:00.000Z",
        localDate: "2026-08-12",
        timezone: "America/New_York",
        status: "SCHEDULED",
        importance: "CRITICAL",
        provider: "US_BLS",
        sourceEventId: "fixture-bls-cpi-2026-08",
        sourceUrl: "https://www.bls.gov/schedule/",
        dataQuality: "OFFICIAL",
        metrics: [],
        evidenceIds: ["fixture-evidence-bls-cpi"],
        supersedesEventId: null,
        detectedAt,
        updatedAt: detectedAt,
        payloadVersion: 1,
      },
      {
        id: "calendar-global-fomc-2026-07",
        kind: "FOMC",
        marketScope: "GLOBAL",
        affectedMarkets: ["GLOBAL", "KR", "US"],
        instrumentIds: [],
        titleKo: "FOMC 금리결정",
        titleOriginal: "FOMC policy decision",
        scheduledAt: "2026-07-29T18:00:00.000Z",
        localDate: "2026-07-29",
        timezone: "America/New_York",
        status: "SCHEDULED",
        importance: "CRITICAL",
        provider: "US_FEDERAL_RESERVE",
        sourceEventId: "fixture-fomc-2026-07",
        sourceUrl:
          "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm",
        dataQuality: "OFFICIAL",
        metrics: [],
        evidenceIds: ["fixture-evidence-fed-fomc"],
        supersedesEventId: null,
        detectedAt,
        updatedAt: detectedAt,
        payloadVersion: 1,
      },
      {
        id: "calendar-kr-options-expiry-2026-08",
        kind: "OPTIONS_EXPIRY",
        marketScope: "KR",
        affectedMarkets: ["KR"],
        instrumentIds: [],
        titleKo: "국내 지수 옵션만기",
        titleOriginal: null,
        scheduledAt: "2026-08-13T06:20:00.000Z",
        localDate: "2026-08-13",
        timezone: "Asia/Seoul",
        status: "SCHEDULED",
        importance: "HIGH",
        provider: "KRX_DERIVATIVES",
        sourceEventId: "fixture-krx-options-expiry-2026-08",
        sourceUrl: null,
        dataQuality: "REGULATOR_EXCHANGE",
        metrics: [],
        evidenceIds: ["fixture-evidence-krx-derivatives"],
        supersedesEventId: null,
        detectedAt,
        updatedAt: detectedAt,
        payloadVersion: 1,
      },
      {
        id: "calendar-global-msci-review-2026-08",
        kind: "MSCI_REBALANCE",
        marketScope: "GLOBAL",
        affectedMarkets: ["GLOBAL", "KR", "US"],
        instrumentIds: [],
        titleKo: "MSCI 분기 리뷰 발표",
        titleOriginal: "MSCI quarterly index review",
        scheduledAt: "2026-08-12T21:00:00.000Z",
        localDate: "2026-08-12",
        timezone: "America/New_York",
        status: "SCHEDULED",
        importance: "HIGH",
        provider: "MSCI",
        sourceEventId: "fixture-msci-review-2026-08",
        sourceUrl: "https://www.msci.com/eqb/fm/index_review.html",
        dataQuality: "OFFICIAL",
        metrics: [],
        evidenceIds: ["fixture-evidence-msci-review"],
        supersedesEventId: null,
        detectedAt,
        updatedAt: detectedAt,
        payloadVersion: 1,
      },
    ],
  };
}

export function desktopChartCacheTtlMs(
  interval: DesktopChartInterval,
  hasFormingCandle: boolean,
): number {
  return isIntradayChartInterval(interval) || hasFormingCandle
    ? MINUTE_CHART_CACHE_TTL_MS
    : DAILY_CHART_CACHE_TTL_MS;
}

function readOnlyMarketDataEnvironment(
  config: ReturnType<typeof loadRuntimeConfig>,
): "paper" | "prod" {
  return publicConfig(config).hasProdDataCredentials
    ? "prod"
    : config.KIS_DATA_ENV;
}

export function projectDomesticFluctuationItems(
  input: readonly DomesticFluctuationItem[],
  sort: "CHANGE_RATE_GAINERS" | "CHANGE_RATE_LOSERS",
): DesktopRankingProjection["items"] {
  const direction = sort === "CHANGE_RATE_GAINERS" ? -1 : 1;
  return [...input]
    .filter(isUsableDailyFluctuationItem)
    .filter((item) =>
      sort === "CHANGE_RATE_GAINERS"
        ? Number(item.changeRate) > 0
        : Number(item.changeRate) < 0,
    )
    .sort(
      (left, right) =>
        direction * (Number(left.changeRate) - Number(right.changeRate)),
    )
    .map((item, index) => ({
      rank: String(index + 1),
      instrumentId: `KRX:${item.symbol}`,
      symbol: item.symbol,
      name: item.name,
      price: item.price,
      change: item.change,
      changeRate: item.changeRate,
      cumulativeVolume: item.cumulativeVolume,
      previousVolume: null,
      averageVolume: null,
      volumeIncreaseRate: null,
      volumeTurnoverRate: null,
      averageTurnover: null,
      turnoverTurnoverRate: null,
      cumulativeTurnover: null,
    }));
}

function stableLocalId(prefix: string, parts: readonly string[]): string {
  const digest = createHash("sha256")
    .update(JSON.stringify(parts))
    .digest("hex")
    .slice(0, 40);
  return `${prefix}:${digest}`;
}

function koreanCalendarDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}${part("month")}${part("day")}`;
}

function previousKoreanBusinessDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  const cursor = new Date(
    Date.UTC(Number(part("year")), Number(part("month")) - 1, Number(part("day"))),
  );
  do {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  } while (cursor.getUTCDay() === 0 || cursor.getUTCDay() === 6);
  return cursor.toISOString().slice(0, 10).replaceAll("-", "");
}

function koreanDateOffset(providerDate: string, days: number): string {
  if (!/^\d{8}$/.test(providerDate)) {
    throw new TypeError("Expected YYYYMMDD provider date");
  }
  const cursor = new Date(
    Date.UTC(
      Number(providerDate.slice(0, 4)),
      Number(providerDate.slice(4, 6)) - 1,
      Number(providerDate.slice(6, 8)),
    ),
  );
  cursor.setUTCDate(cursor.getUTCDate() + days);
  return cursor.toISOString().slice(0, 10).replaceAll("-", "");
}

function calendarDate(value: string): string {
  return /^\d{8}$/.test(value)
    ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
    : value;
}

function openDartDateInstant(providerDate: string): string {
  const year = providerDate.slice(0, 4);
  const month = providerDate.slice(4, 6);
  const day = providerDate.slice(6, 8);
  return new Date(`${year}-${month}-${day}T00:00:00+09:00`).toISOString();
}

function payloadHash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

function kisHeadlineInstant(
  providerDate: string,
  providerTime: string,
): string | null {
  if (!/^\d{8}$/.test(providerDate) || !/^\d{6}$/.test(providerTime)) {
    return null;
  }
  const instant = Date.parse(
    `${providerDate.slice(0, 4)}-${providerDate.slice(4, 6)}-${providerDate.slice(6, 8)}T${providerTime.slice(0, 2)}:${providerTime.slice(2, 4)}:${providerTime.slice(4, 6)}+09:00`,
  );
  return Number.isFinite(instant) ? new Date(instant).toISOString() : null;
}

function secFormKoreanLabel(formType: string): string {
  const base = formType.replace(/\/A$/, "");
  const label: Readonly<Record<string, string>> = {
    "8-K": "주요사항보고서",
    "10-K": "연차보고서",
    "10-Q": "분기보고서",
    "6-K": "외국기업 주요사항보고서",
    "20-F": "외국기업 연차보고서",
    "S-4": "합병·인수 관련 증권신고서",
    "SC 13D": "대량보유 지분 공시",
    "SC 13G": "대량보유 지분 공시",
    "SC TO-I": "공개매수 공시",
    "SC TO-T": "제3자 공개매수 공시",
    "4": "임원·주요주주 거래 공시",
  };
  const translated = label[base] ?? `${base} 공시`;
  return formType.endsWith("/A") ? `[정정] ${translated}` : translated;
}

function containsHangul(value: string): boolean {
  return /[가-힣]/.test(value);
}

function desktopPaperPolicy(venue = "KRX"): PaperFillPolicy {
  const isUs = ["NASDAQ", "NYSE", "AMEX"].includes(venue);
  return {
    maxMarketDataAgeMs: MAX_EXECUTION_MARKET_AGE_MS,
    passiveFillModel: "AT_OR_THROUGH",
    marketRemainder: "CANCEL",
    marketableLimitRemainder: "REST",
    vwapScale: 8,
    version: "DESKTOP_INITIAL_V1",
    tickRule: {
      kind: "FIXED",
      venue,
      version: isUs ? "US_CENT_TICK_V1" : "KRX_WON_TICK_FALLBACK_V1",
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      effectiveTo: null,
      tickSize: isUs ? "0.01" : "1",
    },
    minimumPrice: isUs ? "0.01" : "1",
    maximumPrice: "1000000000",
  };
}

function isRecentProviderEvent(
  value: string | null,
  nowMs: number,
  maximumAgeMs = MAX_EXECUTION_MARKET_AGE_MS,
): boolean {
  if (value === null) return false;
  const timestamp = Date.parse(value);
  const age = nowMs - timestamp;
  return (
    Number.isFinite(timestamp) &&
    age >= 0 &&
    age <= maximumAgeMs
  );
}

export function isDesktopPaperMarketExecutable(
  market: Pick<
    DesktopMarketProjection,
    | "mode"
    | "connectionState"
    | "freshness"
    | "venue"
    | "session"
    | "orderBookReceivedAt"
    | "tradeReceivedAt"
    | "bids"
    | "asks"
  >,
  nowMs = Date.now(),
): boolean {
  const isUsVenue = ["NASDAQ", "NYSE", "AMEX"].includes(market.venue);
  const hasFreshBook = isRecentProviderEvent(
    market.orderBookReceivedAt,
    nowMs,
    isUsVenue ? 60_000 : MAX_EXECUTION_MARKET_AGE_MS,
  );
  const hasFreshTrade = isRecentProviderEvent(market.tradeReceivedAt, nowMs);
  return (
    market.mode === "KIS_READ_ONLY" &&
    market.connectionState === "LIVE" &&
    market.freshness === "live" &&
    (market.session === "REGULAR" ||
      (market.venue === "NXT" &&
        (market.session === "PRE" || market.session === "AFTER")) ||
      (isUsVenue &&
        (market.session === "PRE" || market.session === "AFTER"))) &&
    hasFreshBook &&
    (isUsVenue || hasFreshTrade) &&
    market.bids.length > 0 &&
    market.asks.length > 0
  );
}

function ceilRate(amount: bigint, ratePpm: bigint): bigint {
  if (amount === 0n || ratePpm === 0n) return 0n;
  return (amount * ratePpm + ONE_MILLION - 1n) / ONE_MILLION;
}

function currencyDecimalToMinor(value: string, currency: string): bigint {
  const scale = currency === "USD" ? 2 : currency === "KRW" ? 0 : null;
  if (scale === null || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
    throw new Error("Unsupported paper execution currency or decimal");
  }
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > scale) {
    throw new Error("Paper execution exceeds the currency minor-unit scale");
  }
  return BigInt(`${whole}${fraction.padEnd(scale, "0")}`);
}

function safeStatusMessage(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return `읽기 전용 연결 실패 · ${error.code}`;
  }
  return "읽기 전용 연결을 사용할 수 없습니다.";
}

function safeChartStatusMessage(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return `KIS 차트 조회 실패 · ${error.code}`;
  }
  return "KIS 차트 데이터를 조회할 수 없습니다.";
}

function connectionState(
  projection: MarketLiveProjection,
): DesktopConnectionState {
  switch (projection.connectionStatus) {
    case "connecting":
    case "subscribing":
    case "reconnecting":
      return "CONNECTING";
    case "live":
      return projection.freshness === "stale" ? "STALE" : "LIVE";
    case "failed":
      return "ERROR";
    case "idle":
      return "OFFLINE";
    case "stopped":
      return "OFFLINE";
  }
}

export function resolveDesktopMarketSession(
  bookProviderTime: string | null,
  tradeSession: DesktopMarketSession | null,
  venue = "KRX",
): DesktopMarketSession {
  if (
    (venue === "NXT" || ["NASDAQ", "NYSE", "AMEX"].includes(venue)) &&
    tradeSession !== null
  ) return tradeSession;
  if (["NASDAQ", "NYSE", "AMEX"].includes(venue)) return "UNKNOWN";
  const bookSession = domesticSessionFromProviderTime(bookProviderTime ?? "");
  if (tradeSession === null) return bookSession;
  if (bookProviderTime === null || tradeSession === bookSession) {
    return tradeSession;
  }
  return bookSession;
}

function toDesktopMarketProjection(
  projection: MarketLiveProjection,
  sequence: bigint,
): DesktopMarketProjection {
  const tick = projection.trade;
  const book = projection.orderBook;
  const identityVenue = projection.instrumentId.split(":")[0] ?? "KRX";
  const projectedVenue = book?.venue ?? tick?.venue ?? identityVenue;
  const session = resolveDesktopMarketSession(
    book?.providerTime ?? null,
    tick?.session ?? null,
    projectedVenue,
  );
  return {
    schemaVersion: 1,
    instrumentId: projection.instrumentId,
    symbol: projection.instrumentId.split(":")[1] ?? "",
    venue: projectedVenue,
    currency: ["NASDAQ", "NYSE", "AMEX"].includes(projectedVenue)
      ? "USD"
      : "KRW",
    mode: "KIS_READ_ONLY",
    connectionState: connectionState(projection),
    freshness:
      projection.freshness === "live"
        ? "live"
        : projection.freshness === "stale"
          ? "stale"
          : "offline",
    session,
    price: tick?.price ?? null,
    change: tick?.change ?? null,
    changeRate: tick?.changeRate ?? null,
    executionStrength: tick?.executionStrength ?? null,
    cumulativeVolume: tick?.cumulativeVolume ?? null,
    cumulativeTurnover: tick?.cumulativeTurnover ?? null,
    openPrice: null,
    highPrice: null,
    lowPrice: null,
    bids: book?.bids ?? [],
    asks: book?.asks ?? [],
    totalBidQuantity: book?.totalBidQuantity ?? null,
    totalAskQuantity: book?.totalAskQuantity ?? null,
    providerTime: book?.providerTime ?? tick?.providerTime ?? null,
    receivedAt: projection.lastReceivedAt,
    orderBookReceivedAt: projection.lastOrderBookReceivedAt,
    tradeReceivedAt: projection.lastTradeReceivedAt,
    orderBookOccurredAt: book?.occurredAt ?? null,
    tradeOccurredAt: tick?.occurredAt ?? null,
    sequence: sequence.toString(),
    statusMessage:
      projection.lastError === null
        ? `KIS 읽기 전용 · ${projection.coverage}`
        : `KIS 읽기 전용 · ${projection.lastError.code}`,
  };
}

function initialMarket(symbol: string): DesktopMarketProjection {
  return {
    schemaVersion: 1,
    instrumentId: `KRX:${symbol}`,
    symbol,
    venue: "KRX",
    currency: "KRW",
    mode: "FIXTURE",
    connectionState: "DISABLED",
    freshness: "offline",
    session: "UNKNOWN",
    price: null,
    change: null,
    changeRate: null,
    executionStrength: null,
    cumulativeVolume: null,
    cumulativeTurnover: null,
    openPrice: null,
    highPrice: null,
    lowPrice: null,
    bids: [],
    asks: [],
    totalBidQuantity: null,
    totalAskQuantity: null,
    providerTime: null,
    receivedAt: null,
    orderBookReceivedAt: null,
    tradeReceivedAt: null,
    orderBookOccurredAt: null,
    tradeOccurredAt: null,
    sequence: "0",
    statusMessage:
      "합성 fixture fallback · KIS 읽기 전용 연결을 시작하지 않았습니다.",
  };
}

function initialUsMarket(
  symbol: string,
  venue: "NASDAQ" | "NYSE" | "AMEX",
): DesktopMarketProjection {
  return {
    ...initialMarket(symbol),
    instrumentId: `${venue}:${symbol}`,
    venue,
    currency: "USD",
    statusMessage: "KIS 미국 읽기 전용 실시간 시세 연결을 시작하지 않았습니다.",
  };
}

function initialChart(symbol: string): DesktopChartProjection {
  return {
    schemaVersion: 1,
    instrumentId: `KRX:${symbol}`,
    interval: "1m",
    range: "1D",
    state: "DISABLED",
    candles: [],
    source: "FIXTURE",
    turnoverQuality: "UNAVAILABLE",
    paginationComplete: false,
    fetchedAt: null,
    statusMessage: "KIS 차트 조회를 시작하지 않았습니다.",
  };
}

function validateChartInterval(value: unknown): DesktopChartInterval {
  if (
    typeof value !== "string" ||
    !["1m", "5m", "15m", "30m", "60m", "4h", "1d", "1w"].includes(
      value,
    )
  ) {
    throw new Error("Unsupported desktop chart interval");
  }
  return value as DesktopChartInterval;
}

function validateRankingSort(value: unknown): DesktopRankingSort {
  if (
    value === "AVERAGE_VOLUME" ||
    value === "VOLUME_INCREASE" ||
    value === "TURNOVER" ||
    value === "CHANGE_RATE_GAINERS" ||
    value === "CHANGE_RATE_LOSERS"
  ) {
    return value;
  }
  throw new Error("Unsupported domestic ranking sort");
}

function validateChartRange(
  value: unknown,
  interval: DesktopChartInterval,
): DesktopChartRange {
  if (
    typeof value !== "string" ||
    !["1D", "6M", "1Y", "5Y"].includes(value)
  ) {
    throw new Error("Unsupported desktop chart range");
  }
  const range = value as DesktopChartRange;
  if (isIntradayChartInterval(interval) ? range !== "1D" : range === "1D") {
    throw new Error("Chart interval and range are incompatible");
  }
  return range;
}

function isIntradayChartInterval(
  interval: DesktopChartInterval,
): boolean {
  return ["1m", "5m", "15m", "30m", "60m", "4h"].includes(interval);
}

function krxDateParts(date: Date): {
  year: number;
  month: number;
  day: number;
} {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year ?? "0"),
    month: Number(values.month ?? "0"),
    day: Number(values.day ?? "0"),
  };
}

function providerDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}${String(month).padStart(2, "0")}${String(day).padStart(2, "0")}`;
}

export function resolveDesktopChartRange(
  range: Exclude<DesktopChartRange, "1D">,
  now = new Date(),
): { startDate: string; endDate: string; maxPages: number } {
  const { year, month, day } = krxDateParts(now);
  const monthsBack = range === "6M" ? 6 : range === "1Y" ? 12 : 60;
  const absoluteMonth = year * 12 + (month - 1) - monthsBack;
  const startYear = Math.floor(absoluteMonth / 12);
  const startMonthIndex = ((absoluteMonth % 12) + 12) % 12;
  const finalDay = new Date(
    Date.UTC(startYear, startMonthIndex + 1, 0),
  ).getUTCDate();
  const startDay = Math.min(day, finalDay);
  return {
    startDate: providerDate(startYear, startMonthIndex + 1, startDay),
    endDate: providerDate(year, month, day),
    maxPages: range === "6M" ? 2 : range === "1Y" ? 4 : 15,
  };
}

export function resolveDesktopIntradayCursor(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const providerTime = `${values.hour ?? "00"}${values.minute ?? "00"}${values.second ?? "00"}`;
  return providerTime < "090000" || providerTime > "153000"
    ? "153000"
    : providerTime;
}

function toDesktopChartProjection(
  history: DomesticCandleHistory,
  range: DesktopChartRange,
): DesktopChartProjection {
  return {
    schemaVersion: 1,
    instrumentId: history.instrumentId,
    interval: history.interval,
    range,
    state: "READY",
    candles: history.candles.map((candle) => ({
      id: `${candle.instrumentId}:${candle.interval}:${candle.openedAt}`,
      openedAt: candle.openedAt,
      closedAt: candle.closedAt,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
      turnover: candle.turnover,
      forming: candle.state === "FORMING",
    })),
    source: "KIS_REST",
    turnoverQuality: history.quality.turnover,
    paginationComplete: history.pagination.complete,
    fetchedAt: history.source.fetchedAt,
    statusMessage:
      history.interval === "1m"
        ? `KIS ${history.pagination.complete ? "당일" : "최근"} 1분봉 · ${history.candles.length}개${history.pagination.complete ? "" : " · 부분 조회"} · 거래대금 미제공`
        : `KIS ${range} 일봉 · ${history.candles.length}개${history.pagination.complete ? "" : " · 부분 조회"} · 거래대금 제공`,
  };
}

function toDesktopAggregatedChartProjection(
  history: AggregatedDomesticCandleHistory,
  paginationComplete: boolean,
  range: DesktopChartRange,
): DesktopChartProjection {
  return {
    schemaVersion: 1,
    instrumentId: history.instrumentId,
    interval: history.interval,
    range,
    state: "READY",
    candles: history.candles.map((candle) => ({
      id: `${candle.instrumentId}:${candle.interval}:${candle.openedAt}`,
      openedAt: candle.openedAt,
      closedAt: candle.closedAt,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
      turnover: candle.turnover,
      forming: candle.state === "FORMING",
    })),
    source: "KIS_REST_AGGREGATED",
    turnoverQuality: history.quality.turnover,
    paginationComplete,
    fetchedAt: history.source.fetchedAt,
    statusMessage: `KIS ${range} ${history.interval} 로컬 집계 · ${history.candles.length}개${paginationComplete ? "" : " · 부분 조회"}${history.quality.turnover === "UNAVAILABLE" ? " · 거래대금 미제공" : ""}`,
  };
}

function validatePaperRequest(value: unknown): DesktopPaperOrderRequest {
  if (typeof value !== "object" || value === null) {
    throw new Error("Invalid paper-order request");
  }
  const request = value as Partial<DesktopPaperOrderRequest>;
  if (
    typeof request.requestId !== "string" ||
    !/^[A-Za-z0-9._:-]{1,128}$/.test(request.requestId) ||
    typeof request.instrumentId !== "string" ||
    !/^(?:KRX:[0-9A-Z]{6,7}|(?:NASDAQ|NYSE|AMEX):[A-Z0-9.-]{1,20})$/.test(request.instrumentId) ||
    (request.side !== "BUY" && request.side !== "SELL") ||
    (request.orderType !== "MARKET" && request.orderType !== "LIMIT") ||
    typeof request.quantity !== "string" ||
    !/^[1-9]\d*$/.test(request.quantity) ||
    (request.limitPrice !== null &&
      (typeof request.limitPrice !== "string" ||
        !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(request.limitPrice) ||
        request.limitPrice === "0")) ||
    (request.orderType === "LIMIT" && request.limitPrice === null) ||
    (request.orderType === "MARKET" && request.limitPrice !== null)
  ) {
    throw new Error("Invalid paper-order request");
  }
  return request as DesktopPaperOrderRequest;
}

const MARKET_CONTEXT_DESCRIPTORS = [
  {
    id: "kospi",
    label: "KOSPI",
    instrumentId: "KRX:KOSPI",
    assetClass: "INDEX_SPOT",
    representation: "OFFICIAL_INDEX",
    canonicalVenue: "KRX",
    currency: "KRW",
    proxyDisclosure: null,
  },
  {
    id: "kosdaq",
    label: "KOSDAQ",
    instrumentId: "KRX:KOSDAQ",
    assetClass: "INDEX_SPOT",
    representation: "OFFICIAL_INDEX",
    canonicalVenue: "KRX",
    currency: "KRW",
    proxyDisclosure: null,
  },
  {
    id: "kospi200",
    label: "KOSPI 200",
    instrumentId: "KRX:KOSPI200",
    assetClass: "INDEX_SPOT",
    representation: "OFFICIAL_INDEX",
    canonicalVenue: "KRX",
    currency: "KRW",
    proxyDisclosure: null,
  },
  {
    id: "nasdaq-proxy",
    label: "NASDAQ 방향",
    instrumentId: "NASDAQ:QQQ",
    assetClass: "ETF_PROXY",
    representation: "ETF_PROXY",
    canonicalVenue: "NASDAQ",
    currency: "USD",
    proxyDisclosure: "QQQ ETF 스냅샷 · Nasdaq 지수나 NQ/MNQ 선물이 아님",
  },
  {
    id: "sp500-proxy",
    label: "S&P 500 방향",
    instrumentId: "NYSEARCA:SPY",
    assetClass: "ETF_PROXY",
    representation: "ETF_PROXY",
    canonicalVenue: "NYSEARCA",
    currency: "USD",
    proxyDisclosure: "SPY ETF 스냅샷 · S&P 500 지수나 ES/MES 선물이 아님",
  },
  {
    id: "russell-proxy",
    label: "Russell 방향",
    instrumentId: "NYSEARCA:IWM",
    assetClass: "ETF_PROXY",
    representation: "ETF_PROXY",
    canonicalVenue: "NYSEARCA",
    currency: "USD",
    proxyDisclosure: "IWM ETF 스냅샷 · RUT/RTY/M2K가 아님",
  },
  {
    id: "oil-proxy",
    label: "WTI 방향",
    instrumentId: "NYSEARCA:USO",
    assetClass: "ETF_PROXY",
    representation: "ETF_PROXY",
    canonicalVenue: "NYSEARCA",
    currency: "USD",
    proxyDisclosure: "USO ETF 스냅샷 · WTI 현물이나 CL/MCL 선물이 아님",
  },
  {
    id: "gold-proxy",
    label: "금 방향",
    instrumentId: "NYSEARCA:GLD",
    assetClass: "ETF_PROXY",
    representation: "ETF_PROXY",
    canonicalVenue: "NYSEARCA",
    currency: "USD",
    proxyDisclosure: "GLD ETF 스냅샷 · 금 현물이나 GC/MGC 선물이 아님",
  },
] as const;

const UNAVAILABLE_FUTURE_DESCRIPTORS = [
  {
    id: "kospi200-day-future",
    label: "KOSPI200 주간 선물",
    instrumentId: "KRX:FUTURE:KOSPI200:DAY",
    assetClass: "INDEX_FUTURE",
    canonicalVenue: "KRX",
    currency: "KRW",
    entitlement: "UNKNOWN",
    statusMessage: "실제 월물 resolver와 KIS 파생 WebSocket 연결 준비 중",
  },
  {
    id: "kospi200-night-future",
    label: "KOSPI200 야간 선물",
    instrumentId: "KRX:FUTURE:KOSPI200:NIGHT",
    assetClass: "INDEX_FUTURE",
    canonicalVenue: "KRX",
    currency: "KRW",
    entitlement: "UNKNOWN",
    statusMessage: "야간 세션 권한과 실제 월물 연결 준비 중",
  },
  {
    id: "kosdaq150-future",
    label: "KOSDAQ150 선물",
    instrumentId: "KRX:FUTURE:KOSDAQ150",
    assetClass: "INDEX_FUTURE",
    canonicalVenue: "KRX",
    currency: "KRW",
    entitlement: "UNKNOWN",
    statusMessage: "KOSDAQ150 실제 월물 어댑터 준비 중",
  },
  {
    id: "nasdaq-future",
    label: "NASDAQ 선물 NQ/MNQ",
    instrumentId: "CME:FUTURE:NQ-MNQ",
    assetClass: "INDEX_FUTURE",
    canonicalVenue: "CME",
    currency: "USD",
    entitlement: "REQUIRED",
    statusMessage: "CME 실시간 시세 권한과 실제 월물 연결 필요",
  },
  {
    id: "sp500-future",
    label: "S&P 500 선물 ES/MES",
    instrumentId: "CME:FUTURE:ES-MES",
    assetClass: "INDEX_FUTURE",
    canonicalVenue: "CME",
    currency: "USD",
    entitlement: "REQUIRED",
    statusMessage: "CME 실시간 시세 권한과 실제 월물 연결 필요",
  },
  {
    id: "oil-future",
    label: "WTI 선물 CL/MCL",
    instrumentId: "CME:FUTURE:CL-MCL",
    assetClass: "COMMODITY_FUTURE",
    canonicalVenue: "CME",
    currency: "USD",
    entitlement: "REQUIRED",
    statusMessage: "NYMEX 실시간 시세 권한과 실제 월물 연결 필요",
  },
  {
    id: "gold-future",
    label: "금 선물 GC/MGC",
    instrumentId: "CME:FUTURE:GC-MGC",
    assetClass: "COMMODITY_FUTURE",
    canonicalVenue: "CME",
    currency: "USD",
    entitlement: "REQUIRED",
    statusMessage: "COMEX 실시간 시세 권한과 실제 월물 연결 필요",
  },
] as const;

function unavailableMarketContextItems(): DesktopMarketContextItemProjection[] {
  return UNAVAILABLE_FUTURE_DESCRIPTORS.map((descriptor) => ({
    ...descriptor,
    representation: "ACTUAL_FUTURE",
    tradable: false,
    price: null,
    change: null,
    changeRate: null,
    transport: "NONE",
    dataQuality: "UNAVAILABLE",
    freshness: "UNAVAILABLE",
    session: "UNKNOWN",
    provider: "UNAVAILABLE",
    occurredAt: null,
    receivedAt: null,
    proxyDisclosure: null,
  }));
}

function marketContextItemFromSnapshot(
  snapshot: KisMarketContextSnapshot,
): DesktopMarketContextItemProjection {
  const descriptor = MARKET_CONTEXT_DESCRIPTORS.find(
    (item) => item.instrumentId === snapshot.instrumentId,
  );
  if (!descriptor) {
    throw new Error("Unexpected KIS market-context instrument");
  }
  const isProxy = descriptor.representation === "ETF_PROXY";
  return {
    ...descriptor,
    tradable: false,
    price: snapshot.price,
    change: snapshot.change,
    changeRate: snapshot.changeRate,
    transport: "REST_POLLING",
    dataQuality: isProxy ? "PROXY_SNAPSHOT" : "OFFICIAL_SNAPSHOT",
    entitlement: "AUTHORIZED",
    freshness: "DELAYED_OR_POLLING",
    session: "UNKNOWN",
    provider: "KIS",
    occurredAt: null,
    receivedAt: snapshot.receivedAt,
    statusMessage: isProxy
      ? "KIS 미국 ETF REST 스냅샷"
      : "KIS 국내 지수 REST 스냅샷",
  };
}

function failedMarketContextItem(
  descriptor: (typeof MARKET_CONTEXT_DESCRIPTORS)[number],
): DesktopMarketContextItemProjection {
  return {
    ...descriptor,
    tradable: false,
    price: null,
    change: null,
    changeRate: null,
    transport: "REST_POLLING",
    dataQuality:
      descriptor.representation === "ETF_PROXY"
        ? "PROXY_SNAPSHOT"
        : "OFFICIAL_SNAPSHOT",
    entitlement: "UNKNOWN",
    freshness: "UNAVAILABLE",
    session: "UNKNOWN",
    provider: "KIS",
    occurredAt: null,
    receivedAt: null,
    statusMessage: "KIS 스냅샷을 받지 못했습니다.",
  };
}

function waitForMarketContextQuota(): Promise<void> {
  return new Promise((resolve) =>
    setTimeout(resolve, MARKET_CONTEXT_REQUEST_GAP_MS),
  );
}

export class DesktopRuntime {
  readonly #database: Database.Database;
  readonly #accounts: LocalSimulationRepository;
  readonly #papers: LocalPaperTradingRepository;
  readonly #information: LocalInformationRepository;
  readonly #marketCalendar: LocalMarketCalendarRepository;
  readonly #marketSnapshots: LocalMarketSnapshotRepository;
  readonly #instrumentMaster: KisDomesticInstrumentMaster;
  readonly #usInstrumentMaster: KisUsInstrumentMaster;
  readonly #emitMarket: (projection: DesktopMarketProjection) => void;
  readonly #emitAccount: (projection: DesktopAccountProjection) => void;
  readonly #emitChart: (projection: DesktopChartProjection) => void;
  readonly #calendarFetch: typeof fetch | null;
  #symbol: string;
  #usExchange: "NAS" | "NYS" | "AMS" | null = null;
  readonly #simulationProfile:
    | "INITIAL_CONSERVATIVE_V1"
    | "ADVANCED_QUEUE_V1";
  readonly #queueSafetyFactor: string;

  #market: DesktopMarketProjection;
  #chart: DesktopChartProjection;
  readonly #authByEnvironment = new Map<"paper" | "prod", KisAuthClient>();
  readonly #chartCache = new Map<string, DesktopChartProjection>();
  readonly #chartRequests = new Map<
    string,
    Promise<DesktopChartProjection>
  >();
  #chartRequestGate: Promise<void> = Promise.resolve();
  #lastChartRequestAt = 0;
  #connectRequest: Promise<DesktopMarketProjection> | null = null;
  #informationRequest: Promise<DesktopInformationFeedProjection> | null = null;
  #informationCache:
    | { readonly projection: DesktopInformationFeedProjection; readonly at: number }
    | null = null;
  #openDartLastFullSyncDate: string | null = null;
  #openDartLastFullSyncAt = 0;
  #openDartCorpCodes:
    | { readonly date: string; readonly byCorpCode: ReadonlyMap<string, OpenDartCorpCode> }
    | null = null;
  #marketContextRequest: Promise<DesktopMarketContextProjection> | null = null;
  #marketContextCache:
    | { readonly projection: DesktopMarketContextProjection; readonly at: number }
    | null = null;
  #marketCalendarCache:
    | { readonly projection: DesktopMarketCalendarProjection; readonly at: number }
    | null = null;
  readonly #streams = new Set<DomesticKisLiveStream>();
  #marketConnectionGeneration = 0;
  #marketSequence = 0n;
  #lastProcessedTradeIdentity: string | null = null;
  #lastOrderBookSnapshotWriteAt = 0;

  public constructor(options: {
    userDataPath: string;
    emitMarket: (projection: DesktopMarketProjection) => void;
    emitAccount?: (projection: DesktopAccountProjection) => void;
    emitChart?: (projection: DesktopChartProjection) => void;
    calendarFetch?: typeof fetch | null;
  }) {
    const config = loadRuntimeConfig();
    this.#symbol = config.KIS_DOMESTIC_SYMBOL;
    this.#simulationProfile = config.PAPER_FILL_PROFILE;
    this.#queueSafetyFactor = config.PAPER_QUEUE_SAFETY_FACTOR;
    const opened = openUserDataDatabase(options.userDataPath);
    this.#database = opened.database;
    this.#accounts = new LocalSimulationRepository(this.#database);
    this.#papers = new LocalPaperTradingRepository(this.#database);
    this.#information = new LocalInformationRepository(this.#database);
    this.#marketCalendar = new LocalMarketCalendarRepository(this.#database);
    this.#marketSnapshots = new LocalMarketSnapshotRepository(this.#database);
    this.#instrumentMaster = new KisDomesticInstrumentMaster({
      userDataPath: options.userDataPath,
    });
    this.#usInstrumentMaster = new KisUsInstrumentMaster({
      userDataPath: options.userDataPath,
    });
    this.#emitMarket = options.emitMarket;
    this.#emitAccount = options.emitAccount ?? (() => undefined);
    this.#emitChart = options.emitChart ?? (() => undefined);
    this.#calendarFetch = options.calendarFetch === undefined ? fetch : options.calendarFetch;
    this.#market = initialMarket(this.#symbol);
    this.#chart = initialChart(this.#symbol);
    this.#ensureDefaultAccount();
  }

  public getBootstrap(): DesktopBootstrapProjection {
    return {
      schemaVersion: 1,
      market: this.#market,
      account: this.#accountProjection(),
      chart: this.#chart,
      actualOrderCapability: "FORBIDDEN",
    };
  }

  public async getInvestorFlow(): Promise<DesktopInvestorFlowProjection> {
    const fetchedAt = new Date().toISOString();
    const symbol = this.#symbol;
    const config = loadRuntimeConfig();
    const krxProviderNote = "KRX 통계 CSV 수급을 우선하고 실패하면 KIS 읽기 전용으로 fallback합니다.";
    const unavailable = (message: string): DesktopInvestorFlowProjection => ({
      schemaVersion: 1,
      state: "UNAVAILABLE",
      source: "KIS_REST",
      instrument: null,
      markets: [],
      fetchedAt: null,
      statusMessage: message,
    });
    const flowValue = (participant: "INDIVIDUAL" | "FOREIGN" | "INSTITUTION" | "PROGRAM", value: { sellQuantity: string; buyQuantity: string; netBuyQuantity: string; sellAmount: string; buyAmount: string; netBuyAmount: string }) => ({ participant, ...value });
    const calendarDate = (value: string): string =>
      /^\d{8}$/.test(value)
        ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
        : value;
    const providerClockTime = (value: string): string =>
      /^\d{6}$/.test(value)
        ? `${value.slice(0, 2)}:${value.slice(2, 4)}:${value.slice(4, 6)}`
        : value;
    const masterResult = this.#usExchange === null
      ? await this.#instrumentMaster.search(symbol, 1).catch(() => null)
      : null;
    const master = masterResult?.items[0];
    let krxFallbackReason: string | null = null;
    if (
      this.#usExchange === null &&
      master?.standardCode !== undefined &&
      /^KR[0-9A-Z]{10}$/.test(master.standardCode)
    ) {
      try {
        const toDate = previousKoreanBusinessDate();
        const client = new KrxInvestorFlowClient();
        const [stockResult, marketResult] = await Promise.allSettled([
          client.getInvestorByStock({
            symbol,
            isin: master.standardCode,
            name: master.name,
            fromDate: koreanDateOffset(toDate, -7),
            toDate,
          }),
          client.getMarketInvestorFlow({
            market: "ALL",
            fromDate: koreanDateOffset(toDate, -7),
            toDate,
          }),
        ]);
        const stock = stockResult.status === "fulfilled"
          ? stockResult.value.rows[0] ?? null
          : null;
        const market = marketResult.status === "fulfilled"
          ? marketResult.value.rows[0] ?? null
          : null;
        if (stock !== null) {
          const markets = market === null ? [] : [
            {
              market: "ALL" as const,
              currency: "KRW" as const,
              providerTimestamp: null,
              quality: "PROVIDER_REPORTED_SNAPSHOT_FINALITY_UNKNOWN" as const,
              participants: [
                flowValue("INDIVIDUAL", market.individual),
                flowValue("FOREIGN", market.foreign),
                flowValue("INSTITUTION", market.institution),
              ],
              statusMessage: "KRX 통계 CSV 전체 시장 투자자 수급 수신",
            },
          ];
          return {
            schemaVersion: 1,
            state: "PARTIAL",
            source: "KRX_DATA_PRODUCT",
            instrument: {
              instrumentId: `KRX:${symbol}`,
              symbol,
              name: master.name,
              market: master.market,
              currency: "KRW",
              investorSummary: {
                businessDate: calendarDate(stock.businessDate),
                quality: "PROVIDER_REPORTED_AFTER_CLOSE",
                participants: [
                  flowValue("INDIVIDUAL", stock.individual),
                  flowValue("FOREIGN", stock.foreign),
                  flowValue("INSTITUTION", stock.institution),
                ],
              },
              programSummary: null,
              statusMessage: "KRX 통계 CSV 종목별 투자자 수급 수신",
            },
            markets,
            fetchedAt: stock.businessDate ? fetchedAt : null,
            statusMessage:
              market === null
                ? "KRX 통계 CSV 종목별 투자자 수급 수신 · 전체 시장 수급은 미수신, 프로그램매매는 전용 CSV payload 확인 후 연결됩니다."
                : "KRX 통계 CSV 종목별·전체 시장 투자자 수급 수신 · 프로그램매매는 전용 CSV payload 확인 후 연결됩니다.",
          };
        }
      } catch (error) {
        krxFallbackReason = safeStatusMessage(error);
      }
    } else if (this.#usExchange === null) {
      krxFallbackReason = "KRX 통계 CSV 조회에 필요한 표준코드(ISIN)를 종목 master에서 찾지 못했습니다.";
    }
    let credentials;
    try {
      assertLiveReadOnlyAcknowledgement(config);
      credentials = requireKisCredentialsForEnvironment(config, "prod");
    } catch {
      return unavailable(`${krxProviderNote} KIS 실전 읽기 전용 데이터 키가 필요합니다.${krxFallbackReason ? ` KRX fallback: ${krxFallbackReason}` : ""}`);
    }
    try {
      const auth = this.#authClient("prod", credentials);
      const client = new KisDomesticInvestorFlowClient({
        environment: "prod",
        credentials,
        getAccessToken: () => auth.getAccessToken(),
      });
      const after = <T>(delayMs: number, request: () => Promise<T>) =>
        new Promise<void>((resolve) => setTimeout(resolve, delayMs)).then(request);
      const [stockResult, programResult, kospiResult, kosdaqResult] =
        await Promise.allSettled([
          client.getInvestorByStock(symbol),
          after(80, () => client.getProgramByStock(symbol)),
          after(160, () => client.getMarketInvestorTime("KOSPI")),
          after(240, () => client.getMarketInvestorTime("KOSDAQ")),
        ]);
      const stock = stockResult.status === "fulfilled" ? stockResult.value.rows[0] ?? null : null;
      const program = programResult.status === "fulfilled" ? programResult.value.rows[0] ?? null : null;
      const resultIssue = (label: string, result: PromiseSettledResult<unknown>): string | null =>
        result.status === "rejected"
          ? `${label} ${safeStatusMessage(result.reason)}`
          : null;
      const marketProjection = (result: typeof kospiResult, market: "KOSPI" | "KOSDAQ") => {
        if (result.status !== "fulfilled" || !result.value.rows[0]) return null;
        const row = result.value.rows[0];
        return {
          market,
          currency: "KRW" as const,
          providerTimestamp: null,
          quality: "PROVIDER_REPORTED_SNAPSHOT_FINALITY_UNKNOWN" as const,
          participants: [flowValue("INDIVIDUAL", row.individual), flowValue("FOREIGN", row.foreign), flowValue("INSTITUTION", row.institution)],
          statusMessage: `${market} KIS 조회 스냅샷`,
        };
      };
      const markets = [marketProjection(kospiResult, "KOSPI"), marketProjection(kosdaqResult, "KOSDAQ")].filter((item): item is NonNullable<typeof item> => item !== null);
      const missing = [
        stock ? null : "종목 투자자",
        program ? null : "프로그램",
        markets.some((item) => item.market === "KOSPI") ? null : "KOSPI",
        markets.some((item) => item.market === "KOSDAQ") ? null : "KOSDAQ",
      ].filter((item): item is string => item !== null);
      const issues = [
        resultIssue("종목", stockResult),
        resultIssue("프로그램", programResult),
        resultIssue("KOSPI", kospiResult),
        resultIssue("KOSDAQ", kosdaqResult),
      ].filter((item): item is string => item !== null);
      const instrument = stock || program ? {
        instrumentId: `KRX:${symbol}`,
        symbol,
        name: master?.name ?? symbol,
        market: master?.market ?? "KOSPI",
        currency: "KRW" as const,
        investorSummary: stock ? { businessDate: calendarDate(stock.businessDate), quality: "PROVIDER_REPORTED_AFTER_CLOSE" as const, participants: [flowValue("INDIVIDUAL", stock.individual), flowValue("FOREIGN", stock.foreign), flowValue("INSTITUTION", stock.institution)] } : null,
        programSummary: program ? { providerTime: providerClockTime(program.providerTime), quality: "PROVIDER_REPORTED_FORMING_CUMULATIVE" as const, participant: flowValue("PROGRAM", program.program) } : null,
        statusMessage: stock && program ? "종목 수급·프로그램 조회 완료" : "일부 종목 수급만 조회됨",
      } : null;
      return {
        schemaVersion: 1,
        state: instrument && markets.length === 2 ? "READY" : instrument || markets.length ? "PARTIAL" : "ERROR",
        source: "KIS_REST",
        instrument,
        markets,
        fetchedAt,
        statusMessage:
          missing.length === 0
            ? `${krxProviderNote}${krxFallbackReason ? ` KRX fallback: ${krxFallbackReason} ·` : ""} KIS 투자자 수급 조회 완료`
            : instrument || markets.length
              ? `${krxProviderNote}${krxFallbackReason ? ` KRX fallback: ${krxFallbackReason} ·` : ""} 일부 수급 미수신: ${missing.join(", ")}${issues.length ? ` · ${issues.join(" · ")}` : ""}`
              : `${krxProviderNote}${krxFallbackReason ? ` KRX fallback: ${krxFallbackReason} ·` : ""} KIS 투자자 수급을 받지 못했습니다.${issues.length ? ` ${issues.join(" · ")}` : ""}`,
      };
    } catch (error) {
      return { ...unavailable(safeStatusMessage(error)), state: "ERROR", fetchedAt };
    }
  }

  public async getShortSelling(): Promise<DesktopShortSellingProjection> {
    const symbol = this.#symbol;
    const instrumentId = this.#market.instrumentId;
    const marketScope = this.#usExchange === null ? "KR" : "US";
    const unsupported = (message: string): DesktopShortSellingProjection => ({
      schemaVersion: 1,
      state: "UNAVAILABLE",
      source: "UNSUPPORTED",
      instrumentId,
      symbol,
      marketScope,
      fetchedAt: null,
      trade: null,
      balance: null,
      lendingBalance: null,
      statusMessage: message,
    });
    if (marketScope !== "KR") {
      return unsupported(
        "미국 short interest/short-sale volume provider가 연결되기 전까지 수치를 표시하지 않습니다.",
      );
    }
    try {
      const toDate = previousKoreanBusinessDate();
      const master = (await this.#instrumentMaster.search(symbol, 1)).items[0];
      const market = master?.market === "KOSDAQ" ? "KOSDAQ" : "KOSPI";
      const client = new KrxShortSellingClient();
      const [tradeResult, balanceResult] = await Promise.allSettled([
        client.getTradeByStock({
          symbol,
          market,
          fromDate: koreanDateOffset(toDate, -32),
          toDate,
        }),
        master?.standardCode !== undefined && /^KR[0-9A-Z]{10}$/.test(master.standardCode)
          ? client.getBalanceByStock({
              symbol,
              isin: master.standardCode,
              name: master.name,
              market,
              fromDate: koreanDateOffset(toDate, -32),
              toDate,
            })
          : Promise.reject(new Error("KRX_SHORT_BALANCE_ISIN_MISSING")),
      ]);
      const trade = tradeResult.status === "fulfilled" ? tradeResult.value : null;
      const balance = balanceResult.status === "fulfilled" ? balanceResult.value : null;
      if (trade === null && balance === null) {
        const reason = tradeResult.status === "rejected"
          ? safeStatusMessage(tradeResult.reason)
          : "KRX 공매도 거래 CSV에 선택 종목이 없습니다.";
        throw new Error(reason);
      }
      return {
        schemaVersion: 1,
        state: trade !== null && balance !== null ? "READY" : "PARTIAL",
        source: "KRX_DATA_PRODUCT",
        instrumentId: `KRX:${symbol}`,
        symbol,
        marketScope: "KR",
        fetchedAt: trade?.fetchedAt ?? balance?.fetchedAt ?? null,
        trade: trade === null ? null : {
          businessDate: calendarDate(trade.businessDate),
          shortSellVolume: trade.shortSellVolume,
          shortSellTurnover: trade.shortSellTurnover,
          shortSellRatio: trade.shortSellRatio,
        },
        balance: balance === null ? null : {
          businessDate: calendarDate(balance.businessDate),
          shortBalanceQuantity: balance.shortBalanceQuantity,
          shortBalanceTurnover: balance.shortBalanceTurnover,
          shortBalanceRatio: balance.shortBalanceRatio,
        },
        lendingBalance: null,
        statusMessage:
          balance === null
            ? "KRX 통계 CSV 종목별 공매도 거래 수신 · 공매도 순보유잔고는 미수신, 대차잔고는 전용 payload 확인 후 연결됩니다."
            : "KRX 통계 CSV 종목별 공매도 거래·순보유잔고 수신 · 대차잔고는 전용 payload 확인 후 연결됩니다.",
      };
    } catch (error) {
      return {
        ...unsupported(`KRX 공매도 거래 CSV를 받지 못했습니다. ${safeStatusMessage(error)}`),
        state: "ERROR",
      };
    }
  }

  public async getRanking(
    rawMarket: unknown,
    rawSort: unknown,
  ): Promise<DesktopRankingProjection> {
    const sort = validateRankingSort(rawSort);
    const market = rawMarket === "US" ? "US" : "KRX";
    const config = loadRuntimeConfig();
    let krxFallbackReason: string | null = null;
    try {
      assertLiveReadOnlyAcknowledgement(config);
      if (market === "US") {
        const credentials = requireKisCredentialsForEnvironment(config, "prod");
        const auth = this.#authClient("prod", credentials);
        const client = new KisUsRankingClient({ credentials, getAccessToken: () => auth.getAccessToken() });
        const pages = await Promise.all(["NAS", "NYS", "AMS"].map((exchange) => client.getRanking(exchange as "NAS" | "NYS" | "AMS", sort)));
        const venue = { NAS: "NASDAQ", NYS: "NYSE", AMS: "AMEX" } as const;
        const items = pages.flat().sort((left, right) => {
          const field = sort === "TURNOVER" ? "cumulativeTurnover" : sort === "VOLUME_INCREASE" ? "volumeIncreaseRate" : sort === "AVERAGE_VOLUME" ? "cumulativeVolume" : "changeRate";
          const leftValue = Number(left[field] ?? Number.NEGATIVE_INFINITY);
          const rightValue = Number(right[field] ?? Number.NEGATIVE_INFINITY);
          return sort === "CHANGE_RATE_LOSERS" ? leftValue - rightValue : rightValue - leftValue;
        }).slice(0, 100);
        return {
          schemaVersion: 1, market: "US", sort, state: "READY", source: "KIS_REST",
          fetchedAt: new Date().toISOString(),
          statusMessage: `KIS 미국 NASDAQ·NYSE·AMEX ${items.length}개 종목 순위`,
          items: items.map((item, index) => ({
            rank: String(index + 1), instrumentId: `${venue[item.exchange]}:${item.symbol}`,
            symbol: item.symbol, name: item.name, price: item.price, change: item.change,
            changeRate: item.changeRate, cumulativeVolume: item.cumulativeVolume,
            previousVolume: item.comparisonVolume, averageVolume: item.comparisonVolume,
            volumeIncreaseRate: item.volumeIncreaseRate, volumeTurnoverRate: null,
            averageTurnover: null, turnoverTurnoverRate: null, cumulativeTurnover: item.cumulativeTurnover,
          })),
        };
      }
      if (sort !== "VOLUME_INCREASE" && hasKrxOpenApiCredentials(config)) {
        try {
          const ranking = await new KrxDailyStockTradeClient({
            client: new KrxOpenApiClient({
              credentials: requireKrxOpenApiCredentials(config),
              timeoutMs: 3_500,
            }),
          }).getRanking({
            businessDate: previousKoreanBusinessDate(),
            sort,
            limit: 100,
          });
          if (ranking.items.length > 0) {
            return {
              schemaVersion: 1,
              market: "KRX",
              sort,
              state: "READY",
              source: ranking.source,
              fetchedAt: ranking.fetchedAt,
              statusMessage: `KRX OpenAPI ${ranking.businessDate} 일별매매정보 기준 ${ranking.items.length}개 종목 순위입니다.`,
              items: ranking.items.map((item, index) => ({
                rank: String(index + 1),
                instrumentId: `KRX:${item.symbol}`,
                symbol: item.symbol,
                name: item.name,
                price: item.price,
                change: item.change,
                changeRate: item.changeRate,
                cumulativeVolume: item.cumulativeVolume,
                previousVolume: null,
                averageVolume: null,
                volumeIncreaseRate: null,
                volumeTurnoverRate: null,
                averageTurnover: null,
                turnoverTurnoverRate: null,
                cumulativeTurnover: item.cumulativeTurnover,
              })),
            };
          }
          krxFallbackReason = "KRX OpenAPI가 조회 기준일에 빈 순위를 반환했습니다.";
        } catch (error) {
          krxFallbackReason = safeStatusMessage(error);
        }
      }
      if (
        sort === "CHANGE_RATE_GAINERS" ||
        sort === "CHANGE_RATE_LOSERS"
      ) {
        const credentials = requireKisCredentialsForEnvironment(
          config,
          "prod",
        );
        const auth = this.#authClient("prod", credentials);
        const ranking = await new KisDomesticFluctuationClient({
          credentials,
          getAccessToken: () => auth.getAccessToken(),
        }).getAllRanking(
          sort === "CHANGE_RATE_GAINERS"
            ? {
                sortCode: "0",
                minimumRate: "0.01",
                maximumRate: "100",
                maxPages: 10,
              }
            : {
                sortCode: "1",
                minimumRate: "-100",
                maximumRate: "-0.01",
                maxPages: 10,
              },
        );
        return {
          schemaVersion: 1,
          market: "KRX",
          sort,
          state: "READY",
          source: ranking.source,
          fetchedAt: ranking.fetchedAt,
          statusMessage:
            sort === "CHANGE_RATE_GAINERS"
              ? `${krxFallbackReason ? `KRX fallback: ${krxFallbackReason} · ` : ""}KIS 실전 등락률 후보를 상승률 순으로 재정렬했습니다.`
              : `${krxFallbackReason ? `KRX fallback: ${krxFallbackReason} · ` : ""}KIS 실전 등락률 후보를 하락률 순으로 재정렬했습니다.`,
          items: projectDomesticFluctuationItems(ranking.items, sort).slice(
            0,
            100,
          ),
        };
      }

      const dataEnvironment = readOnlyMarketDataEnvironment(config);
      const credentials = requireKisCredentialsForEnvironment(
        config,
        dataEnvironment,
      );
      const auth = this.#authClient(dataEnvironment, credentials);
      const ranking = await new KisDomesticRankingClient({
        environment: dataEnvironment,
        credentials,
        getAccessToken: () => auth.getAccessToken(),
      }).getVolumeRanking(sort);
      const dailyItems = ranking.items.filter(isUsableDailyRankingItem);
      if (sort === "AVERAGE_VOLUME") {
        dailyItems.sort((left, right) => {
          const leftVolume = /^\d+$/.test(left.cumulativeVolume)
            ? BigInt(left.cumulativeVolume)
            : -1n;
          const rightVolume = /^\d+$/.test(right.cumulativeVolume)
            ? BigInt(right.cumulativeVolume)
            : -1n;
          return leftVolume === rightVolume
            ? 0
            : leftVolume > rightVolume
              ? -1
              : 1;
        });
      } else if (sort === "VOLUME_INCREASE") {
        dailyItems.sort(compareDailyVolumeRatioDescending);
      }
      return {
        schemaVersion: 1,
        market,
        sort,
        state: "READY",
        source: ranking.source,
        fetchedAt: ranking.fetchedAt,
        statusMessage:
          dailyItems.length === 0
            ? "KIS 조회 거래일에 체결된 거래가 아직 없어 순위를 표시하지 않습니다. 장 시작 전 0 거래량을 -100%로 계산하지 않습니다."
            : sort === "AVERAGE_VOLUME"
              ? `${krxFallbackReason ? `KRX fallback: ${krxFallbackReason} · ` : ""}KIS 평균거래량 상위 후보군을 조회 거래일 현재 거래량순으로 재정렬했습니다.`
              : `${krxFallbackReason ? `KRX fallback: ${krxFallbackReason} · ` : ""}KIS KRX 조회 거래일 데이터입니다. 거래량·거래대금은 거래일마다 새로 시작하며, 거래량 증감률은 조회 거래일과 전 거래일 전체를 비교합니다.`,
        items: dailyItems
          .slice(0, 100)
          .map((item, index) => ({
            ...item,
            rank: String(index + 1),
            instrumentId: `KRX:${item.symbol}`,
          })),
      };
    } catch (error) {
      return {
        schemaVersion: 1,
        market,
        sort,
        state: "ERROR",
        items: [],
        source: market === "KRX" && krxFallbackReason !== null ? "KRX_OPENAPI" : "KIS_REST",
        fetchedAt: null,
        statusMessage:
          error instanceof Error
            ? `${krxFallbackReason ? `KRX fallback: ${krxFallbackReason} · ` : ""}KIS 거래 순위를 불러오지 못했습니다: ${error.message}`
            : "KIS 거래 순위를 불러오지 못했습니다.",
      };
    }
  }

  public async searchDomesticInstruments(
    rawQuery: unknown,
  ): Promise<DesktopInstrumentSearchProjection> {
    if (
      typeof rawQuery !== "string" ||
      !isSearchableDomesticInstrumentQuery(rawQuery)
    ) {
      throw new TypeError("Expected a domestic instrument search query");
    }
    const query = rawQuery.trim();
    try {
      const result = await this.#instrumentMaster.search(query, 20);
      return {
        schemaVersion: 1,
        query,
        state: "READY",
        items: result.items,
        source: result.source,
        stale: result.stale,
        fetchedAt: result.fetchedAt,
        statusMessage:
          result.items.length === 0
            ? `"${query}"에 일치하는 KOSPI·KOSDAQ 종목이 없습니다.`
            : `${result.items.length}개 종목 · ${
                result.stale ? "마지막 KIS 종목 마스터" : "KIS 종목 마스터"
              }`,
      };
    } catch {
      return {
        schemaVersion: 1,
        query,
        state: "ERROR",
        items: [],
        source: "CACHED_KIS_MASTER",
        stale: true,
        fetchedAt: null,
        statusMessage:
          "KIS 종목 마스터를 내려받지 못했습니다. 네트워크 연결을 확인해주세요.",
      };
    }
  }

  public async searchUsInstruments(
    rawQuery: unknown,
  ): Promise<DesktopInstrumentSearchProjection> {
    if (typeof rawQuery !== "string" || !isSearchableUsInstrumentQuery(rawQuery)) {
      throw new TypeError("Expected a US instrument search query");
    }
    const query = rawQuery.trim();
    try {
      const result = await this.#usInstrumentMaster.search(query, 20);
      return {
        schemaVersion: 1,
        query,
        state: "READY",
        items: result.items,
        source: result.source,
        stale: result.stale,
        fetchedAt: result.fetchedAt,
        statusMessage: result.items.length === 0
          ? `"${query}"에 일치하는 미국 종목이 없습니다.`
          : `${result.items.length}개 미국 종목 · ${result.stale ? "마지막 KIS 해외 마스터" : "KIS 해외 마스터"}`,
      };
    } catch {
      return {
        schemaVersion: 1,
        query,
        state: "ERROR",
        items: [],
        source: "CACHED_KIS_MASTER",
        stale: true,
        fetchedAt: null,
        statusMessage: "KIS 미국 종목 마스터를 내려받지 못했습니다.",
      };
    }
  }

  public getMarketContext(
    forceRefresh = false,
  ): Promise<DesktopMarketContextProjection> {
    if (
      !forceRefresh &&
      this.#marketContextCache !== null &&
      Date.now() - this.#marketContextCache.at < MARKET_CONTEXT_CACHE_TTL_MS
    ) {
      return Promise.resolve(this.#marketContextCache.projection);
    }
    if (this.#marketContextRequest !== null) {
      return this.#marketContextRequest;
    }
    const request = this.#loadMarketContext().finally(() => {
      if (this.#marketContextRequest === request) {
        this.#marketContextRequest = null;
      }
    });
    this.#marketContextRequest = request;
    return request;
  }

  public async getMarketCalendar(
    forceRefresh = false,
  ): Promise<DesktopMarketCalendarProjection> {
    if (
      !forceRefresh &&
      this.#marketCalendarCache !== null &&
      Date.now() - this.#marketCalendarCache.at < MARKET_CALENDAR_CACHE_TTL_MS
    ) {
      return this.#marketCalendarCache.projection;
    }
    const year = new Date().getUTCFullYear();
    let events = this.#marketCalendar.listRange({
      dateFrom: `${year}-01-01`,
      dateTo: `${year}-12-31`,
      limit: 1_000,
    });
    const providerSources: DesktopMarketCalendarSourceProjection[] = [];
    if (this.#calendarFetch !== null) {
      const providerResults = await this.#ingestMarketCalendarProviders(year);
      providerSources.push(...providerResults);
      events = this.#marketCalendar.listRange({
        dateFrom: `${year}-01-01`,
        dateTo: `${year}-12-31`,
        limit: 1_000,
      });
    }
    const providerMessage =
      providerSources.length > 0
        ? providerSources.map((source) => source.message).join(" · ")
        : "SQLite 캘린더 projection";
    const projection =
      events.length > 0
        ? {
            schemaVersion: 1,
            state: "READY",
            source: "PROVIDER",
            fetchedAt: new Date().toISOString(),
            statusMessage: `${providerMessage} · ${events.length}개 이벤트`,
            sources: providerSources,
            events,
          } satisfies DesktopMarketCalendarProjection
        : fixtureMarketCalendarProjection();
    this.#marketCalendarCache = { projection, at: Date.now() };
    return projection;
  }

  async #ingestMarketCalendarProviders(year: number): Promise<
    readonly DesktopMarketCalendarSourceProjection[]
  > {
    const sources: DesktopMarketCalendarSourceProjection[] = [];
    const providers = [
      ["US_FEDERAL_RESERVE", "Federal Reserve FOMC", new FederalReserveFomcCalendarClient({
        fetch: this.#calendarFetch!,
      })] as const,
      ["US_BLS", "BLS", new BlsReleaseCalendarClient({ fetch: this.#calendarFetch! })] as const,
      ["US_BEA", "BEA", new BeaReleaseScheduleClient({ fetch: this.#calendarFetch! })] as const,
    ];
    for (const [provider, label, client] of providers) {
      try {
        const events = await client.getEvents();
        let inserted = 0;
        for (const event of events) {
          inserted += this.#marketCalendar.ingest(event) ? 1 : 0;
        }
        sources.push({
          provider,
          state: "READY",
          itemCount: events.length,
          insertedCount: inserted,
          dataQuality: "OFFICIAL",
          fetchedAt: new Date().toISOString(),
          message: `${label} ${events.length}개 수신/${inserted}개 신규`,
        });
      } catch (error) {
        sources.push({
          provider,
          state: "ERROR",
          itemCount: 0,
          insertedCount: 0,
          dataQuality: null,
          fetchedAt: null,
          message:
            error instanceof Error
              ? `${label} 실패(${error.message})`
              : `${label} 실패`,
        });
      }
    }
    try {
      const client = new KindListingScheduleClient({
        fetch: this.#calendarFetch!,
      });
      const events = await client.getEvents({
        fromDate: `${year}-01-01`,
        toDate: `${year}-12-31`,
      });
      let inserted = 0;
      for (const event of events) {
        inserted += this.#marketCalendar.ingest(event) ? 1 : 0;
      }
      sources.push({
        provider: "KIND_KRX",
        state: "READY",
        itemCount: events.length,
        insertedCount: inserted,
        dataQuality: "REGULATOR_EXCHANGE",
        fetchedAt: new Date().toISOString(),
        message: `KIND 상장일정 ${events.length}개 수신/${inserted}개 신규`,
      });
    } catch (error) {
      sources.push({
        provider: "KIND_KRX",
        state: "ERROR",
        itemCount: 0,
        insertedCount: 0,
        dataQuality: "REGULATOR_EXCHANGE",
        fetchedAt: null,
        message:
          error instanceof Error
            ? `KIND 상장일정 실패(${error.message})`
            : "KIND 상장일정 실패",
      });
    }
    try {
      const config = loadRuntimeConfig();
      const credentials = requirePublicDataPortalCredentials(config);
      const client = new KsdRightsScheduleClient({
        credentials,
        fetch: this.#calendarFetch!,
      });
      const events = await client.getEvents();
      let inserted = 0;
      for (const event of events) {
        inserted += this.#marketCalendar.ingest(event) ? 1 : 0;
      }
      sources.push({
        provider: "KSD_RIGHTS_SCHEDULE",
        state: "READY",
        itemCount: events.length,
        insertedCount: inserted,
        dataQuality: "DELAYED",
        fetchedAt: new Date().toISOString(),
        message: `예탁원 권리일정 ${events.length}개 수신/${inserted}개 신규`,
      });
    } catch (error) {
      const unconfigured =
        error instanceof Error &&
        error.message === "PUBLIC_DATA_PORTAL_PROVIDER_UNCONFIGURED";
      sources.push({
        provider: "KSD_RIGHTS_SCHEDULE",
        state: unconfigured ? "UNCONFIGURED" : "ERROR",
        itemCount: 0,
        insertedCount: 0,
        dataQuality: "DELAYED",
        fetchedAt: null,
        message: unconfigured ? "예탁원 권리일정 미설정" : "예탁원 권리일정 실패",
      });
    }
    try {
      const config = loadRuntimeConfig();
      const credentials = requireOpenDartCredentials(config);
      const client = new OpenDartClient({
        credentials,
        fetchImplementation: this.#calendarFetch!,
      });
      const providerDate = koreanCalendarDate();
      const page = await client.listFilings({
        beginDate: providerDate,
        endDate: providerDate,
      });
      const byCorpCode = new Map<string, string | null>();
      for (const filing of page.items) {
        byCorpCode.set(filing.corpCode, filing.stockCode);
      }
      const events = openDartFilingsToCalendarEvents({
        filings: page.items,
        stockCodeByCorpCode: byCorpCode,
        obtainedAt: page.obtainedAt,
      });
      let inserted = 0;
      for (const event of events) {
        inserted += this.#marketCalendar.ingest(event) ? 1 : 0;
      }
      sources.push({
        provider: "OPEN_DART",
        state: "READY",
        itemCount: events.length,
        insertedCount: inserted,
        dataQuality: "ISSUER_PRIMARY",
        fetchedAt: new Date().toISOString(),
        message: `OpenDART ${events.length}개 수신/${inserted}개 신규`,
      });
    } catch (error) {
      const unconfigured =
        error instanceof Error && error.message === "DART_PROVIDER_UNCONFIGURED";
      sources.push({
        provider: "OPEN_DART",
        state: unconfigured ? "UNCONFIGURED" : "ERROR",
        itemCount: 0,
        insertedCount: 0,
        dataQuality: "ISSUER_PRIMARY",
        fetchedAt: null,
        message: unconfigured ? "OpenDART 미설정" : "OpenDART 실패",
      });
    }
    return sources;
  }

  async #loadMarketContext(): Promise<DesktopMarketContextProjection> {
    const config = loadRuntimeConfig();
    const snapshots = new Map<string, KisMarketContextSnapshot>();
    const failed = new Set<string>();
    try {
      assertLiveReadOnlyAcknowledgement(config);
      const environment = readOnlyMarketDataEnvironment(config);
      const credentials = requireKisCredentialsForEnvironment(
        config,
        environment,
      );
      const auth = this.#authClient(environment, credentials);
      const client = new KisMarketContextClient({
        environment,
        credentials,
        getAccessToken: () => auth.getAccessToken(),
      });

      const requests: Array<() => Promise<KisMarketContextSnapshot>> = [
        ...KIS_DOMESTIC_INDEX_SELECTIONS.map(
          (selection) => () => client.getDomesticIndex(selection),
        ),
        ...KIS_US_MARKET_PROXY_SELECTIONS.map(
          (selection) => () => client.getUsMarketProxy(selection),
        ),
      ];
      const instrumentIds = [
        ...KIS_DOMESTIC_INDEX_SELECTIONS.map(
          (selection) => selection.instrumentId,
        ),
        ...KIS_US_MARKET_PROXY_SELECTIONS.map(
          (selection) => selection.instrumentId,
        ),
      ];
      for (let index = 0; index < requests.length; index += 1) {
        if (index > 0) await waitForMarketContextQuota();
        try {
          const snapshot = await requests[index]!();
          snapshots.set(snapshot.instrumentId, snapshot);
        } catch {
          failed.add(instrumentIds[index]!);
        }
      }
    } catch {
      for (const descriptor of MARKET_CONTEXT_DESCRIPTORS) {
        failed.add(descriptor.instrumentId);
      }
    }

    const actualItems = MARKET_CONTEXT_DESCRIPTORS.map((descriptor) => {
      const snapshot = snapshots.get(descriptor.instrumentId);
      return snapshot
        ? marketContextItemFromSnapshot(snapshot)
        : failedMarketContextItem(descriptor);
    });
    const successfulCount = actualItems.filter(
      (item) => item.freshness !== "UNAVAILABLE",
    ).length;
    const fetchedAt = new Date().toISOString();
    const projection: DesktopMarketContextProjection = {
      schemaVersion: 1,
      state:
        successfulCount === actualItems.length
          ? "PARTIAL"
          : successfulCount > 0
            ? "PARTIAL"
            : "ERROR",
      items: [...actualItems, ...unavailableMarketContextItems()],
      fetchedAt,
      statusMessage:
        successfulCount === actualItems.length
          ? "KIS 지수·ETF 스냅샷 준비 · 실제 선물은 권한/월물 연결 전"
          : successfulCount > 0
            ? `KIS 시장 스냅샷 ${successfulCount}/${actualItems.length}개 준비 · 일부 공급자 응답 없음`
            : "KIS 시장 스냅샷을 받지 못했습니다. 키·승인·네트워크를 확인하세요.",
    };
    this.#marketContextCache = { projection, at: Date.now() };
    return projection;
  }

  public getInformationFeed(
    forceRefresh = false,
  ): Promise<DesktopInformationFeedProjection> {
    if (
      !forceRefresh &&
      this.#informationCache !== null &&
      Date.now() - this.#informationCache.at < INFORMATION_CACHE_TTL_MS
    ) {
      return Promise.resolve(this.#informationCache.projection);
    }
    this.#informationRequest ??= this.#loadInformationFeed().finally(() => {
      this.#informationRequest = null;
    });
    return this.#informationRequest;
  }

  async #loadInformationFeed(): Promise<DesktopInformationFeedProjection> {
    const config = loadRuntimeConfig();
    const sources: DesktopInformationFeedProjection["sources"][number][] = [];
    const transientItems: DesktopInformationItemProjection[] = [];
    const jobs: Promise<void>[] = [];

    if (this.#usExchange !== null) {
      try {
        const client = new FinnhubNewsClient({ apiKey: requireFinnhubApiKey(config) });
        jobs.push(
          client.getCompanyNews(this.#market.symbol).then((news) => {
            const obtainedAt = new Date().toISOString();
            for (const item of news) {
              transientItems.push({
                id: stableLocalId("finnhub-news", [item.providerItemId]),
                provider: "FINNHUB_NEWS",
                kind: "NEWS",
                titleOriginal: item.title,
                titleKorean: null,
                summaryKorean: item.summary,
                sourceName: item.sourceName,
                sourceLanguage: "en",
                publishedAt: item.publishedAt,
                publishedAtPrecision: "SECOND",
                obtainedAt,
                canonicalUrl: item.canonicalUrl,
                rights: "PROVIDER_LINK_SUMMARY",
                relatedInstrumentIds: [this.#market.instrumentId],
              });
            }
            sources.push({
              provider: "FINNHUB_NEWS",
              state: "READY",
              itemCount: news.length,
              message: `Finnhub ${this.#market.symbol} 뉴스 ${news.length}건`,
            });
          }).catch(() => {
            sources.push({ provider: "FINNHUB_NEWS", state: "ERROR", itemCount: 0, message: "Finnhub 뉴스 조회 실패" });
          }),
        );
      } catch {
        sources.push({ provider: "FINNHUB_NEWS", state: "UNCONFIGURED", itemCount: 0, message: "Finnhub 키 미설정" });
      }
    }

    try {
      assertLiveReadOnlyAcknowledgement(config);
      const credentials = requireKisCredentialsForEnvironment(config, "prod");
      const auth = this.#authClient("prod", credentials);
      const client = new KisProdNewsClient({
        credentials,
        getAccessToken: () => auth.getAccessToken(),
      });
      jobs.push(
        client
          .getDomesticHeadlines()
          .then((page) => {
            let inserted = 0;
            for (const headline of page.items) {
              const publishedAt = kisHeadlineInstant(
                headline.providerDate,
                headline.providerTime,
              );
              if (publishedAt === null) continue;
              const providerItemId = [
                headline.providerCode,
                headline.providerDate,
                headline.providerTime,
                headline.providerKey,
              ].join(":");
              const hash = payloadHash(headline);
              inserted += this.#information.ingest({
                id: stableLocalId("kis-domestic-news", [providerItemId]),
                provider: "KIS_DOMESTIC_NEWS",
                providerItemId,
                kind: "NEWS",
                titleOriginal: headline.title,
                sourceName: headline.sourceName ?? "KIS 국내뉴스",
                sourceLanguage: "ko",
                publishedAt,
                publishedAtPrecision: "SECOND",
                obtainedAt: page.fetchedAt,
                rights: "KIS_HEADLINE_ONLY",
                relatedInstrumentIds: headline.relatedSymbols.map(
                  (symbol) => `KRX:${symbol}`,
                ),
                payloadHash: hash,
              })
                ? 1
                : 0;
            }
            sources.push({
              provider: "KIS_DOMESTIC_NEWS",
              state: "READY",
              itemCount: page.items.length,
              message: `${page.items.length}개 실제 KIS 국내 뉴스 제목 수신`,
            });
            if (inserted > 0) {
              this.#information.saveCheckpoint(
                "KIS_DOMESTIC_NEWS",
                { fetchedAt: page.fetchedAt },
                page.fetchedAt,
              );
            }
          })
          .catch(() => {
            sources.push({
              provider: "KIS_DOMESTIC_NEWS",
              state: "ERROR",
              itemCount: 0,
              message: "KIS 국내 뉴스 수신 실패",
            });
          }),
      );
      jobs.push(
        Promise.all([
          client.getOverseasHeadlines({
            nationCode: "US",
            symbol: this.#usExchange === null ? config.KIS_US_SYMBOL : this.#symbol,
          }),
          client.getOverseasHeadlines({ nationCode: "US" }),
        ])
          .then((pages) => {
            const selectedUsSymbol =
              this.#usExchange === null ? config.KIS_US_SYMBOL : this.#symbol;
            const fetchedAt = pages
              .map((page) => page.fetchedAt)
              .sort()
              .at(-1) ?? new Date().toISOString();
            const headlines = new Map(
              pages
                .flatMap((page) => page.items)
                .map((headline) => [
                  `${headline.providerDate}:${headline.providerTime}:${headline.providerKey}`,
                  headline,
                ]),
            );
            for (const headline of headlines.values()) {
              const publishedAt = kisHeadlineInstant(
                headline.providerDate,
                headline.providerTime,
              );
              if (publishedAt === null) continue;
              const providerItemId = [
                headline.providerDate,
                headline.providerTime,
                headline.providerKey,
              ].join(":");
              this.#information.ingest({
                id: stableLocalId("kis-overseas-news", [providerItemId]),
                provider: "KIS_OVERSEAS_NEWS",
                providerItemId,
                kind: "NEWS",
                titleOriginal: headline.title,
                sourceName: headline.sourceName ?? "KIS 해외뉴스",
                sourceLanguage: containsHangul(headline.title) ? "ko" : "en",
                publishedAt,
                publishedAtPrecision: "SECOND",
                obtainedAt: fetchedAt,
                rights: "KIS_HEADLINE_ONLY",
                relatedInstrumentIds:
                  headline.symbol === null
                    ? []
                    : headline.symbol === selectedUsSymbol && this.#usExchange !== null
                      ? [this.#market.instrumentId]
                    : [
                        `${headline.exchangeCode === "NAS" ? "NASDAQ" : headline.exchangeCode === "NYS" ? "NYSE" : headline.exchangeCode === "AMS" ? "AMEX" : (headline.exchangeCode ?? "US")}:${headline.symbol}`,
                      ],
                payloadHash: payloadHash(headline),
              });
            }
            sources.push({
              provider: "KIS_OVERSEAS_NEWS",
              state: "READY",
              itemCount: headlines.size,
              message: `${headlines.size}개 실제 KIS 미국 종목·시장 뉴스 제목 수신`,
            });
            this.#information.saveCheckpoint(
              "KIS_OVERSEAS_NEWS",
              { fetchedAt },
              fetchedAt,
            );
          })
          .catch(() => {
            sources.push({
              provider: "KIS_OVERSEAS_NEWS",
              state: "ERROR",
              itemCount: 0,
              message: "KIS 미국 뉴스 수신 실패",
            });
          }),
      );
    } catch {
      sources.push(
        {
          provider: "KIS_DOMESTIC_NEWS",
          state: "UNCONFIGURED",
          itemCount: 0,
          message: "KIS 실전 데이터 키가 필요합니다.",
        },
        {
          provider: "KIS_OVERSEAS_NEWS",
          state: "UNCONFIGURED",
          itemCount: 0,
          message: "KIS 실전 데이터 키가 필요합니다.",
        },
      );
    }

    try {
      const identity = requireSecRequestIdentity(config);
      jobs.push(
        (async () => {
          try {
            const client = new SecEdgarClient({ identity });
            const mappings = await client.listTickerMappings();
            const issuer = findSecIssuerMappings(
              mappings,
              this.#usExchange === null ? config.KIS_US_SYMBOL : this.#symbol,
            )[0];
            if (issuer === undefined) {
              throw new Error("SEC_TICKER_MAPPING_NOT_FOUND");
            }
            const snapshot = await client.getRecentFilings(
              issuer.providerIssuerId,
            );
            const filingsToPersist = snapshot.items.slice(0, 100);
            for (const filing of filingsToPersist) {
              const itemId = stableLocalId("sec-filing", [
                filing.providerFilingId,
              ]);
              const hash = payloadHash(filing);
              this.#information.ingest({
                id: itemId,
                provider: "SEC_EDGAR",
                providerItemId: filing.providerFilingId,
                kind: "DISCLOSURE",
                titleOriginal: `${filing.formType} · ${filing.issuerName}`,
                sourceName: "SEC EDGAR",
                sourceLanguage: "en",
                publishedAt: filing.acceptedAt,
                publishedAtPrecision: "SECOND",
                obtainedAt: snapshot.obtainedAt,
                canonicalUrl: filing.filingIndexUrl,
                rights: "PUBLIC_FILING",
                relatedInstrumentIds: snapshot.tickers.map(
                  (ticker, index) =>
                    this.#usExchange !== null && ticker === this.#symbol
                      ? this.#market.instrumentId
                      : `${snapshot.exchanges[index] ?? "US"}:${ticker}`,
                ),
                payloadHash: hash,
              });
              this.#information.addTranslation({
                id: stableLocalId("sec-form-ko", [
                  filing.providerFilingId,
                  hash,
                ]),
                informationItemId: itemId,
                locale: "ko-KR",
                inputHash: hash,
                translatedTitle: `${secFormKoreanLabel(filing.formType)} · ${filing.issuerName}`,
                translatedSummary:
                  filing.itemNumbers.length === 0
                    ? undefined
                    : `SEC 항목 ${filing.itemNumbers.join(", ")}`,
                translationProvider: "BUILTIN_SEC_FORM_LABELS",
                modelVersion: "v1",
                status: "PARTIAL",
                generatedAt: snapshot.obtainedAt,
              });
            }
            sources.push({
              provider: "SEC_EDGAR",
              state: "READY",
              itemCount: filingsToPersist.length,
              message: `${snapshot.issuerName} SEC 공시 ${filingsToPersist.length}건 로컬 projection`,
            });
            this.#information.saveCheckpoint(
              "SEC_EDGAR",
              {
                cik: snapshot.providerIssuerId,
                fetchedAt: snapshot.obtainedAt,
              },
              snapshot.obtainedAt,
            );
          } catch {
            sources.push({
              provider: "SEC_EDGAR",
              state: "ERROR",
              itemCount: 0,
              message: "SEC EDGAR 공시 수신 실패",
            });
          }
        })(),
      );
    } catch {
      sources.push({
        provider: "SEC_EDGAR",
        state: "UNCONFIGURED",
        itemCount: 0,
        message: "SEC_USER_AGENT 설정이 필요합니다.",
      });
    }

    try {
      const credentials = requireOpenDartCredentials(config);
      jobs.push(
        (async () => {
          const client = new OpenDartClient({ credentials });
          const providerDate = koreanCalendarDate();
          const nowMs = Date.now();
          const fullSync =
            this.#openDartLastFullSyncDate !== providerDate ||
            nowMs - this.#openDartLastFullSyncAt >= 15 * 60_000;
          const page = fullSync
            ? await client.listAllFilings({
                beginDate: providerDate,
                endDate: providerDate,
              })
            : await client.listFilings({
                beginDate: providerDate,
                endDate: providerDate,
              });

          if (this.#openDartCorpCodes?.date !== providerDate) {
            try {
              const corpCodes = await client.listCorpCodes();
              this.#openDartCorpCodes = {
                date: providerDate,
                byCorpCode: new Map(
                  corpCodes.map((corp) => [corp.corpCode, corp] as const),
                ),
              };
            } catch {
              // list.json의 stock_code를 우선 사용하며 기업코드 원장은 보조 매핑이다.
            }
          }

          for (const filing of page.items) {
              const providerItemId = filing.providerFilingId;
              const stockCode =
                filing.stockCode ??
                this.#openDartCorpCodes?.byCorpCode.get(filing.corpCode)
                  ?.stockCode ??
                null;
              this.#information.ingest({
                id: stableLocalId("open-dart-filing", [providerItemId]),
                provider: "OPEN_DART",
                providerItemId,
                kind: "DISCLOSURE",
                titleOriginal: `${filing.reportName} · ${filing.corpName}`,
                sourceName: "OpenDART",
                sourceLanguage: "ko",
                publishedAt: openDartDateInstant(
                  filing.providerFiledDate,
                ),
                publishedAtPrecision: "DATE",
                obtainedAt: page.obtainedAt,
                canonicalUrl: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${providerItemId}`,
                rights: "PUBLIC_FILING",
                relatedInstrumentIds:
                  stockCode === null ? [] : [`KRX:${stockCode}`],
                payloadHash: payloadHash(filing),
              });
          }
          if (fullSync) {
            this.#openDartLastFullSyncDate = providerDate;
            this.#openDartLastFullSyncAt = nowMs;
          }
          const pagesFetched = "pagesFetched" in page ? page.pagesFetched : 1;
          const paginationComplete =
            "paginationComplete" in page ? page.paginationComplete : false;
          sources.push({
            provider: "OPEN_DART",
            state: "READY",
            itemCount: page.items.length,
            message: fullSync
              ? `오늘 OpenDART 공시 ${page.items.length}건 전체 동기화`
              : `오늘 OpenDART 최신 공시 ${page.items.length}건 확인`,
          });
          this.#information.saveCheckpoint(
            "OPEN_DART",
            {
              providerDate,
              pagesFetched,
              totalPages: page.totalPages,
              totalCount: page.totalCount,
              paginationComplete,
              fullReconciledAt: fullSync ? page.obtainedAt : undefined,
            },
            page.obtainedAt,
          );
        })().catch(() => {
            sources.push({
              provider: "OPEN_DART",
              state: "ERROR",
              itemCount: 0,
              message: "OpenDART 공시 수신 실패",
            });
          }),
      );
    } catch {
      sources.push({
        provider: "OPEN_DART",
        state: "UNCONFIGURED",
        itemCount: 0,
        message: "OpenDART 키 발급 대기 중",
      });
    }
    await Promise.all(jobs);

    const usInformationMode = this.#usExchange !== null;
    const visibleProviders = new Set(
      usInformationMode
        ? ["KIS_OVERSEAS_NEWS", "FINNHUB_NEWS", "SEC_EDGAR"]
        : ["KIS_DOMESTIC_NEWS", "OPEN_DART"],
    );
    const storedItems: DesktopInformationItemProjection[] = this.#information.listRecent({ limit: 400 })
      .filter((item) => visibleProviders.has(item.provider))
      .slice(0, 200)
      .map((item) => ({
      id: item.id,
      provider: item.provider,
      kind: item.kind,
      titleOriginal: item.titleOriginal,
      titleKorean:
        item.translatedTitle ??
        (item.sourceLanguage === "ko" ? item.titleOriginal : null),
      summaryKorean: item.translatedSummary,
      sourceName: item.sourceName,
      sourceLanguage: item.sourceLanguage,
      publishedAt: item.publishedAt,
      publishedAtPrecision: item.publishedAtPrecision,
      obtainedAt: item.obtainedAt,
      canonicalUrl: item.canonicalUrl,
      rights: item.rights,
      relatedInstrumentIds: item.relatedInstrumentIds,
      }));
    const items = [...transientItems, ...storedItems]
      .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt))
      .slice(0, 200);
    const visibleSources = sources.filter((source) =>
      visibleProviders.has(source.provider),
    );
    const readyCount = visibleSources.filter((source) => source.state === "READY").length;
    const errorCount = visibleSources.filter((source) => source.state === "ERROR").length;
    const now = new Date().toISOString();
    const projection: DesktopInformationFeedProjection = {
      schemaVersion: 1,
      state:
        readyCount === 0
          ? errorCount > 0
            ? "ERROR"
            : "PARTIAL"
          : errorCount > 0
            ? "PARTIAL"
            : "READY",
      items,
      sources: visibleSources,
      fetchedAt: now,
      statusMessage: `${usInformationMode ? "미국" : "국내"} ${readyCount}개 provider 연결 · 표시 ${items.length}건`,
    };
    this.#informationCache = { projection, at: Date.now() };
    return projection;
  }

  public getChartHistory(
    rawInterval: unknown,
    rawRange: unknown,
  ): Promise<DesktopChartProjection> {
    const interval = validateChartInterval(rawInterval);
    const range = validateChartRange(rawRange, interval);
    const symbol = this.#symbol;
    const requestKey = `${symbol}:${interval}:${range}`;
    const pending = this.#chartRequests.get(requestKey);
    if (pending !== undefined) return pending;
    const request = this.#loadChartHistory(interval, range, symbol).finally(
      () => {
        this.#chartRequests.delete(requestKey);
      },
    );
    this.#chartRequests.set(requestKey, request);
    return request;
  }

  async #loadChartHistory(
    interval: DesktopChartInterval,
    range: DesktopChartRange,
    symbol: string,
  ): Promise<DesktopChartProjection> {
    const requestKey = `${symbol}:${interval}:${range}`;
    const config = loadRuntimeConfig();
    const usExchange = this.#usExchange;
    const dataEnvironment = usExchange === null ? readOnlyMarketDataEnvironment(config) : "prod";
    let credentials;
    try {
      credentials = requireKisCredentialsForEnvironment(
        config,
        dataEnvironment,
      );
    } catch {
      return this.#setChart({
        ...initialChart(symbol),
        interval,
        range,
        statusMessage: "KIS 데이터 키가 없어 차트를 조회할 수 없습니다.",
      });
    }
    try {
      assertLiveReadOnlyAcknowledgement(config);
    } catch {
      return this.#setChart({
        ...initialChart(symbol),
        interval,
        range,
        statusMessage:
          "KIS_LIVE_ACK=READ_ONLY_MARKET_DATA 설정 후 실차트 조회가 가능합니다.",
      });
    }

    const cached = this.#chartCache.get(requestKey);
    const isIntraday = isIntradayChartInterval(interval);
    const cacheTtl = desktopChartCacheTtlMs(
      interval,
      cached?.candles.some((candle) => candle.forming === true) ?? false,
    );
    if (
      cached?.fetchedAt !== null &&
      cached?.fetchedAt !== undefined &&
      Date.now() - Date.parse(cached.fetchedAt) <= cacheTtl
    ) {
      return this.#setChart({
        ...cached,
        statusMessage: `${cached.statusMessage} · local cache`,
      });
    }

    this.#setChart(
      cached === undefined
        ? {
            schemaVersion: 1,
            instrumentId: `${usExchange === "NAS" ? "NASDAQ" : usExchange === "NYS" ? "NYSE" : usExchange === "AMS" ? "AMEX" : "KRX"}:${symbol}`,
            interval,
            range,
            state: "LOADING",
            candles: [],
            source:
              interval === "1m" || interval === "1d"
                ? "KIS_REST"
                : "KIS_REST_AGGREGATED",
            turnoverQuality:
              isIntraday ? "UNAVAILABLE" : "PROVIDER_REPORTED",
            paginationComplete: false,
            fetchedAt: null,
            statusMessage: `KIS ${interval} 차트 조회 중`,
          }
        : {
            ...cached,
            statusMessage: `${cached.statusMessage} · 캐시 표시 후 갱신 중`,
          },
    );

    try {
      const auth = this.#authClient(dataEnvironment, credentials);
      if (usExchange !== null) {
        if (!isIntraday) {
          return this.#setChart({
            ...initialChart(symbol), instrumentId: `${usExchange === "NAS" ? "NASDAQ" : usExchange === "NYS" ? "NYSE" : "AMEX"}:${symbol}`,
            interval, range, state: "DISABLED", source: "KIS_REST",
            statusMessage: "미국 장기 일봉은 다음 연결 대상입니다. 분봉 차트는 조회할 수 있습니다.",
          });
        }
        const minutes = interval === "4h" ? 240 : Number(interval.slice(0, -1));
        const history = await new KisUsChartClient({ credentials, getAccessToken: () => auth.getAccessToken() })
          .getIntradayCandles({ exchange: usExchange, symbol, intervalMinutes: minutes });
        const venue = usExchange === "NAS" ? "NASDAQ" : usExchange === "NYS" ? "NYSE" : "AMEX";
        const ready: DesktopChartProjection = {
          schemaVersion: 1, instrumentId: `${venue}:${symbol}`, interval, range, state: "READY",
          candles: history.candles.map((candle) => ({ id: `${venue}:${symbol}:${interval}:${candle.openedAt}`, ...candle, forming: false })),
          source: interval === "1m" ? "KIS_REST" : "KIS_REST_AGGREGATED",
          turnoverQuality: history.candles.every((candle) => candle.turnover !== null) ? "PROVIDER_REPORTED" : "UNAVAILABLE",
          paginationComplete: history.complete, fetchedAt: history.fetchedAt,
          statusMessage: `KIS 미국 ${interval} 차트 · ${history.candles.length}개${history.complete ? "" : " · 최근 120개"}`,
        };
        this.#chartCache.set(requestKey, ready);
        return this.#symbol === symbol ? this.#setChart(ready) : ready;
      }
      const chart = new KisDomesticChartClient({
        environment: dataEnvironment,
        credentials,
        getAccessToken: () => auth.getAccessToken(),
        beforeRequest: () => this.#limitChartRequest(),
      });
      let ready: DesktopChartProjection;
      if (isIntraday) {
        const history = await chart.getDomesticMinuteCandles({
          symbol,
          beforeOrAt: resolveDesktopIntradayCursor(),
          maxPages: 24,
        });
        ready =
          interval === "1m"
            ? toDesktopChartProjection(history, range)
            : toDesktopAggregatedChartProjection(
                aggregateDomesticCandleHistory(
                  history,
                  interval as "5m" | "15m" | "30m" | "60m" | "4h",
                ),
                history.pagination.complete,
                range,
              );
      } else {
        const window = resolveDesktopChartRange(
          range as Exclude<DesktopChartRange, "1D">,
        );
        const history = await chart.getDomesticDailyCandles({
          symbol,
          startDate: window.startDate,
          endDate: window.endDate,
          adjusted: true,
          maxPages: window.maxPages,
        });
        ready =
          interval === "1d"
            ? toDesktopChartProjection(history, range)
            : toDesktopAggregatedChartProjection(
                aggregateDomesticCandleHistory(history, "1w"),
                history.pagination.complete,
                range,
              );
      }
      this.#chartCache.set(requestKey, ready);
      return this.#symbol === symbol ? this.#setChart(ready) : ready;
    } catch (error) {
      const failedVenue = usExchange === "NAS" ? "NASDAQ" : usExchange === "NYS" ? "NYSE" : usExchange === "AMS" ? "AMEX" : "KRX";
      const failed: DesktopChartProjection = {
        schemaVersion: 1,
        instrumentId: `${failedVenue}:${symbol}`,
        interval,
        range,
        state: "ERROR",
        candles: [],
        source:
          interval === "1m" || interval === "1d"
            ? "KIS_REST"
            : "KIS_REST_AGGREGATED",
        turnoverQuality:
          isIntraday ? "UNAVAILABLE" : "PROVIDER_REPORTED",
        paginationComplete: false,
        fetchedAt: null,
        statusMessage: safeChartStatusMessage(error),
      };
      return this.#symbol === symbol ? this.#setChart(failed) : failed;
    }
  }

  public connectMarketReadOnly(): Promise<DesktopMarketProjection> {
    if (this.#streams.size > 0) {
      return Promise.resolve(this.#market);
    }
    if (this.#connectRequest === null) {
      const symbol = this.#symbol;
      const generation = this.#marketConnectionGeneration;
      let trackedRequest: Promise<DesktopMarketProjection>;
      trackedRequest = this.#connectMarketReadOnly(symbol, generation).finally(
        () => {
          if (this.#connectRequest === trackedRequest) {
            this.#connectRequest = null;
          }
        },
      );
      this.#connectRequest = trackedRequest;
    }
    return this.#connectRequest;
  }

  public async selectInstrument(
    rawSymbol: unknown,
  ): Promise<DesktopMarketProjection> {
    if (typeof rawSymbol !== "string") throw new Error("Unsupported instrument symbol");
    const usMatch = /^(NAS|NYS|AMS):([A-Z0-9.-]{1,20})$/.exec(rawSymbol);
    if (usMatch === null && !/^[0-9A-Z]{6,7}$/.test(rawSymbol)) {
      throw new Error("Unsupported instrument symbol");
    }
    const symbol = usMatch?.[2] ?? rawSymbol;
    const usExchange = (usMatch?.[1] as "NAS" | "NYS" | "AMS" | undefined) ?? null;
    const selectionGeneration = this.#marketConnectionGeneration + 1;
    await this.disconnectMarket();
    if (this.#marketConnectionGeneration !== selectionGeneration) {
      return this.#market;
    }
    this.#symbol = symbol;
    this.#usExchange = usExchange;
    this.#informationCache = null;
    this.#marketSequence = 0n;
    this.#lastProcessedTradeIdentity = null;
    this.#lastOrderBookSnapshotWriteAt = 0;
    const usVenue = usExchange === "NAS" ? "NASDAQ" : usExchange === "NYS" ? "NYSE" : usExchange === "AMS" ? "AMEX" : null;
    this.#setMarket(usVenue === null ? initialMarket(symbol) : initialUsMarket(symbol, usVenue));
    this.#setChart(usVenue === null ? initialChart(symbol) : {
      ...initialChart(symbol),
      instrumentId: `${usVenue}:${symbol}`,
      statusMessage: "미국 차트 REST 연결 전 · 실시간 호가/체결을 먼저 표시합니다.",
    });
    return this.connectMarketReadOnly();
  }

  public async getWatchlistQuotes(
    rawSymbols: unknown,
  ): Promise<readonly import("../shared/desktop-contracts.js").DesktopWatchlistQuoteProjection[]> {
    if (
      !Array.isArray(rawSymbols) ||
      rawSymbols.length > 50 ||
      !rawSymbols.every(
        (symbol) => typeof symbol === "string" && /^[0-9A-Z]{6,7}$/.test(symbol),
      )
    ) {
      throw new Error("Unsupported watchlist symbols");
    }
    const symbols = [...new Set(rawSymbols as string[])];
    const config = loadRuntimeConfig();
    assertLiveReadOnlyAcknowledgement(config);
    const environment = readOnlyMarketDataEnvironment(config);
    const credentials = requireKisCredentialsForEnvironment(config, environment);
    const auth = this.#authClient(environment, credentials);
    const rest = new KisRestClient({
      environment,
      credentials,
      getAccessToken: () => auth.getAccessToken(),
    });
    const quotes = [];
    for (const symbol of symbols) {
      try {
        const quote = await rest.getDomesticCurrentPrice(symbol);
        quotes.push({
          instrumentId: quote.instrumentId,
          price: quote.price,
          changeRate: quote.changeRate,
          cumulativeTurnover: quote.cumulativeTurnover,
          receivedAt: quote.receivedAt,
        });
      } catch {
        // One unavailable symbol must not prevent the remaining watchlist snapshots.
      }
    }
    return quotes;
  }

  async #connectMarketReadOnly(
    symbol: string,
    generation: number,
  ): Promise<DesktopMarketProjection> {
    const isCurrentConnection = () =>
      this.#symbol === symbol &&
      this.#marketConnectionGeneration === generation;
    const config = loadRuntimeConfig();
    const usExchange = this.#usExchange;
    const dataEnvironment = usExchange === null ? readOnlyMarketDataEnvironment(config) : "prod";
    let credentials;
    try {
      credentials = requireKisCredentialsForEnvironment(
        config,
        dataEnvironment,
      );
    } catch {
      if (!isCurrentConnection()) return this.#market;
      return this.#setMarket({
        ...this.#market,
        connectionState: "DISABLED",
        statusMessage: "KIS 데이터 키가 없어 시세 연결이 비활성화됐습니다.",
      });
    }
    try {
      assertLiveReadOnlyAcknowledgement(config);
    } catch {
      if (!isCurrentConnection()) return this.#market;
      return this.#setMarket({
        ...this.#market,
        connectionState: "DISABLED",
        statusMessage:
          "KIS_LIVE_ACK=READ_ONLY_MARKET_DATA 설정 후 읽기 전용 연결이 가능합니다.",
      });
    }

    if (!isCurrentConnection()) return this.#market;
    this.#setMarket({
      ...this.#market,
      mode: "KIS_READ_ONLY",
      connectionState: "CONNECTING",
      statusMessage: "KIS 읽기 전용 시세 연결 중",
    });

    try {
      const auth = this.#authClient(dataEnvironment, credentials);
      if (usExchange !== null) {
        const rest = new KisRestClient({
          environment: "prod",
          credentials,
          getAccessToken: () => auth.getAccessToken(),
        });
        const [approvalKey, snapshot] = await Promise.all([
          auth.getApprovalKey(),
          rest.getOverseasQuoteAndOrderBook(usExchange, symbol),
        ]);
        if (!isCurrentConnection()) return this.#market;
        const venue = usExchange === "NAS" ? "NASDAQ" : usExchange === "NYS" ? "NYSE" : "AMEX";
        this.#marketSequence += 1n;
        this.#setMarket({
          ...this.#market,
          mode: "KIS_READ_ONLY",
          venue,
          currency: "USD",
          price: snapshot.price,
          openPrice: snapshot.openPrice,
          highPrice: snapshot.highPrice,
          lowPrice: snapshot.lowPrice,
          bids: snapshot.bids,
          asks: snapshot.asks,
          totalBidQuantity: snapshot.totalBidQuantity,
          totalAskQuantity: snapshot.totalAskQuantity,
          providerTime: snapshot.providerTime,
          receivedAt: snapshot.receivedAt,
          orderBookReceivedAt: snapshot.receivedAt,
          freshness: "stale",
          sequence: this.#marketSequence.toString(),
          statusMessage: snapshot.bids.length > 0 || snapshot.asks.length > 0
            ? "KIS 미국 REST 실제 1호가 · WebSocket 실시간 갱신 대기"
            : "KIS 미국 현재가 수신 · 공급자 호가 잔량 미수신 · WebSocket 갱신 대기",
        });
        const stream = new DomesticKisLiveStream({
          environment: "prod",
          approvalKey,
          symbol,
          venue,
          providerExchange: usExchange,
          onProjection: (projection) => {
            if (isCurrentConnection()) this.applyReadOnlyMarketProjection(projection);
          },
        });
        this.#streams.add(stream);
        await stream.start();
        if (!isCurrentConnection()) {
          this.#streams.delete(stream);
          await stream.stop();
        }
        return this.#market;
      }
      const rest = new KisRestClient({
        environment: dataEnvironment,
        credentials,
        getAccessToken: () => auth.getAccessToken(),
      });
      const [approvalKey, quote, orderBook] = await Promise.all([
        auth.getApprovalKey(),
        rest.getDomesticCurrentPrice(symbol),
        rest.getDomesticOrderBook(symbol),
      ]);
      if (!isCurrentConnection()) return this.#market;
      const hasRestOrderBook =
        orderBook.providerTime !== "000000" &&
        orderBook.bids.length + orderBook.asks.length > 0;
      if (hasRestOrderBook) {
        this.#marketSnapshots.saveDomesticOrderBook({
          instrumentId: orderBook.instrumentId,
          venue: orderBook.venue,
          bids: [...orderBook.bids],
          asks: [...orderBook.asks],
          totalBidQuantity: orderBook.totalBidQuantity,
          totalAskQuantity: orderBook.totalAskQuantity,
          providerTime: orderBook.providerTime,
          providerReceivedAt: orderBook.receivedAt,
        });
        this.#lastOrderBookSnapshotWriteAt = Date.now();
      }
      const restoredOrderBook = hasRestOrderBook
        ? null
        : this.#marketSnapshots.getDomesticOrderBook(`KRX:${symbol}`);
      const restoredNxtTrade = this.#marketSnapshots.getDomesticTrade(
        `KRX:${symbol}`,
        "NXT",
      );
      const restoredNxtBook = this.#marketSnapshots.getDomesticOrderBook(
        `KRX:${symbol}`,
        "NXT",
      );
      const useTodayNxtClose =
        restoredNxtTrade?.providerDate === koreanCalendarDate() &&
        restoredNxtTrade.providerTime >= "154000" &&
        restoredNxtBook !== null;
      const displayedBids = useTodayNxtClose
        ? restoredNxtBook.bids
        : hasRestOrderBook
        ? orderBook.bids
        : (restoredOrderBook?.bids ?? []);
      const displayedAsks = useTodayNxtClose
        ? restoredNxtBook.asks
        : hasRestOrderBook
        ? orderBook.asks
        : (restoredOrderBook?.asks ?? []);
      const displayedProviderTime = useTodayNxtClose
        ? restoredNxtBook.providerTime
        : hasRestOrderBook
        ? orderBook.providerTime
        : (restoredOrderBook?.providerTime ?? null);
      this.#marketSequence += 1n;
      this.#setMarket({
        ...this.#market,
        mode: "KIS_READ_ONLY",
        venue: useTodayNxtClose ? "NXT" : "KRX",
        price: useTodayNxtClose ? restoredNxtTrade.price : quote.price,
        change: useTodayNxtClose ? restoredNxtTrade.change : quote.change,
        changeRate: useTodayNxtClose
          ? restoredNxtTrade.changeRate
          : quote.changeRate,
        executionStrength: null,
        cumulativeVolume: quote.cumulativeVolume,
        cumulativeTurnover: quote.cumulativeTurnover,
        openPrice: quote.openPrice,
        highPrice: quote.highPrice,
        lowPrice: quote.lowPrice,
        bids: displayedBids,
        asks: displayedAsks,
        totalBidQuantity: useTodayNxtClose
          ? restoredNxtBook.totalBidQuantity
          : hasRestOrderBook
          ? orderBook.totalBidQuantity
          : (restoredOrderBook?.totalBidQuantity ?? null),
        totalAskQuantity: useTodayNxtClose
          ? restoredNxtBook.totalAskQuantity
          : hasRestOrderBook
          ? orderBook.totalAskQuantity
          : (restoredOrderBook?.totalAskQuantity ?? null),
        providerTime: displayedProviderTime,
        orderBookReceivedAt: useTodayNxtClose
          ? restoredNxtBook.providerReceivedAt
          : hasRestOrderBook
          ? orderBook.receivedAt
          : (restoredOrderBook?.providerReceivedAt ?? null),
        orderBookOccurredAt: null,
        session: domesticSessionFromProviderTime(displayedProviderTime ?? ""),
        freshness: "stale",
        receivedAt: quote.receivedAt,
        sequence: this.#marketSequence.toString(),
        statusMessage: useTodayNxtClose
          ? `SQLite NXT 최종 체결 ${restoredNxtTrade.price}원 · 실시간 갱신 대기`
          : hasRestOrderBook
          ? "KIS REST 실제 호가 10단계 · WebSocket 실시간 갱신 대기"
          : restoredOrderBook !== null
            ? `SQLite 최종 실제 호가 · ${restoredOrderBook.providerReceivedAt} · WebSocket 갱신 대기`
            : "KIS 현재가 수신 · 장외 빈 호가 · 저장된 최종 실제 호가 없음",
      });

      const shouldProjectVenue = (projection: MarketLiveProjection): boolean => {
        const venue = projection.orderBook?.venue ?? projection.trade?.venue;
        const session = projection.trade?.session ?? "UNKNOWN";
        return venue === "NXT"
          ? session === "PRE" || session === "AFTER"
          : session === "REGULAR" || session === "UNKNOWN";
      };
      const streams = (["KRX", "NXT"] as const).map(
        (venue) =>
          new DomesticKisLiveStream({
            environment: dataEnvironment,
            approvalKey,
            symbol,
            venue,
            onProjection: (projection) => {
              if (isCurrentConnection() && shouldProjectVenue(projection)) {
                this.applyReadOnlyMarketProjection(projection);
              }
            },
          }),
      );
      for (const stream of streams) this.#streams.add(stream);
      const starts = await Promise.allSettled(
        streams.map((stream) => stream.start()),
      );
      if (starts.every((result) => result.status === "rejected")) {
        throw new Error("KIS_WS_ALL_DOMESTIC_VENUES_FAILED");
      }
      if (!isCurrentConnection()) {
        for (const stream of streams) this.#streams.delete(stream);
        await Promise.all(streams.map((stream) => stream.stop()));
      }
      return this.#market;
    } catch (error) {
      if (!isCurrentConnection()) return this.#market;
      const streams = [...this.#streams];
      this.#streams.clear();
      await Promise.all(streams.map((stream) => stream.stop()));
      return this.#setMarket({
        ...this.#market,
        mode: "KIS_READ_ONLY",
        connectionState: "ERROR",
        freshness:
          this.#market.bids.length > 0 && this.#market.asks.length > 0
            ? "stale"
            : "offline",
        statusMessage: safeStatusMessage(error),
      });
    }
  }

  public async disconnectMarket(): Promise<DesktopMarketProjection> {
    this.#marketConnectionGeneration += 1;
    this.#connectRequest = null;
    const streams = [...this.#streams];
    this.#streams.clear();
    await Promise.all(streams.map((stream) => stream.stop()));
    return this.#setMarket({
      ...this.#market,
      connectionState: "OFFLINE",
      freshness: this.#market.receivedAt === null ? "offline" : "stale",
      statusMessage: "KIS 읽기 전용 연결을 중지했습니다.",
    });
  }

  public submitPaperOrder(rawRequest: unknown): DesktopPaperOrderResult {
    let request: DesktopPaperOrderRequest;
    try {
      request = validatePaperRequest(rawRequest);
    } catch {
      return this.#rejectedResult("invalid-request", "INVALID_REQUEST");
    }
    if (request.instrumentId !== this.#market.instrumentId) {
      return this.#rejectedResult(
        request.requestId,
        "INSTRUMENT_SCOPE_MISMATCH",
      );
    }
    if (!isDesktopPaperMarketExecutable(this.#market)) {
      return this.#rejectedResult(request.requestId, "MARKET_DATA_NOT_LIVE");
    }

    const now = new Date().toISOString();
    const order: PaperOrderCommand = {
      clientOrderId: request.requestId,
      accountId: ACCOUNT_ID,
      instrumentId: request.instrumentId,
      venue: this.#market.venue,
      currency: this.#market.currency,
      side: request.side,
      orderType: request.orderType,
      quantity: request.quantity,
      limitPrice: request.limitPrice,
      timeInForce: "DAY",
      // The v1 immutable paper-order ledger stores REGULAR as its canonical
      // equity session; executable phase eligibility is checked above.
      session: "REGULAR",
      submittedAt: now,
      submissionMode: "CONFIRM_TICKET",
      simulationOnly: true,
    };
    const market = this.#canonicalBook(now);
    const execution = planImmediateBookFills({
      order,
      market,
      state: {
        seenClientOrderIds: [],
        lastOrderBookSequence: null,
        lastTradeSequence: null,
        cursorScope: null,
      },
      policy: desktopPaperPolicy(order.venue),
      evaluatedAt: now,
    });
    if (execution.status === "REJECTED") {
      return this.#result(
        request.requestId,
        false,
        execution,
        execution.rejectionCode,
      );
    }

    try {
      const commitId = stableLocalId("initial", [request.requestId]);
      this.#papers.commitPaperExecution({
        commitId,
        order,
        execution,
        reservedCashMinor: this.#reservedCash(order, execution),
        cashLedgerEntries: this.#ledgerEntries(
          order,
          execution,
          now,
          commitId,
        ),
        occurredAt: now,
      });
      if (
        this.#simulationProfile === "ADVANCED_QUEUE_V1" &&
        order.orderType === "LIMIT" &&
        execution.remainingQuantity !== "0"
      ) {
        const stored = this.#papers.getPaperOrder(
          ACCOUNT_ID,
          order.clientOrderId,
        );
        if (stored !== null) {
          this.#initializeAdvancedQueue(stored, market, now);
        }
      }
      return this.#result(request.requestId, true, execution, null);
    } catch (error) {
      const code =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        typeof error.code === "string"
          ? error.code
          : "PERSISTENCE_REJECTED";
      return this.#rejectedResult(request.requestId, code);
    }
  }

  public applyReadOnlyMarketProjection(
    projection: MarketLiveProjection,
  ): DesktopMarketProjection {
    this.#marketSequence += 1n;
    const nextProjection = toDesktopMarketProjection(
      projection,
      this.#marketSequence,
    );
    const preserveLastOrderBook =
      nextProjection.instrumentId === this.#market.instrumentId &&
      nextProjection.bids.length === 0 &&
      nextProjection.asks.length === 0 &&
      this.#market.bids.length > 0 &&
      this.#market.asks.length > 0;
    const preserveLastTrade =
      nextProjection.instrumentId === this.#market.instrumentId &&
      nextProjection.price === null &&
      this.#market.price !== null;
    const desktopProjection = {
      ...nextProjection,
      openPrice: this.#market.openPrice,
      highPrice: this.#market.highPrice,
      lowPrice: this.#market.lowPrice,
      ...(preserveLastTrade
        ? {
            price: this.#market.price,
            change: this.#market.change,
            changeRate: this.#market.changeRate,
            executionStrength: this.#market.executionStrength,
            cumulativeVolume: this.#market.cumulativeVolume,
            cumulativeTurnover: this.#market.cumulativeTurnover,
            receivedAt: this.#market.receivedAt,
            tradeReceivedAt: this.#market.tradeReceivedAt,
            tradeOccurredAt: this.#market.tradeOccurredAt,
          }
        : {}),
      ...(preserveLastOrderBook
        ? {
            bids: this.#market.bids,
            asks: this.#market.asks,
            totalBidQuantity: this.#market.totalBidQuantity,
            totalAskQuantity: this.#market.totalAskQuantity,
            providerTime:
              nextProjection.providerTime ?? this.#market.providerTime,
            orderBookReceivedAt: this.#market.orderBookReceivedAt,
            orderBookOccurredAt: this.#market.orderBookOccurredAt,
            session:
              nextProjection.session === "UNKNOWN"
                ? this.#market.session
                : nextProjection.session,
            freshness: "stale" as const,
          }
        : {}),
      ...((preserveLastOrderBook || preserveLastTrade)
        ? {
            freshness: "stale" as const,
            statusMessage:
              "KIS 실시간 갱신 대기 · 마지막 수신 시세를 유지합니다.",
          }
        : {}),
    };
    const liveBook = projection.orderBook;
    const liveTrade = projection.trade;
    if (
      liveTrade !== null &&
      liveTrade.providerTime !== null &&
      projection.lastTradeReceivedAt !== null &&
      (liveTrade.venue === "KRX" || liveTrade.venue === "NXT")
    ) {
      this.#marketSnapshots.saveDomesticTrade({
        instrumentId: `KRX:${this.#symbol}`,
        venue: liveTrade.venue,
        price: liveTrade.price,
        change: liveTrade.change,
        changeRate: liveTrade.changeRate,
        providerDate: liveTrade.providerDate,
        providerTime: liveTrade.providerTime,
        providerReceivedAt: projection.lastTradeReceivedAt,
      });
    }
    if (
      liveBook !== null &&
      liveBook.providerTime !== null &&
      liveBook.providerTime !== "000000" &&
      projection.lastOrderBookReceivedAt !== null &&
      (liveBook.venue === "KRX" || liveBook.venue === "NXT") &&
      liveBook.bids.length + liveBook.asks.length > 0 &&
      Date.now() - this.#lastOrderBookSnapshotWriteAt >= 1_000
    ) {
      this.#marketSnapshots.saveDomesticOrderBook({
        instrumentId: liveBook.instrumentId,
        venue: liveBook.venue === "NXT" ? "NXT" : "KRX",
        bids: [...liveBook.bids],
        asks: [...liveBook.asks],
        totalBidQuantity: liveBook.totalBidQuantity,
        totalAskQuantity: liveBook.totalAskQuantity,
        providerTime: liveBook.providerTime,
        providerReceivedAt: projection.lastOrderBookReceivedAt,
      });
      this.#lastOrderBookSnapshotWriteAt = Date.now();
    }
    this.#setMarket(desktopProjection);
    this.#processPassiveObservedTrade(projection);
    return desktopProjection;
  }

  public async close(): Promise<void> {
    await this.disconnectMarket();
    if (this.#database.open) {
      this.#database.close();
    }
  }

  #ensureDefaultAccount(): void {
    const existing = this.#database
      .prepare("SELECT id FROM simulation_accounts WHERE id = ?")
      .get(ACCOUNT_ID);
    const now = new Date().toISOString();
    if (existing === undefined) {
      this.#accounts.createAccount({
        id: ACCOUNT_ID,
        displayName: "나의 로컬 모의 계좌",
        baseCurrency: "KRW",
        initialCashMinor: DEFAULT_INITIAL_CASH_MINOR,
        initialLedgerEntryId: "personal-paper-initial-funding",
        idempotencyKey: "personal-paper-initial-funding",
        occurredAt: now,
      });
    }
    const usdFunding = this.#database
      .prepare("SELECT id FROM cash_ledger WHERE account_id = ? AND id = ?")
      .get(ACCOUNT_ID, "personal-paper-usd-initial-funding");
    if (usdFunding === undefined) {
      this.#accounts.appendCashLedgerEntry({
        id: "personal-paper-usd-initial-funding",
        accountId: ACCOUNT_ID,
        currency: "USD",
        amountMinor: DEFAULT_INITIAL_USD_CASH_MINOR,
        entryType: "INITIAL_FUNDING",
        idempotencyKey: "personal-paper-usd-initial-funding",
        occurredAt: now,
      });
    }
  }

  #accountProjection(): DesktopAccountProjection {
    const summary: PaperAccountSummary =
      this.#papers.getAccountSummary(ACCOUNT_ID);
    const activeCurrency = this.#market.currency;
    const cash =
      summary.cashBalances.find(
        (balance) => balance.currency === activeCurrency,
      )?.availableMinor ?? "0";
    const fills = this.#papers.listPaperFillMarkers(
      ACCOUNT_ID,
      this.#market.instrumentId,
    );
    const orderQuantities = new Map(
      this.#papers
        .listPaperOrders(ACCOUNT_ID)
        .map((order) => [order.clientOrderId, BigInt(order.quantity)]),
    );
    const runningFilled = new Map<string, bigint>();
    return {
      schemaVersion: 1,
      accountId: summary.accountId,
      displayName: summary.displayName,
      baseCurrency: activeCurrency,
      cashMinor: cash,
      storageState: "READY",
      simulationProfile: this.#simulationProfile,
      queuePositionQuality:
        this.#simulationProfile === "ADVANCED_QUEUE_V1"
          ? "QUEUE_ESTIMATED"
          : "NOT_APPLICABLE",
      queueSafetyFactor:
        this.#simulationProfile === "ADVANCED_QUEUE_V1"
          ? this.#queueSafetyFactor
          : null,
      positions: summary.positions.map((position) => ({
        instrumentId: position.instrumentId,
        quantity: position.quantity,
        averagePrice: averagePaperPositionPrice(
          this.#papers.listPaperFillMarkers(
            ACCOUNT_ID,
            position.instrumentId,
          ),
          position.quantity,
        ),
      })),
      fills: fills.map((fill) => {
        const cumulative =
          (runningFilled.get(fill.clientOrderId) ?? 0n) +
          BigInt(fill.quantity);
        runningFilled.set(fill.clientOrderId, cumulative);
        return {
          fillId: fill.fillId,
          clientOrderId: fill.clientOrderId,
          instrumentId: fill.instrumentId,
          side: fill.side,
          price: fill.price,
          quantity: fill.quantity,
          filledAt: fill.occurredAt,
          completion:
            cumulative >=
            (orderQuantities.get(fill.clientOrderId) ?? cumulative)
              ? ("FULL" as const)
              : ("PARTIAL" as const),
        };
      }),
      openOrders: this.#papers
        .listPaperOrders(ACCOUNT_ID)
        .filter(
          (order) =>
            order.limitPrice !== null &&
            BigInt(order.remainingQuantity) > 0n &&
            ["ACCEPTED", "RESTING", "PARTIALLY_FILLED"].includes(order.status),
        )
        .map((order) => ({
          clientOrderId: order.clientOrderId,
          instrumentId: order.instrumentId,
          side: order.side,
          limitPrice: order.limitPrice ?? "0",
          remainingQuantity: order.remainingQuantity,
          status: order.status as "ACCEPTED" | "RESTING" | "PARTIALLY_FILLED",
        })),
      statusMessage: `SQLite WAL · 주문 ${summary.openOrderCount} · 체결 ${summary.fillCount}`,
    };
  }

  #processPassiveObservedTrade(projection: MarketLiveProjection): void {
    const tick = projection.trade;
    const tradeReceivedAt = projection.lastTradeReceivedAt;
    if (
      tick === null ||
      tradeReceivedAt === null ||
      tick.providerDate === null ||
      tick.cumulativeVolume === null ||
      !isDesktopPaperMarketExecutable(this.#market)
    ) {
      return;
    }

    const marketEventId = stableLocalId("kis-trade", [
      tick.instrumentId,
      tick.providerDate ?? "",
      tick.providerTime ?? "",
      tick.cumulativeVolume ?? "",
      tick.price,
      tick.quantity,
    ]);
    if (marketEventId === this.#lastProcessedTradeIdentity) return;

    const openOrders = this.#papers
      .listPaperOrders(ACCOUNT_ID)
      .filter(
        (stored) =>
          stored.instrumentId === tick.instrumentId &&
          stored.venue === tick.venue &&
          stored.orderType === "LIMIT" &&
          ["ACCEPTED", "RESTING", "PARTIALLY_FILLED"].includes(stored.status),
      );
    if (openOrders.length === 0) {
      this.#lastProcessedTradeIdentity = marketEventId;
      return;
    }

    const sessionKey = `KRX:${tick.providerDate}:REGULAR`;
    const claim = this.#papers.claimPaperMarketEvent({
      accountId: ACCOUNT_ID,
      instrumentId: tick.instrumentId,
      sessionKey,
      sequence: tick.cumulativeVolume,
      marketEventId,
      observedAt: tradeReceivedAt,
    });
    this.#lastProcessedTradeIdentity = marketEventId;
    if (claim !== "ACCEPTED") return;

    const trade: CanonicalTradeEvent = {
      kind: "TRADE_TICK",
      marketEventId,
      sequence: tick.cumulativeVolume,
      currency: this.#market.currency,
      freshness: "LIVE",
      receivedAt: tradeReceivedAt,
      tradingPhase: "REGULAR_CONTINUOUS",
      sessionKey,
      tick: { ...tick },
      auction: null,
    };

    let availableObservedQuantity =
      BigInt(tick.quantity) -
      BigInt(
        this.#papers.sumPaperFillQuantityForMarketEvent(
          ACCOUNT_ID,
          marketEventId,
        ),
      );
    if (availableObservedQuantity <= 0n) return;

    if (this.#simulationProfile === "ADVANCED_QUEUE_V1") {
      this.#processAdvancedQueueOrders({
        openOrders,
        trade,
        tradeReceivedAt,
        marketEventId,
        availableObservedQuantity,
      });
      return;
    }

    let accountChanged = false;
    for (const stored of openOrders) {
      if (availableObservedQuantity <= 0n) break;
      if (
        this.#papers.hasPaperFillForMarketEvent(
          ACCOUNT_ID,
          stored.clientOrderId,
          marketEventId,
        )
      ) {
        continue;
      }
      const openOrder = this.#restoreOpenOrder(stored);
      if (openOrder === null) continue;
      const allocatedTrade: CanonicalTradeEvent = {
        ...trade,
        tick: {
          ...trade.tick,
          quantity: availableObservedQuantity.toString(),
        },
      };
      const execution = planPassiveObservedTradeFill({
        openOrder,
        trade: allocatedTrade,
        state: {
          seenClientOrderIds: [],
          lastOrderBookSequence: null,
          lastTradeSequence: null,
          cursorScope: null,
        },
        policy: desktopPaperPolicy(stored.venue),
        evaluatedAt: tradeReceivedAt,
      });
      if (
        execution.status === "REJECTED" ||
        execution.newlyFilledQuantity === "0"
      ) {
        continue;
      }

      const commitId = stableLocalId("passive", [
        stored.clientOrderId,
        marketEventId,
      ]);
      try {
        this.#papers.commitPaperExecution({
          commitId,
          order: openOrder.order,
          execution,
          reservedCashMinor: this.#reservedCash(
            openOrder.order,
            execution,
          ),
          cashLedgerEntries: this.#ledgerEntries(
            openOrder.order,
            execution,
            tradeReceivedAt,
            commitId,
          ),
          occurredAt: tick.occurredAt ?? tradeReceivedAt,
        });
        availableObservedQuantity -= BigInt(
          execution.newlyFilledQuantity,
        );
        accountChanged = true;
      } catch {
        // A single local order must never break the read-only market stream.
      }
    }

    if (accountChanged) {
      this.#emitAccount(this.#accountProjection());
    }
  }

  #initializeAdvancedQueue(
    stored: StoredPaperOrder,
    market: CanonicalOrderBookEvent,
    evaluatedAt: string,
  ): AdvancedQueueState | null {
    const openOrder = this.#restoreOpenOrder(stored);
    if (
      openOrder === null ||
      openOrder.order.orderType !== "LIMIT" ||
      openOrder.order.limitPrice === null ||
      BigInt(stored.remainingQuantity) <= 0n ||
      market.snapshot.occurredAt === null
    ) {
      return null;
    }
    try {
      const queue = acceptAdvancedQueueEstimate({
        order: {
          ...openOrder.order,
          quantity: stored.remainingQuantity,
          submittedAt: market.snapshot.occurredAt,
        },
        market,
        policy: desktopPaperPolicy(openOrder.order.venue),
        safetyFactor: this.#queueSafetyFactor,
        evaluatedAt,
      });
      const restored = AdvancedQueueStateSchema.parse({
        ...queue,
        remainingQuantity: stored.remainingQuantity,
      });
      return this.#papers.saveAdvancedQueueState(ACCOUNT_ID, restored);
    } catch {
      return null;
    }
  }

  #processAdvancedQueueOrders(input: {
    readonly openOrders: readonly StoredPaperOrder[];
    readonly trade: CanonicalTradeEvent;
    readonly tradeReceivedAt: string;
    readonly marketEventId: string;
    readonly availableObservedQuantity: bigint;
  }): void {
    const book = this.#canonicalBook(input.tradeReceivedAt);
    let availableObservedQuantity = input.availableObservedQuantity;
    let accountChanged = false;

    for (const stored of input.openOrders) {
      if (availableObservedQuantity <= 0n) break;
      if (
        this.#papers.hasPaperFillForMarketEvent(
          ACCOUNT_ID,
          stored.clientOrderId,
          input.marketEventId,
        )
      ) {
        continue;
      }

      let queue = this.#papers.getAdvancedQueueState(
        ACCOUNT_ID,
        stored.clientOrderId,
      );
      const queueCannotContinue =
        queue !== null &&
        (queue.sessionKey !== book.sessionKey ||
          queue.remainingQuantity !== stored.remainingQuantity ||
          BigInt(queue.lastOrderBookSequence) >= BigInt(book.sequence));
      if (queueCannotContinue) {
        this.#papers.deleteAdvancedQueueState(
          ACCOUNT_ID,
          stored.clientOrderId,
        );
        queue = null;
      }
      if (queue === null) {
        this.#initializeAdvancedQueue(
          stored,
          book,
          input.tradeReceivedAt,
        );
        // The snapshot event seeds the queue. The same event cannot also
        // advance it, so this observed trade is deliberately fail-closed.
        continue;
      }

      const allocatedTrade: CanonicalTradeEvent = {
        ...input.trade,
        tick: {
          ...input.trade.tick,
          quantity: availableObservedQuantity.toString(),
        },
      };
      const decision = planAdvancedQueueProgress({
        queue,
        trade: allocatedTrade,
        book,
        policy: desktopPaperPolicy(stored.venue),
        evaluatedAt: input.tradeReceivedAt,
      });
      if (decision.resetRequired) {
        this.#papers.deleteAdvancedQueueState(
          ACCOUNT_ID,
          stored.clientOrderId,
        );
        continue;
      }
      if (decision.fill === null) {
        if (decision.rejectionCode !== "OUT_OF_ORDER_EVENT") {
          this.#papers.saveAdvancedQueueState(
            ACCOUNT_ID,
            decision.state,
          );
        }
        continue;
      }

      const execution = this.#advancedExecutionPlan(stored, decision);
      const commitId = stableLocalId("advanced-passive", [
        stored.clientOrderId,
        input.marketEventId,
      ]);
      try {
        const openOrder = this.#restoreOpenOrder(stored);
        if (openOrder === null) continue;
        this.#papers.commitPaperExecution({
          commitId,
          order: openOrder.order,
          execution,
          reservedCashMinor: this.#reservedCash(
            openOrder.order,
            execution,
          ),
          cashLedgerEntries: this.#ledgerEntries(
            openOrder.order,
            execution,
            input.tradeReceivedAt,
            commitId,
          ),
          occurredAt:
            input.trade.tick.occurredAt ?? input.tradeReceivedAt,
        });
        availableObservedQuantity -= BigInt(
          execution.newlyFilledQuantity,
        );
        if (execution.remainingQuantity === "0") {
          this.#papers.deleteAdvancedQueueState(
            ACCOUNT_ID,
            stored.clientOrderId,
          );
        } else {
          this.#papers.saveAdvancedQueueState(
            ACCOUNT_ID,
            decision.state,
          );
        }
        accountChanged = true;
      } catch {
        // The claimed event stays consumed: underfill is safer than replaying
        // one real trade into multiple local fills after a crash.
      }
    }

    if (accountChanged) {
      this.#emitAccount(this.#accountProjection());
    }
  }

  #advancedExecutionPlan(
    stored: StoredPaperOrder,
    decision: AdvancedQueueDecision,
  ): PaperExecutionPlan {
    const fill = decision.fill;
    if (fill === null) {
      throw new Error("Advanced execution requires a queue fill");
    }
    const filledQuantity =
      BigInt(stored.filledQuantity) + BigInt(fill.quantity);
    const remainingQuantity =
      BigInt(stored.quantity) -
      filledQuantity -
      BigInt(stored.cancelledQuantity);
    return PaperExecutionPlanSchema.parse({
      clientOrderId: stored.clientOrderId,
      status:
        remainingQuantity === 0n ? "FILLED" : "PARTIALLY_FILLED",
      rejectionCode: null,
      fills: [fill],
      orderQuantity: stored.quantity,
      newlyFilledQuantity: fill.quantity,
      filledQuantity: filledQuantity.toString(),
      remainingQuantity: remainingQuantity.toString(),
      cancelledQuantity: stored.cancelledQuantity,
      grossNotional: fill.grossNotional,
      vwap: fill.price,
      plannedEvents: decision.plannedEvents,
      nextState: {
        seenClientOrderIds: [],
        lastOrderBookSequence: decision.state.lastOrderBookSequence,
        lastTradeSequence: decision.state.lastTradeSequence,
        cursorScope: {
          instrumentId: decision.state.instrumentId,
          sessionKey: decision.state.sessionKey,
        },
      },
      commitOwner: "DB_TRANSACTION_OWNER",
    });
  }

  #restoreOpenOrder(stored: StoredPaperOrder): OpenPaperOrder | null {
    if (
      !["ACCEPTED", "RESTING", "PARTIALLY_FILLED"].includes(stored.status)
    ) {
      return null;
    }
    return {
      order: {
        clientOrderId: stored.clientOrderId,
        accountId: stored.accountId,
        instrumentId: stored.instrumentId,
        venue: stored.venue,
        currency: stored.currency,
        side: stored.side,
        orderType: stored.orderType,
        quantity: stored.quantity,
        limitPrice: stored.limitPrice,
        timeInForce: stored.timeInForce,
        session: stored.session,
        submittedAt: stored.submittedAt,
        submissionMode: stored.submissionMode,
        simulationOnly: true,
      },
      status: stored.status as OpenPaperOrder["status"],
      filledQuantity: stored.filledQuantity,
      acceptedAt: stored.submittedAt,
    };
  }

  #canonicalBook(receivedAt: string): CanonicalOrderBookEvent {
    const providerTime = this.#market.providerTime;
    const kstDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(receivedAt));
    const providerDate = kstDate.replaceAll("-", "");
    return {
      kind: "ORDER_BOOK",
      marketEventId: `desktop-book:${this.#market.sequence}`,
      sequence: this.#market.sequence,
      currency: this.#market.currency,
      freshness: "LIVE",
      receivedAt: this.#market.orderBookReceivedAt ?? receivedAt,
      tradingPhase:
        this.#market.session === "REGULAR" ||
        ((this.#market.venue === "NXT" || ["NASDAQ", "NYSE", "AMEX"].includes(this.#market.venue)) &&
          (this.#market.session === "PRE" || this.#market.session === "AFTER"))
          ? "REGULAR_CONTINUOUS"
          : "CLOSED",
      sessionKey: `${this.#market.venue}:${providerDate}:${this.#market.session}`,
      snapshot: {
        instrumentId: this.#market.instrumentId,
        venue: this.#market.venue,
        bids: [...this.#market.bids],
        asks: [...this.#market.asks],
        totalBidQuantity: this.#market.totalBidQuantity,
        totalAskQuantity: this.#market.totalAskQuantity,
        occurredAt: this.#market.orderBookOccurredAt,
        providerDate,
        providerTime,
        source: "KIS_WS",
      },
    };
  }

  #reservedCash(
    order: PaperOrderCommand,
    execution: PaperExecutionPlan,
  ): string {
    if (
      order.side !== "BUY" ||
      !["ACCEPTED", "RESTING", "PARTIALLY_FILLED"].includes(execution.status)
    ) {
      return "0";
    }
    const limit = currencyDecimalToMinor(order.limitPrice ?? "0", order.currency);
    const remaining = BigInt(execution.remainingQuantity);
    const gross = limit * remaining;
    return (gross + ceilRate(gross, FEE_RATE_PPM)).toString();
  }

  #ledgerEntries(
    order: PaperOrderCommand,
    execution: PaperExecutionPlan,
    occurredAt: string,
    commitId: string,
  ): CashLedgerEntryInput[] {
    if (execution.fills.length === 0) return [];
    const gross = execution.fills.reduce(
      (sum, fill) => sum + currencyDecimalToMinor(fill.grossNotional, order.currency),
      0n,
    );
    const fee = ceilRate(gross, FEE_RATE_PPM);
    const tax = order.currency === "KRW" && order.side === "SELL" ? ceilRate(gross, SELL_TAX_RATE_PPM) : 0n;
    const base = commitId;
    const entries: CashLedgerEntryInput[] = [
      {
        id: `${base}:principal`,
        accountId: order.accountId,
        currency: order.currency,
        amountMinor: (order.side === "BUY" ? -gross : gross).toString(),
        entryType: "TRADE_PRINCIPAL",
        idempotencyKey: `${base}:principal`,
        referenceId: order.clientOrderId,
        occurredAt,
      },
    ];
    if (fee > 0n) {
      entries.push({
        id: `${base}:fee`,
        accountId: order.accountId,
        currency: order.currency,
        amountMinor: (-fee).toString(),
        entryType: "FEE",
        idempotencyKey: `${base}:fee`,
        referenceId: order.clientOrderId,
        occurredAt,
      });
    }
    if (tax > 0n) {
      entries.push({
        id: `${base}:tax`,
        accountId: order.accountId,
        currency: order.currency,
        amountMinor: (-tax).toString(),
        entryType: "TAX",
        idempotencyKey: `${base}:tax`,
        referenceId: order.clientOrderId,
        occurredAt,
      });
    }
    return entries;
  }

  #setMarket(projection: DesktopMarketProjection): DesktopMarketProjection {
    const currencyChanged = this.#market.currency !== projection.currency;
    this.#market = projection;
    this.#emitMarket(projection);
    if (currencyChanged) {
      this.#emitAccount(this.#accountProjection());
    }
    return projection;
  }

  #setChart(projection: DesktopChartProjection): DesktopChartProjection {
    this.#chart = projection;
    this.#emitChart(projection);
    return projection;
  }

  #authClient(
    environment: "paper" | "prod",
    credentials: { readonly appKey: string; readonly appSecret: string },
  ): KisAuthClient {
    const existing = this.#authByEnvironment.get(environment);
    if (existing !== undefined) return existing;
    const client = new KisAuthClient(environment, credentials);
    this.#authByEnvironment.set(environment, client);
    return client;
  }

  #limitChartRequest(): Promise<void> {
    const request = this.#chartRequestGate.then(async () => {
      const waitMs =
        CHART_REQUEST_MINIMUM_GAP_MS -
        (Date.now() - this.#lastChartRequestAt);
      if (waitMs > 0) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, waitMs);
        });
      }
      this.#lastChartRequestAt = Date.now();
    });
    this.#chartRequestGate = request.catch(() => undefined);
    return request;
  }

  #result(
    requestId: string,
    accepted: boolean,
    execution: PaperExecutionPlan,
    rejectionCode: string | null,
  ): DesktopPaperOrderResult {
    return {
      schemaVersion: 1,
      requestId,
      accepted,
      status:
        execution.status === "DRAFT"
          ? "REJECTED"
          : execution.status === "ACCEPTED"
            ? "RESTING"
            : execution.status,
      rejectionCode,
      account: this.#accountProjection(),
      market: this.#market,
    };
  }

  #rejectedResult(
    requestId: string,
    rejectionCode: string,
  ): DesktopPaperOrderResult {
    return {
      schemaVersion: 1,
      requestId,
      accepted: false,
      status: "REJECTED",
      rejectionCode,
      account: this.#accountProjection(),
      market: this.#market,
    };
  }
}

export const DESKTOP_SIMULATION_POLICY = Object.freeze({
  instrumentName: INSTRUMENT_NAME,
  commissionRatePpm: FEE_RATE_PPM.toString(),
  sellTaxRatePpm: SELL_TAX_RATE_PPM.toString(),
  maximumExecutionMarketAgeMs: MAX_EXECUTION_MARKET_AGE_MS,
  policyVersion: "DESKTOP_INITIAL_V1",
  actualOrderCapability: "FORBIDDEN",
});
