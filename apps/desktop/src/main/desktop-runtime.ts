import type Database from "better-sqlite3";
import { createHash } from "node:crypto";

import {
  loadRuntimeConfig,
  requireKisCredentialsForEnvironment,
  publicConfig,
  requireOpenDartCredentials,
  requireSecRequestIdentity,
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
import { KisProdNewsClient } from "../../../../src/kis/news-headlines.js";
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
import { OpenDartClient } from "../../../../src/disclosures/open-dart-client.js";
import { KisRestClient } from "../../../../src/kis/rest-client.js";
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
  DesktopInstrumentSearchProjection,
  DesktopMarketContextItemProjection,
  DesktopMarketContextProjection,
  DesktopPaperOrderRequest,
  DesktopPaperOrderResult,
  DesktopRankingProjection,
  DesktopRankingSort,
} from "../shared/desktop-contracts.js";
import { averagePaperPositionPrice } from "../shared/paper-valuation.js";

const ACCOUNT_ID = "personal-paper-account";
const DEFAULT_INITIAL_CASH_MINOR = "100000000";
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

function desktopPaperPolicy(): PaperFillPolicy {
  return {
    maxMarketDataAgeMs: MAX_EXECUTION_MARKET_AGE_MS,
    passiveFillModel: "AT_OR_THROUGH",
    marketRemainder: "CANCEL",
    marketableLimitRemainder: "REST",
    vwapScale: 8,
    version: "DESKTOP_INITIAL_V1",
    tickRule: {
      kind: "FIXED",
      venue: "KRX",
      version: "KRX_WON_TICK_FALLBACK_V1",
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      effectiveTo: null,
      tickSize: "1",
    },
    minimumPrice: "1",
    maximumPrice: "1000000000",
  };
}

function isRecentProviderEvent(value: string | null, nowMs: number): boolean {
  if (value === null) return false;
  const timestamp = Date.parse(value);
  const age = nowMs - timestamp;
  return (
    Number.isFinite(timestamp) &&
    age >= 0 &&
    age <= MAX_EXECUTION_MARKET_AGE_MS
  );
}

export function isDesktopPaperMarketExecutable(
  market: Pick<
    DesktopMarketProjection,
    | "mode"
    | "connectionState"
    | "freshness"
    | "session"
    | "orderBookReceivedAt"
    | "tradeReceivedAt"
    | "bids"
    | "asks"
  >,
  nowMs = Date.now(),
): boolean {
  return (
    market.mode === "KIS_READ_ONLY" &&
    market.connectionState === "LIVE" &&
    market.freshness === "live" &&
    market.session === "REGULAR" &&
    isRecentProviderEvent(market.orderBookReceivedAt, nowMs) &&
    isRecentProviderEvent(market.tradeReceivedAt, nowMs) &&
    market.bids.length > 0 &&
    market.asks.length > 0
  );
}

function ceilRate(amount: bigint, ratePpm: bigint): bigint {
  if (amount === 0n || ratePpm === 0n) return 0n;
  return (amount * ratePpm + ONE_MILLION - 1n) / ONE_MILLION;
}

function krwDecimalToMinor(value: string): bigint {
  if (!/^(?:0|[1-9]\d*)$/.test(value)) {
    throw new Error("KRW paper execution requires a whole-won notional");
  }
  return BigInt(value);
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
): DesktopMarketSession {
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
  const session = resolveDesktopMarketSession(
    book?.providerTime ?? null,
    tick?.session ?? null,
  );
  return {
    schemaVersion: 1,
    instrumentId: projection.instrumentId,
    symbol: projection.instrumentId.split(":")[1] ?? "",
    venue: book?.venue ?? tick?.venue ?? "KRX",
    currency: "KRW",
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
    !/^KRX:[0-9A-Z]{6,7}$/.test(request.instrumentId) ||
    (request.side !== "BUY" && request.side !== "SELL") ||
    (request.orderType !== "MARKET" && request.orderType !== "LIMIT") ||
    typeof request.quantity !== "string" ||
    !/^[1-9]\d*$/.test(request.quantity) ||
    (request.limitPrice !== null &&
      (typeof request.limitPrice !== "string" ||
        !/^[1-9]\d*$/.test(request.limitPrice))) ||
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
  readonly #marketSnapshots: LocalMarketSnapshotRepository;
  readonly #instrumentMaster: KisDomesticInstrumentMaster;
  readonly #emitMarket: (projection: DesktopMarketProjection) => void;
  readonly #emitAccount: (projection: DesktopAccountProjection) => void;
  readonly #emitChart: (projection: DesktopChartProjection) => void;
  #symbol: string;
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
  #marketContextRequest: Promise<DesktopMarketContextProjection> | null = null;
  #marketContextCache:
    | { readonly projection: DesktopMarketContextProjection; readonly at: number }
    | null = null;
  #stream: DomesticKisLiveStream | null = null;
  #marketConnectionGeneration = 0;
  #marketSequence = 0n;
  #lastProcessedTradeIdentity: string | null = null;
  #lastOrderBookSnapshotWriteAt = 0;

  public constructor(options: {
    userDataPath: string;
    emitMarket: (projection: DesktopMarketProjection) => void;
    emitAccount?: (projection: DesktopAccountProjection) => void;
    emitChart?: (projection: DesktopChartProjection) => void;
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
    this.#marketSnapshots = new LocalMarketSnapshotRepository(this.#database);
    this.#instrumentMaster = new KisDomesticInstrumentMaster({
      userDataPath: options.userDataPath,
    });
    this.#emitMarket = options.emitMarket;
    this.#emitAccount = options.emitAccount ?? (() => undefined);
    this.#emitChart = options.emitChart ?? (() => undefined);
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

  public async getDomesticRanking(
    rawSort: unknown,
  ): Promise<DesktopRankingProjection> {
    const sort = validateRankingSort(rawSort);
    const config = loadRuntimeConfig();
    try {
      assertLiveReadOnlyAcknowledgement(config);
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
                minimumRate: "0.01",
                maximumRate: "100",
                maxPages: 10,
              }
            : {
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
              ? "KIS 실전 등락률 후보를 상승률 순으로 재정렬했습니다."
              : "KIS 실전 등락률 후보를 하락률 순으로 재정렬했습니다.",
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
        market: "KRX",
        sort,
        state: "READY",
        source: ranking.source,
        fetchedAt: ranking.fetchedAt,
        statusMessage:
          dailyItems.length === 0
            ? "KIS 조회 거래일에 체결된 거래가 아직 없어 순위를 표시하지 않습니다. 장 시작 전 0 거래량을 -100%로 계산하지 않습니다."
            : sort === "AVERAGE_VOLUME"
              ? "KIS 평균거래량 상위 후보군을 조회 거래일 현재 거래량순으로 재정렬했습니다."
              : "KIS KRX 조회 거래일 데이터입니다. 거래량·거래대금은 거래일마다 새로 시작하며, 거래량 증감률은 조회 거래일과 전 거래일 전체를 비교합니다.",
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
        market: "KRX",
        sort,
        state: "ERROR",
        items: [],
        source: "KIS_REST",
        fetchedAt: null,
        statusMessage:
          error instanceof Error
            ? `KIS 거래 순위를 불러오지 못했습니다: ${error.message}`
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
    const jobs: Promise<void>[] = [];

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
        client
          .getOverseasHeadlines({
            nationCode: "US",
            symbol: config.KIS_US_SYMBOL,
          })
          .then((page) => {
            for (const headline of page.items) {
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
                obtainedAt: page.fetchedAt,
                rights: "KIS_HEADLINE_ONLY",
                relatedInstrumentIds:
                  headline.symbol === null
                    ? []
                    : [
                        `${headline.exchangeCode ?? config.KIS_US_EXCHANGE}:${headline.symbol}`,
                      ],
                payloadHash: payloadHash(headline),
              });
            }
            sources.push({
              provider: "KIS_OVERSEAS_NEWS",
              state: "READY",
              itemCount: page.items.length,
              message: `${page.items.length}개 실제 KIS 미국 뉴스 제목 수신`,
            });
            this.#information.saveCheckpoint(
              "KIS_OVERSEAS_NEWS",
              { fetchedAt: page.fetchedAt },
              page.fetchedAt,
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
              config.KIS_US_SYMBOL,
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
                    `${snapshot.exchanges[index] ?? "US"}:${ticker}`,
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
        new OpenDartClient({ credentials })
          .listFilings({
            beginDate: koreanCalendarDate(),
            endDate: koreanCalendarDate(),
          })
          .then((page) => {
            for (const filing of page.items) {
              const providerItemId = filing.providerFilingId;
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
                  filing.stockCode === null
                    ? []
                    : [`KRX:${filing.stockCode}`],
                payloadHash: payloadHash(filing),
              });
            }
            sources.push({
              provider: "OPEN_DART",
              state: "READY",
              itemCount: page.items.length,
              message: `오늘 OpenDART 공시 ${page.items.length}건 수신`,
            });
            this.#information.saveCheckpoint(
              "OPEN_DART",
              {
                providerDate: koreanCalendarDate(),
                page: page.page,
                totalPages: page.totalPages,
              },
              page.obtainedAt,
            );
          })
          .catch(() => {
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

    const items = this.#information.listRecent({ limit: 200 }).map((item) => ({
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
    const readyCount = sources.filter((source) => source.state === "READY").length;
    const errorCount = sources.filter((source) => source.state === "ERROR").length;
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
      sources,
      fetchedAt: now,
      statusMessage: `${readyCount}개 provider 연결 · 로컬 저장 ${items.length}건`,
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
    const dataEnvironment = readOnlyMarketDataEnvironment(config);
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

    this.#setChart({
      schemaVersion: 1,
      instrumentId: `KRX:${symbol}`,
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
    });

    try {
      const auth = this.#authClient(dataEnvironment, credentials);
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
      const failed: DesktopChartProjection = {
        schemaVersion: 1,
        instrumentId: `KRX:${symbol}`,
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
    if (this.#stream !== null) {
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
    if (
      typeof rawSymbol !== "string" ||
      !/^[0-9A-Z]{6,7}$/.test(rawSymbol)
    ) {
      throw new Error("Unsupported domestic instrument symbol");
    }
    const selectionGeneration = this.#marketConnectionGeneration + 1;
    await this.disconnectMarket();
    if (this.#marketConnectionGeneration !== selectionGeneration) {
      return this.#market;
    }
    this.#symbol = rawSymbol;
    this.#chartCache.clear();
    this.#chartRequests.clear();
    this.#marketSequence = 0n;
    this.#lastProcessedTradeIdentity = null;
    this.#lastOrderBookSnapshotWriteAt = 0;
    this.#setMarket(initialMarket(rawSymbol));
    this.#setChart(initialChart(rawSymbol));
    return this.connectMarketReadOnly();
  }

  async #connectMarketReadOnly(
    symbol: string,
    generation: number,
  ): Promise<DesktopMarketProjection> {
    const isCurrentConnection = () =>
      this.#symbol === symbol &&
      this.#marketConnectionGeneration === generation;
    const config = loadRuntimeConfig();
    const dataEnvironment = readOnlyMarketDataEnvironment(config);
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
      const displayedBids = hasRestOrderBook
        ? orderBook.bids
        : (restoredOrderBook?.bids ?? []);
      const displayedAsks = hasRestOrderBook
        ? orderBook.asks
        : (restoredOrderBook?.asks ?? []);
      const displayedProviderTime = hasRestOrderBook
        ? orderBook.providerTime
        : (restoredOrderBook?.providerTime ?? null);
      this.#marketSequence += 1n;
      this.#setMarket({
        ...this.#market,
        mode: "KIS_READ_ONLY",
        price: quote.price,
        change: quote.change,
        changeRate: quote.changeRate,
        executionStrength: null,
        cumulativeVolume: quote.cumulativeVolume,
        cumulativeTurnover: quote.cumulativeTurnover,
        openPrice: quote.openPrice,
        highPrice: quote.highPrice,
        lowPrice: quote.lowPrice,
        bids: displayedBids,
        asks: displayedAsks,
        totalBidQuantity: hasRestOrderBook
          ? orderBook.totalBidQuantity
          : (restoredOrderBook?.totalBidQuantity ?? null),
        totalAskQuantity: hasRestOrderBook
          ? orderBook.totalAskQuantity
          : (restoredOrderBook?.totalAskQuantity ?? null),
        providerTime: displayedProviderTime,
        orderBookReceivedAt: hasRestOrderBook
          ? orderBook.receivedAt
          : (restoredOrderBook?.providerReceivedAt ?? null),
        orderBookOccurredAt: null,
        session: domesticSessionFromProviderTime(displayedProviderTime ?? ""),
        freshness: "stale",
        receivedAt: quote.receivedAt,
        sequence: this.#marketSequence.toString(),
        statusMessage: hasRestOrderBook
          ? "KIS REST 실제 호가 10단계 · WebSocket 실시간 갱신 대기"
          : restoredOrderBook !== null
            ? `SQLite 최종 실제 호가 · ${restoredOrderBook.providerReceivedAt} · WebSocket 갱신 대기`
            : "KIS 현재가 수신 · 장외 빈 호가 · 저장된 최종 실제 호가 없음",
      });

      const stream = new DomesticKisLiveStream({
        environment: dataEnvironment,
        approvalKey,
        symbol,
        onProjection: (projection) => {
          if (isCurrentConnection()) {
            this.applyReadOnlyMarketProjection(projection);
          }
        },
      });
      this.#stream = stream;
      await stream.start();
      if (!isCurrentConnection()) {
        if (this.#stream === stream) this.#stream = null;
        await stream.stop();
      }
      return this.#market;
    } catch (error) {
      if (!isCurrentConnection()) return this.#market;
      this.#stream = null;
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
    const stream = this.#stream;
    this.#stream = null;
    if (stream !== null) {
      await stream.stop();
    }
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
      venue: "KRX",
      currency: "KRW",
      side: request.side,
      orderType: request.orderType,
      quantity: request.quantity,
      limitPrice: request.limitPrice,
      timeInForce: "DAY",
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
      policy: desktopPaperPolicy(),
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
    if (
      liveBook !== null &&
      liveBook.providerTime !== null &&
      liveBook.providerTime !== "000000" &&
      projection.lastOrderBookReceivedAt !== null &&
      liveBook.bids.length + liveBook.asks.length > 0 &&
      Date.now() - this.#lastOrderBookSnapshotWriteAt >= 1_000
    ) {
      this.#marketSnapshots.saveDomesticOrderBook({
        instrumentId: liveBook.instrumentId,
        venue: "KRX",
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
    if (existing !== undefined) return;
    const now = new Date().toISOString();
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

  #accountProjection(): DesktopAccountProjection {
    const summary: PaperAccountSummary =
      this.#papers.getAccountSummary(ACCOUNT_ID);
    const cash =
      summary.cashBalances.find(
        (balance) => balance.currency === summary.baseCurrency,
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
      baseCurrency: summary.baseCurrency,
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
      currency: "KRW",
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
        policy: desktopPaperPolicy(),
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
        policy: desktopPaperPolicy(),
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
        policy: desktopPaperPolicy(),
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
      currency: "KRW",
      freshness: "LIVE",
      receivedAt: this.#market.orderBookReceivedAt ?? receivedAt,
      tradingPhase:
        this.#market.session === "REGULAR"
          ? "REGULAR_CONTINUOUS"
          : "CLOSED",
      sessionKey: `KRX:${providerDate}:REGULAR`,
      snapshot: {
        instrumentId: this.#market.instrumentId,
        venue: "KRX",
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
    const limit = BigInt(order.limitPrice ?? "0");
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
      (sum, fill) => sum + krwDecimalToMinor(fill.grossNotional),
      0n,
    );
    const fee = ceilRate(gross, FEE_RATE_PPM);
    const tax = order.side === "SELL" ? ceilRate(gross, SELL_TAX_RATE_PPM) : 0n;
    const base = commitId;
    const entries: CashLedgerEntryInput[] = [
      {
        id: `${base}:principal`,
        accountId: order.accountId,
        currency: "KRW",
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
        currency: "KRW",
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
        currency: "KRW",
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
    this.#market = projection;
    this.#emitMarket(projection);
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
