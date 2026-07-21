import {
  MarketCalendarEventSchema,
  type MarketCalendarEvent,
} from "../../../../src/contracts/market-calendar.js";

export type DesktopMarketMode = "FIXTURE" | "KIS_READ_ONLY";

export interface DesktopMarketCalendarProjection {
  readonly schemaVersion: 1;
  readonly state: "LOADING" | "READY" | "PARTIAL" | "ERROR";
  readonly events: readonly MarketCalendarEvent[];
  readonly sources: readonly DesktopMarketCalendarSourceProjection[];
  readonly fetchedAt: string | null;
  readonly source: "FIXTURE" | "PROVIDER";
  readonly statusMessage: string;
}

export interface DesktopMarketCalendarSourceProjection {
  readonly provider: MarketCalendarEvent["provider"];
  readonly state: "READY" | "UNCONFIGURED" | "UNSUPPORTED" | "ERROR";
  readonly itemCount: number;
  readonly insertedCount: number;
  readonly dataQuality: MarketCalendarEvent["dataQuality"] | null;
  readonly fetchedAt: string | null;
  readonly message: string;
}

export type DesktopConnectionState =
  "DISABLED" | "CONNECTING" | "LIVE" | "STALE" | "OFFLINE" | "ERROR";
export type DesktopFreshness = "live" | "delayed" | "stale" | "offline";
export type DesktopMarketSession =
  | "PRE"
  | "REGULAR"
  | "AFTER"
  | "CLOSED"
  | "UNKNOWN";

export interface DesktopOrderBookLevel {
  readonly price: string;
  readonly quantity: string;
}

export interface DesktopMarketProjection {
  readonly schemaVersion: 1;
  readonly instrumentId: string;
  readonly symbol: string;
  readonly venue: string;
  readonly currency: string;
  readonly mode: DesktopMarketMode;
  readonly connectionState: DesktopConnectionState;
  readonly freshness: DesktopFreshness;
  readonly session: DesktopMarketSession;
  readonly price: string | null;
  readonly change: string | null;
  readonly changeRate: string | null;
  readonly executionStrength: string | null;
  readonly cumulativeVolume: string | null;
  readonly cumulativeTurnover: string | null;
  readonly openPrice: string | null;
  readonly highPrice: string | null;
  readonly lowPrice: string | null;
  readonly bids: readonly DesktopOrderBookLevel[];
  readonly asks: readonly DesktopOrderBookLevel[];
  readonly totalBidQuantity: string | null;
  readonly totalAskQuantity: string | null;
  readonly providerTime: string | null;
  readonly receivedAt: string | null;
  readonly orderBookReceivedAt: string | null;
  readonly tradeReceivedAt: string | null;
  readonly orderBookOccurredAt: string | null;
  readonly tradeOccurredAt: string | null;
  readonly sequence: string;
  readonly statusMessage: string;
}

export interface DesktopWatchlistQuoteProjection {
  readonly instrumentId: string;
  readonly price: string;
  readonly changeRate: string;
  readonly cumulativeTurnover: string;
  readonly receivedAt: string;
}

export interface DesktopPositionProjection {
  readonly instrumentId: string;
  readonly quantity: string;
  readonly averagePrice: string | null;
}

export interface DesktopPaperFillProjection {
  readonly fillId: string;
  readonly clientOrderId: string;
  readonly instrumentId: string;
  readonly side: "BUY" | "SELL";
  readonly price: string;
  readonly quantity: string;
  readonly filledAt: string;
  readonly completion: "PARTIAL" | "FULL";
}

export interface DesktopOpenPaperOrderProjection {
  readonly clientOrderId: string;
  readonly instrumentId: string;
  readonly side: "BUY" | "SELL";
  readonly limitPrice: string;
  readonly remainingQuantity: string;
  readonly status: "ACCEPTED" | "RESTING" | "PARTIALLY_FILLED";
}

export interface DesktopAccountProjection {
  readonly schemaVersion: 1;
  readonly accountId: string;
  readonly displayName: string;
  readonly baseCurrency: string;
  readonly cashMinor: string;
  readonly storageState: "READY" | "ERROR";
  readonly simulationProfile:
    | "INITIAL_CONSERVATIVE_V1"
    | "ADVANCED_QUEUE_V1";
  readonly queuePositionQuality: "NOT_APPLICABLE" | "QUEUE_ESTIMATED";
  readonly queueSafetyFactor: string | null;
  readonly positions: readonly DesktopPositionProjection[];
  readonly fills: readonly DesktopPaperFillProjection[];
  readonly openOrders?: readonly DesktopOpenPaperOrderProjection[];
  readonly statusMessage: string;
}

export type DesktopChartInterval =
  | "1m"
  | "5m"
  | "15m"
  | "30m"
  | "60m"
  | "4h"
  | "1d"
  | "1w";
export type DesktopChartRange = "1D" | "6M" | "1Y" | "5Y";
export type DesktopChartState =
  | "DISABLED"
  | "LOADING"
  | "READY"
  | "ERROR";

export interface DesktopChartCandleProjection {
  readonly id: string;
  readonly openedAt: string;
  readonly closedAt: string;
  readonly open: string;
  readonly high: string;
  readonly low: string;
  readonly close: string;
  readonly volume: string | null;
  readonly turnover: string | null;
  readonly forming: boolean;
}

export interface DesktopChartProjection {
  readonly schemaVersion: 1;
  readonly instrumentId: string;
  readonly interval: DesktopChartInterval;
  readonly range: DesktopChartRange;
  readonly state: DesktopChartState;
  readonly candles: readonly DesktopChartCandleProjection[];
  readonly source: "FIXTURE" | "KIS_REST" | "KIS_REST_AGGREGATED";
  readonly turnoverQuality:
    | "PROVIDER_REPORTED"
    | "LOCAL_TRADE_AGGREGATE"
    | "UNAVAILABLE";
  readonly paginationComplete: boolean;
  readonly fetchedAt: string | null;
  readonly statusMessage: string;
}

export type DesktopRankingSort =
  | "AVERAGE_VOLUME"
  | "VOLUME_INCREASE"
  | "TURNOVER"
  | "CHANGE_RATE_GAINERS"
  | "CHANGE_RATE_LOSERS";

export interface DesktopRankingItemProjection {
  readonly rank: string;
  readonly instrumentId: string;
  readonly symbol: string;
  readonly name: string;
  readonly price: string;
  readonly change: string;
  readonly changeRate: string;
  readonly cumulativeVolume: string;
  readonly previousVolume: string | null;
  readonly averageVolume: string | null;
  readonly volumeIncreaseRate: string | null;
  readonly volumeTurnoverRate: string | null;
  readonly averageTurnover: string | null;
  readonly turnoverTurnoverRate: string | null;
  readonly cumulativeTurnover: string | null;
}

export interface DesktopRankingProjection {
  readonly schemaVersion: 1;
  readonly market: "KRX" | "US";
  readonly sort: DesktopRankingSort;
  readonly state: "DISABLED" | "LOADING" | "READY" | "ERROR";
  readonly items: readonly DesktopRankingItemProjection[];
  readonly source: "KIS_REST" | "KRX_OPENAPI";
  readonly fetchedAt: string | null;
  readonly statusMessage: string;
}

export type DesktopInvestorFlowParticipant =
  | "INDIVIDUAL"
  | "FOREIGN"
  | "INSTITUTION"
  | "PROGRAM";

export interface DesktopInvestorFlowValueProjection {
  readonly participant: DesktopInvestorFlowParticipant;
  readonly sellQuantity: string;
  readonly buyQuantity: string;
  readonly netBuyQuantity: string;
  readonly sellAmount: string;
  readonly buyAmount: string;
  readonly netBuyAmount: string;
}

export interface DesktopInstrumentInvestorFlowProjection {
  readonly instrumentId: string;
  readonly symbol: string;
  readonly name: string;
  readonly market: "KOSPI" | "KOSDAQ";
  readonly currency: "KRW";
  readonly investorSummary: {
    readonly businessDate: string;
    readonly quality: "PROVIDER_REPORTED_AFTER_CLOSE";
    readonly participants: readonly DesktopInvestorFlowValueProjection[];
  } | null;
  readonly programSummary: {
    readonly providerTime: string;
    readonly quality: "PROVIDER_REPORTED_FORMING_CUMULATIVE";
    readonly participant: DesktopInvestorFlowValueProjection;
  } | null;
  readonly statusMessage: string;
}

export interface DesktopMarketInvestorFlowProjection {
  readonly market: "ALL" | "KOSPI" | "KOSDAQ";
  readonly currency: "KRW";
  readonly providerTimestamp: null;
  readonly quality: "PROVIDER_REPORTED_SNAPSHOT_FINALITY_UNKNOWN";
  readonly participants: readonly DesktopInvestorFlowValueProjection[];
  readonly statusMessage: string;
}

export interface DesktopInvestorFlowProjection {
  readonly schemaVersion: 1;
  readonly state:
    | "LOADING"
    | "READY"
    | "PARTIAL"
    | "UNAVAILABLE"
    | "ERROR";
  readonly source: "KIS_REST" | "KRX_OPENAPI" | "KRX_DATA_PRODUCT";
  readonly instrument: DesktopInstrumentInvestorFlowProjection | null;
  readonly markets: readonly DesktopMarketInvestorFlowProjection[];
  readonly fetchedAt: string | null;
  readonly statusMessage: string;
}

export interface DesktopShortSellingProjection {
  readonly schemaVersion: 1;
  readonly state:
    | "LOADING"
    | "READY"
    | "PARTIAL"
    | "UNAVAILABLE"
    | "ERROR";
  readonly source: "KRX_DATA_PRODUCT" | "UNSUPPORTED";
  readonly instrumentId: string;
  readonly symbol: string;
  readonly marketScope: "KR" | "US";
  readonly fetchedAt: string | null;
  readonly trade: {
    readonly businessDate: string;
    readonly shortSellVolume: string;
    readonly shortSellTurnover: string;
    readonly shortSellRatio: string;
  } | null;
  readonly balance: {
    readonly businessDate: string;
    readonly shortBalanceQuantity: string;
    readonly shortBalanceTurnover: string;
    readonly shortBalanceRatio: string;
  } | null;
  readonly lendingBalance: {
    readonly businessDate: string;
    readonly balanceQuantity: string;
    readonly balanceTurnover: string;
  } | null;
  readonly statusMessage: string;
}

export interface DesktopInstrumentSearchItemProjection {
  readonly instrumentId: string;
  readonly symbol: string;
  readonly standardCode: string;
  readonly name: string;
  readonly market: "KOSPI" | "KOSDAQ" | "NASDAQ" | "NYSE" | "AMEX";
  readonly securityType: "STOCK" | "ETF" | "ETN" | "OTHER";
}

export interface DesktopInstrumentSearchProjection {
  readonly schemaVersion: 1;
  readonly query: string;
  readonly state: "READY" | "ERROR";
  readonly items: readonly DesktopInstrumentSearchItemProjection[];
  readonly source: "KIS_MASTER" | "CACHED_KIS_MASTER";
  readonly stale: boolean;
  readonly fetchedAt: string | null;
  readonly statusMessage: string;
}

export function isSearchableDomesticInstrumentQuery(
  value: unknown,
): value is string {
  if (typeof value !== "string") return false;
  const query = value.trim().normalize("NFKC");
  if (query.length === 0 || query.length > 40) return false;
  if (/[\u1100-\u11ff\u3130-\u318f]/u.test(query)) return false;
  return query.length > 1 || /[\uac00-\ud7a30-9]/u.test(query);
}

export function isSearchableUsInstrumentQuery(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const query = value.trim().normalize("NFKC");
  return query.length >= 1 && query.length <= 40 && !/[\u0000-\u001f\u007f]/u.test(query);
}

export type DesktopMarketContextRepresentation =
  | "OFFICIAL_INDEX"
  | "ETF_PROXY"
  | "ACTUAL_FUTURE";
export type DesktopMarketContextAssetClass =
  | "INDEX_SPOT"
  | "ETF_PROXY"
  | "INDEX_FUTURE"
  | "COMMODITY_FUTURE";
export type DesktopMarketContextTransport =
  | "REST_POLLING"
  | "WEBSOCKET"
  | "NONE";
export type DesktopMarketContextDataQuality =
  | "OFFICIAL_SNAPSHOT"
  | "PROXY_SNAPSHOT"
  | "UNAVAILABLE";
export type DesktopMarketContextEntitlement =
  | "AUTHORIZED"
  | "REQUIRED"
  | "UNKNOWN";
export type DesktopMarketContextFreshness =
  | "DELAYED_OR_POLLING"
  | "STALE"
  | "UNAVAILABLE";

export interface DesktopMarketContextItemProjection {
  readonly id: string;
  readonly label: string;
  readonly instrumentId: string;
  readonly assetClass: DesktopMarketContextAssetClass;
  readonly representation: DesktopMarketContextRepresentation;
  readonly canonicalVenue: "KRX" | "NASDAQ" | "NYSEARCA" | "CME";
  readonly currency: "KRW" | "USD";
  readonly tradable: false;
  readonly price: string | null;
  readonly change: string | null;
  readonly changeRate: string | null;
  readonly transport: DesktopMarketContextTransport;
  readonly dataQuality: DesktopMarketContextDataQuality;
  readonly entitlement: DesktopMarketContextEntitlement;
  readonly freshness: DesktopMarketContextFreshness;
  readonly session: DesktopMarketSession;
  readonly provider: "KIS" | "UNAVAILABLE";
  readonly occurredAt: string | null;
  readonly receivedAt: string | null;
  readonly proxyDisclosure: string | null;
  readonly statusMessage: string;
}

export interface DesktopMarketContextProjection {
  readonly schemaVersion: 1;
  readonly state: "LOADING" | "READY" | "PARTIAL" | "ERROR";
  readonly items: readonly DesktopMarketContextItemProjection[];
  readonly fetchedAt: string | null;
  readonly statusMessage: string;
}

export interface DesktopInformationItemProjection {
  readonly id: string;
  readonly provider:
    | "KIS_DOMESTIC_NEWS"
    | "KIS_OVERSEAS_NEWS"
    | "FINNHUB_NEWS"
    | "SEC_EDGAR"
    | "OPEN_DART";
  readonly kind: "NEWS" | "DISCLOSURE";
  readonly titleOriginal: string;
  readonly titleKorean: string | null;
  readonly summaryKorean: string | null;
  readonly sourceName: string;
  readonly sourceLanguage: string;
  readonly publishedAt: string;
  readonly publishedAtPrecision: "SECOND" | "DATE";
  readonly obtainedAt: string;
  readonly canonicalUrl: string | null;
  readonly rights: "KIS_HEADLINE_ONLY" | "PUBLIC_FILING" | "PROVIDER_LINK_SUMMARY";
  readonly relatedInstrumentIds: readonly string[];
}

export interface DesktopInformationSourceProjection {
  readonly provider:
    | "KIS_DOMESTIC_NEWS"
    | "KIS_OVERSEAS_NEWS"
    | "FINNHUB_NEWS"
    | "SEC_EDGAR"
    | "OPEN_DART";
  readonly state: "READY" | "UNCONFIGURED" | "ERROR";
  readonly itemCount: number;
  readonly message: string;
}

export interface DesktopInformationFeedProjection {
  readonly schemaVersion: 1;
  readonly state: "LOADING" | "READY" | "PARTIAL" | "ERROR";
  readonly items: readonly DesktopInformationItemProjection[];
  readonly sources: readonly DesktopInformationSourceProjection[];
  readonly fetchedAt: string | null;
  readonly statusMessage: string;
}

export function isCurrentDesktopRankingResponse(input: {
  readonly requestSequence: number;
  readonly currentSequence: number;
  readonly requestedSort: DesktopRankingSort;
  readonly responseSort: DesktopRankingSort;
}): boolean {
  return (
    input.requestSequence === input.currentSequence &&
    input.requestedSort === input.responseSort
  );
}

export interface DesktopBootstrapProjection {
  readonly schemaVersion: 1;
  readonly market: DesktopMarketProjection;
  readonly account: DesktopAccountProjection;
  readonly chart: DesktopChartProjection;
  readonly actualOrderCapability: "FORBIDDEN";
}

export interface DesktopPaperOrderRequest {
  readonly requestId: string;
  readonly instrumentId: string;
  readonly side: "BUY" | "SELL";
  readonly orderType: "MARKET" | "LIMIT";
  readonly quantity: string;
  readonly limitPrice: string | null;
}

export interface DesktopPaperOrderResult {
  readonly schemaVersion: 1;
  readonly requestId: string;
  readonly accepted: boolean;
  readonly status:
    | "FILLED"
    | "PARTIALLY_FILLED"
    | "PARTIALLY_FILLED_CANCELLED"
    | "RESTING"
    | "CANCELLED"
    | "REJECTED";
  readonly rejectionCode: string | null;
  readonly account: DesktopAccountProjection;
  readonly market: DesktopMarketProjection;
}

export const DESKTOP_CHANNELS = Object.freeze({
  appMetadata: "papertrading:app:get-metadata",
  bootstrapGet: "papertrading:bootstrap:get",
  marketConnect: "papertrading:market:connect-readonly",
  marketDisconnect: "papertrading:market:disconnect",
  marketSelectInstrument: "papertrading:market:select-instrument",
  watchlistQuotesGet: "papertrading:watchlist-quotes:get",
  marketProjection: "papertrading:market:projection",
  accountProjection: "papertrading:account:projection",
  chartGetHistory: "papertrading:chart:get-history",
  chartProjection: "papertrading:chart:projection",
  rankingGet: "papertrading:ranking:get",
  investorFlowGet: "papertrading:investor-flow:get",
  shortSellingGet: "papertrading:short-selling:get",
  instrumentSearch: "papertrading:instrument:search",
  marketContextGet: "papertrading:market-context:get",
  marketCalendarGet: "papertrading:market-calendar:get",
  informationGet: "papertrading:information:get",
  informationOpenExternal: "papertrading:information:open-external",
  paperSubmit: "papertrading:paper:submit",
} as const);

export function isAllowedExternalInformationUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2_048) return false;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.port === "" &&
      (hostname === "sec.gov" ||
        hostname.endsWith(".sec.gov") ||
        hostname === "dart.fss.or.kr" ||
        hostname === "opendart.fss.or.kr")
    );
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isUnsignedInteger(value: unknown, positive = false): value is string {
  return (
    typeof value === "string" &&
    (positive ? /^[1-9]\d*$/.test(value) : /^(?:0|[1-9]\d*)$/.test(value))
  );
}

function isUnsignedDecimal(value: unknown, positive = false): value is string {
  return (
    typeof value === "string" &&
    (positive
      ? /^(?=.*[1-9])\d+(?:\.\d+)?$/.test(value)
      : /^\d+(?:\.\d+)?$/.test(value))
  );
}

function compareUnsignedDecimals(left: string, right: string): number {
  const [leftWhole = "0", leftFraction = ""] = left.split(".");
  const [rightWhole = "0", rightFraction = ""] = right.split(".");
  const scale = Math.max(leftFraction.length, rightFraction.length);
  const leftScaled = BigInt(`${leftWhole}${leftFraction.padEnd(scale, "0")}`);
  const rightScaled = BigInt(`${rightWhole}${rightFraction.padEnd(scale, "0")}`);
  return leftScaled < rightScaled ? -1 : leftScaled > rightScaled ? 1 : 0;
}

function isIsoInstant(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

export function isDesktopChartProjection(
  value: unknown,
): value is DesktopChartProjection {
  if (!isRecord(value)) return false;
  const instrumentId = value["instrumentId"];
  const interval = value["interval"];
  const range = value["range"];
  const candles = value["candles"];
  if (
    value["schemaVersion"] !== 1 ||
    typeof instrumentId !== "string" ||
    !/^(?:KRX:[0-9A-Z]{6,7}|(?:NASDAQ|NYSE|AMEX):[A-Z0-9.\-]{1,20})$/.test(instrumentId) ||
    !["1m", "5m", "15m", "30m", "60m", "4h", "1d", "1w"].includes(
      String(interval),
    ) ||
    !["1D", "6M", "1Y", "5Y"].includes(String(range)) ||
    (instrumentId.startsWith("KRX:") && ["1m", "5m", "15m", "30m", "60m", "4h"].includes(
      String(interval),
    ) &&
      range !== "1D") ||
    (["1d", "1w"].includes(String(interval)) && range === "1D") ||
    !["DISABLED", "LOADING", "READY", "ERROR"].includes(
      String(value["state"]),
    ) ||
    !Array.isArray(candles) ||
    candles.length > 2_000 ||
    !["FIXTURE", "KIS_REST", "KIS_REST_AGGREGATED"].includes(
      String(value["source"]),
    ) ||
    (value["state"] === "READY" && value["source"] === "FIXTURE") ||
    (value["turnoverQuality"] !== "PROVIDER_REPORTED" &&
      value["turnoverQuality"] !== "LOCAL_TRADE_AGGREGATE" &&
      value["turnoverQuality"] !== "UNAVAILABLE") ||
    (instrumentId.startsWith("KRX:") && ["1m", "5m", "15m", "30m", "60m", "4h"].includes(
      String(interval),
    ) &&
      value["turnoverQuality"] !== "UNAVAILABLE") ||
    typeof value["paginationComplete"] !== "boolean" ||
    (value["fetchedAt"] !== null && !isIsoInstant(value["fetchedAt"])) ||
    (value["state"] === "READY" && !isIsoInstant(value["fetchedAt"])) ||
    typeof value["statusMessage"] !== "string"
  ) {
    return false;
  }
  return candles.every((candle) => {
    if (!isRecord(candle)) return false;
    const openedAt = candle["openedAt"];
    const closedAt = candle["closedAt"];
    if (
      !isIsoInstant(openedAt) ||
      !isIsoInstant(closedAt) ||
      Date.parse(openedAt) >= Date.parse(closedAt) ||
      candle["id"] !== `${instrumentId}:${interval}:${openedAt}` ||
      !isUnsignedDecimal(candle["open"], true) ||
      !isUnsignedDecimal(candle["high"], true) ||
      !isUnsignedDecimal(candle["low"], true) ||
      !isUnsignedDecimal(candle["close"], true) ||
      (candle["volume"] !== null &&
        !isUnsignedDecimal(candle["volume"])) ||
      (candle["turnover"] !== null &&
        !isUnsignedDecimal(candle["turnover"])) ||
      (instrumentId.startsWith("KRX:") && ["1m", "5m", "15m", "30m", "60m", "4h"].includes(
        String(interval),
      ) &&
        candle["turnover"] !== null) ||
      typeof candle["forming"] !== "boolean"
    ) {
      return false;
    }
    const open = candle["open"];
    const high = candle["high"];
    const low = candle["low"];
    const close = candle["close"];
    return compareUnsignedDecimals(low, open) <= 0 &&
      compareUnsignedDecimals(low, close) <= 0 &&
      compareUnsignedDecimals(high, open) >= 0 &&
      compareUnsignedDecimals(high, close) >= 0;
  });
}

export function isDesktopRankingProjection(
  value: unknown,
): value is DesktopRankingProjection {
  if (!isRecord(value) || !Array.isArray(value["items"])) return false;
  if (
    value["schemaVersion"] !== 1 ||
    !["KRX", "US"].includes(String(value["market"])) ||
    ![
      "AVERAGE_VOLUME",
      "VOLUME_INCREASE",
      "TURNOVER",
      "CHANGE_RATE_GAINERS",
      "CHANGE_RATE_LOSERS",
    ].includes(
      String(value["sort"]),
    ) ||
    !["DISABLED", "LOADING", "READY", "ERROR"].includes(
      String(value["state"]),
    ) ||
    !["KIS_REST", "KRX_OPENAPI"].includes(String(value["source"])) ||
    (value["fetchedAt"] !== null && !isIsoInstant(value["fetchedAt"])) ||
    (value["state"] === "READY" && !isIsoInstant(value["fetchedAt"])) ||
    typeof value["statusMessage"] !== "string" ||
    value["items"].length > 100
  ) {
    return false;
  }
  const isUs = value["market"] === "US";
  return value["items"].every(
    (item) =>
      isRecord(item) &&
      typeof item["rank"] === "string" &&
      (isUs ? /^(NASDAQ|NYSE|AMEX):[A-Z0-9.-]{1,20}$/.test(String(item["instrumentId"])) : /^KRX:[0-9A-Z]{6,7}$/.test(String(item["instrumentId"]))) &&
      (isUs ? /^[A-Z0-9.-]{1,20}$/.test(String(item["symbol"])) : /^[0-9A-Z]{6,7}$/.test(String(item["symbol"]))) &&
      (isUs || item["instrumentId"] === `KRX:${String(item["symbol"])}`) &&
      typeof item["name"] === "string" &&
      (isUs ? isUnsignedDecimal(item["price"], true) : isUnsignedInteger(item["price"], true)) &&
      typeof item["change"] === "string" &&
      typeof item["changeRate"] === "string" &&
      (isUs ? isUnsignedDecimal(item["cumulativeVolume"]) : isUnsignedInteger(item["cumulativeVolume"])) &&
      isStringOrNull(item["previousVolume"]) &&
      isStringOrNull(item["averageVolume"]) &&
      isStringOrNull(item["volumeIncreaseRate"]) &&
      isStringOrNull(item["volumeTurnoverRate"]) &&
      isStringOrNull(item["averageTurnover"]) &&
      isStringOrNull(item["turnoverTurnoverRate"]) &&
      isStringOrNull(item["cumulativeTurnover"]) &&
      (item["cumulativeTurnover"] === null ||
        (isUs ? isUnsignedDecimal(item["cumulativeTurnover"]) : isUnsignedInteger(item["cumulativeTurnover"]))),
  );
}

const signedIntegerPattern = /^(?:0|[+-]?[1-9]\d*)$/;

function isInvestorFlowValue(
  value: unknown,
  expectedParticipant: DesktopInvestorFlowParticipant,
): value is DesktopInvestorFlowValueProjection {
  if (!isRecord(value) || value["participant"] !== expectedParticipant) {
    return false;
  }
  const sellQuantity = value["sellQuantity"];
  const buyQuantity = value["buyQuantity"];
  const netBuyQuantity = value["netBuyQuantity"];
  const sellAmount = value["sellAmount"];
  const buyAmount = value["buyAmount"];
  const netBuyAmount = value["netBuyAmount"];
  if (
    !isUnsignedInteger(sellQuantity) ||
    sellQuantity.length > 40 ||
    !isUnsignedInteger(buyQuantity) ||
    buyQuantity.length > 40 ||
    typeof netBuyQuantity !== "string" ||
    netBuyQuantity.length > 41 ||
    !signedIntegerPattern.test(netBuyQuantity) ||
    !isUnsignedInteger(sellAmount) ||
    sellAmount.length > 40 ||
    !isUnsignedInteger(buyAmount) ||
    buyAmount.length > 40 ||
    typeof netBuyAmount !== "string" ||
    netBuyAmount.length > 41 ||
    !signedIntegerPattern.test(netBuyAmount)
  ) {
    return false;
  }
  return (
    BigInt(buyQuantity) - BigInt(sellQuantity) === BigInt(netBuyQuantity) &&
    BigInt(buyAmount) - BigInt(sellAmount) === BigInt(netBuyAmount)
  );
}

function hasExactInvestorParticipants(
  value: unknown,
  expected: readonly DesktopInvestorFlowParticipant[],
): value is readonly DesktopInvestorFlowValueProjection[] {
  if (!Array.isArray(value) || value.length !== expected.length) return false;
  const byParticipant = new Map(
    value.map((item) =>
      isRecord(item) && typeof item["participant"] === "string"
        ? [item["participant"], item]
        : ["", item],
    ),
  );
  return (
    byParticipant.size === expected.length &&
    expected.every((participant) =>
      isInvestorFlowValue(byParticipant.get(participant), participant),
    )
  );
}

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const instant = Date.parse(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(instant) &&
    new Date(instant).toISOString().slice(0, 10) === value
  );
}

function isProviderClockTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{2}):(\d{2}):(\d{2})$/.exec(value);
  return (
    match !== null &&
    Number(match[1]) <= 23 &&
    Number(match[2]) <= 59 &&
    Number(match[3]) <= 59
  );
}

export function isDesktopInvestorFlowProjection(
  value: unknown,
): value is DesktopInvestorFlowProjection {
  if (
    !isRecord(value) ||
    value["schemaVersion"] !== 1 ||
    !["LOADING", "READY", "PARTIAL", "UNAVAILABLE", "ERROR"].includes(
      String(value["state"]),
    ) ||
    !["KIS_REST", "KRX_OPENAPI", "KRX_DATA_PRODUCT"].includes(
      String(value["source"]),
    ) ||
    !Array.isArray(value["markets"]) ||
    value["markets"].length > 2 ||
    (value["fetchedAt"] !== null && !isIsoInstant(value["fetchedAt"])) ||
    typeof value["statusMessage"] !== "string"
  ) {
    return false;
  }

  const instrument = value["instrument"];
  if (instrument !== null) {
    if (!isRecord(instrument)) return false;
    const symbol = instrument["symbol"];
    const investorSummary = instrument["investorSummary"];
    const programSummary = instrument["programSummary"];
    if (
      typeof symbol !== "string" ||
      !/^[0-9A-Z]{6,7}$/.test(symbol) ||
      instrument["instrumentId"] !== `KRX:${symbol}` ||
      typeof instrument["name"] !== "string" ||
      instrument["name"].length === 0 ||
      instrument["name"].length > 120 ||
      !["KOSPI", "KOSDAQ"].includes(String(instrument["market"])) ||
      instrument["currency"] !== "KRW" ||
      typeof instrument["statusMessage"] !== "string"
    ) {
      return false;
    }
    if (
      investorSummary !== null &&
      (!isRecord(investorSummary) ||
        !isCalendarDate(investorSummary["businessDate"]) ||
        investorSummary["quality"] !== "PROVIDER_REPORTED_AFTER_CLOSE" ||
        !hasExactInvestorParticipants(investorSummary["participants"], [
          "INDIVIDUAL",
          "FOREIGN",
          "INSTITUTION",
        ]))
    ) {
      return false;
    }
    if (
      programSummary !== null &&
      (!isRecord(programSummary) ||
        !isProviderClockTime(programSummary["providerTime"]) ||
        programSummary["quality"] !==
          "PROVIDER_REPORTED_FORMING_CUMULATIVE" ||
        !isInvestorFlowValue(programSummary["participant"], "PROGRAM"))
    ) {
      return false;
    }
  }

  const seenMarkets = new Set<string>();
  for (const market of value["markets"]) {
    if (!isRecord(market)) return false;
    const marketId = market["market"];
    if (
      !["ALL", "KOSPI", "KOSDAQ"].includes(String(marketId)) ||
      seenMarkets.has(String(marketId)) ||
      market["currency"] !== "KRW" ||
      market["providerTimestamp"] !== null ||
      market["quality"] !==
        "PROVIDER_REPORTED_SNAPSHOT_FINALITY_UNKNOWN" ||
      !hasExactInvestorParticipants(market["participants"], [
        "INDIVIDUAL",
        "FOREIGN",
        "INSTITUTION",
      ]) ||
      typeof market["statusMessage"] !== "string"
    ) {
      return false;
    }
    seenMarkets.add(String(marketId));
  }

  const hasData =
    (isRecord(instrument) &&
      (instrument["investorSummary"] !== null ||
        instrument["programSummary"] !== null)) ||
    value["markets"].length > 0;
  if (hasData && !isIsoInstant(value["fetchedAt"])) return false;
  if (
    value["state"] === "READY" &&
    (!isRecord(instrument) ||
      instrument["investorSummary"] === null ||
      instrument["programSummary"] === null ||
    seenMarkets.size === 0)
  ) {
    return false;
  }
  if (value["state"] === "PARTIAL" && !hasData) return false;
  if (
    value["state"] === "UNAVAILABLE" &&
    (instrument !== null || value["markets"].length !== 0 ||
      value["fetchedAt"] !== null)
  ) {
    return false;
  }
  return true;
}

function isShortSellingTrade(value: unknown): value is NonNullable<DesktopShortSellingProjection["trade"]> {
  return (
    isRecord(value) &&
    isCalendarDate(value["businessDate"]) &&
    isUnsignedInteger(value["shortSellVolume"]) &&
    isUnsignedInteger(value["shortSellTurnover"]) &&
    isUnsignedDecimal(value["shortSellRatio"])
  );
}

function isShortSellingBalance(value: unknown): value is NonNullable<DesktopShortSellingProjection["balance"]> {
  return (
    isRecord(value) &&
    isCalendarDate(value["businessDate"]) &&
    isUnsignedInteger(value["shortBalanceQuantity"]) &&
    isUnsignedInteger(value["shortBalanceTurnover"]) &&
    isUnsignedDecimal(value["shortBalanceRatio"])
  );
}

function isLendingBalance(value: unknown): value is NonNullable<DesktopShortSellingProjection["lendingBalance"]> {
  return (
    isRecord(value) &&
    isCalendarDate(value["businessDate"]) &&
    isUnsignedInteger(value["balanceQuantity"]) &&
    isUnsignedInteger(value["balanceTurnover"])
  );
}

export function isDesktopShortSellingProjection(
  value: unknown,
): value is DesktopShortSellingProjection {
  if (
    !isRecord(value) ||
    value["schemaVersion"] !== 1 ||
    !["LOADING", "READY", "PARTIAL", "UNAVAILABLE", "ERROR"].includes(
      String(value["state"]),
    ) ||
    !["KRX_DATA_PRODUCT", "UNSUPPORTED"].includes(String(value["source"])) ||
    typeof value["instrumentId"] !== "string" ||
    typeof value["symbol"] !== "string" ||
    !["KR", "US"].includes(String(value["marketScope"])) ||
    (value["fetchedAt"] !== null && !isIsoInstant(value["fetchedAt"])) ||
    typeof value["statusMessage"] !== "string"
  ) {
    return false;
  }
  if (
    value["marketScope"] === "KR" &&
    (value["instrumentId"] !== `KRX:${String(value["symbol"])}` ||
      !/^[0-9A-Z]{6,7}$/.test(String(value["symbol"])))
  ) {
    return false;
  }
  const trade = value["trade"];
  const balance = value["balance"];
  const lendingBalance = value["lendingBalance"];
  if (trade !== null && !isShortSellingTrade(trade)) return false;
  if (balance !== null && !isShortSellingBalance(balance)) return false;
  if (lendingBalance !== null && !isLendingBalance(lendingBalance)) return false;
  const hasData = trade !== null || balance !== null || lendingBalance !== null;
  if (hasData && !isIsoInstant(value["fetchedAt"])) return false;
  if (value["state"] === "READY" && trade === null) return false;
  if (value["state"] === "PARTIAL" && !hasData) return false;
  if (
    value["state"] === "UNAVAILABLE" &&
    (hasData || value["fetchedAt"] !== null || value["source"] !== "UNSUPPORTED")
  ) {
    return false;
  }
  return true;
}

export function isDesktopInstrumentSearchProjection(
  value: unknown,
): value is DesktopInstrumentSearchProjection {
  if (
    !isRecord(value) ||
    value["schemaVersion"] !== 1 ||
    (!isSearchableDomesticInstrumentQuery(value["query"]) &&
      !isSearchableUsInstrumentQuery(value["query"])) ||
    !["READY", "ERROR"].includes(String(value["state"])) ||
    !Array.isArray(value["items"]) ||
    value["items"].length > 20 ||
    !["KIS_MASTER", "CACHED_KIS_MASTER"].includes(String(value["source"])) ||
    typeof value["stale"] !== "boolean" ||
    (value["fetchedAt"] !== null && !isIsoInstant(value["fetchedAt"])) ||
    (value["state"] === "READY" && !isIsoInstant(value["fetchedAt"])) ||
    typeof value["statusMessage"] !== "string"
  ) {
    return false;
  }
  return value["items"].every(
    (item) =>
      isRecord(item) &&
      /^(?:KRX:[0-9A-Z]{6,7}|(?:NASDAQ|NYSE|AMEX):[A-Z0-9.-]{1,20})$/.test(String(item["instrumentId"])) &&
      /^[0-9A-Z.-]{1,20}$/.test(String(item["symbol"])) &&
      item["instrumentId"] === `${["KOSPI", "KOSDAQ"].includes(String(item["market"])) ? "KRX" : String(item["market"])}:${String(item["symbol"])}` &&
      typeof item["standardCode"] === "string" &&
      item["standardCode"].length > 0 &&
      item["standardCode"].length <= 20 &&
      typeof item["name"] === "string" &&
      item["name"].length > 0 &&
      item["name"].length <= 120 &&
      ["KOSPI", "KOSDAQ", "NASDAQ", "NYSE", "AMEX"].includes(String(item["market"])) &&
      ["STOCK", "ETF", "ETN", "OTHER"].includes(
        String(item["securityType"]),
      ),
  );
}

const desktopMarketContextInstrumentIdPattern =
  /^(?:KRX|NASDAQ|NYSEARCA|CME):[A-Z0-9:_-]{2,80}$/;
const decimalValuePattern = /^[+-]?\d+(?:\.\d+)?$/;

export function isDesktopMarketContextProjection(
  value: unknown,
): value is DesktopMarketContextProjection {
  if (
    !isRecord(value) ||
    value["schemaVersion"] !== 1 ||
    !["LOADING", "READY", "PARTIAL", "ERROR"].includes(
      String(value["state"]),
    ) ||
    !Array.isArray(value["items"]) ||
    value["items"].length > 24 ||
    (value["fetchedAt"] !== null && !isIsoInstant(value["fetchedAt"])) ||
    typeof value["statusMessage"] !== "string"
  ) {
    return false;
  }
  const ids = new Set<string>();
  for (const item of value["items"]) {
    if (!isRecord(item)) return false;
    const id = item["id"];
    const representation = item["representation"];
    const price = item["price"];
    const change = item["change"];
    const changeRate = item["changeRate"];
    if (
      typeof id !== "string" ||
      !/^[a-z0-9-]{2,80}$/.test(id) ||
      ids.has(id) ||
      typeof item["label"] !== "string" ||
      typeof item["instrumentId"] !== "string" ||
      !desktopMarketContextInstrumentIdPattern.test(item["instrumentId"]) ||
      !["INDEX_SPOT", "ETF_PROXY", "INDEX_FUTURE", "COMMODITY_FUTURE"].includes(
        String(item["assetClass"]),
      ) ||
      !["OFFICIAL_INDEX", "ETF_PROXY", "ACTUAL_FUTURE"].includes(
        String(representation),
      ) ||
      !["KRX", "NASDAQ", "NYSEARCA", "CME"].includes(
        String(item["canonicalVenue"]),
      ) ||
      !["KRW", "USD"].includes(String(item["currency"])) ||
      item["tradable"] !== false ||
      (price !== null &&
        (typeof price !== "string" || !decimalValuePattern.test(price))) ||
      (change !== null &&
        (typeof change !== "string" || !decimalValuePattern.test(change))) ||
      (changeRate !== null &&
        (typeof changeRate !== "string" ||
          !decimalValuePattern.test(changeRate))) ||
      !["REST_POLLING", "WEBSOCKET", "NONE"].includes(
        String(item["transport"]),
      ) ||
      !["OFFICIAL_SNAPSHOT", "PROXY_SNAPSHOT", "UNAVAILABLE"].includes(
        String(item["dataQuality"]),
      ) ||
      !["AUTHORIZED", "REQUIRED", "UNKNOWN"].includes(
        String(item["entitlement"]),
      ) ||
      !["DELAYED_OR_POLLING", "STALE", "UNAVAILABLE"].includes(
        String(item["freshness"]),
      ) ||
      !["PRE", "REGULAR", "AFTER", "CLOSED", "UNKNOWN"].includes(
        String(item["session"]),
      ) ||
      !["KIS", "UNAVAILABLE"].includes(String(item["provider"])) ||
      item["occurredAt"] !== null ||
      (item["receivedAt"] !== null && !isIsoInstant(item["receivedAt"])) ||
      (item["proxyDisclosure"] !== null &&
        typeof item["proxyDisclosure"] !== "string") ||
      typeof item["statusMessage"] !== "string"
    ) {
      return false;
    }
    if (
      representation === "ETF_PROXY" &&
      (item["dataQuality"] !== "PROXY_SNAPSHOT" ||
        typeof item["proxyDisclosure"] !== "string" ||
        item["proxyDisclosure"].length === 0)
    ) {
      return false;
    }
    if (
      (item["assetClass"] === "ETF_PROXY") !==
        (representation === "ETF_PROXY") ||
      (representation === "OFFICIAL_INDEX" &&
        item["assetClass"] !== "INDEX_SPOT") ||
      (representation === "ACTUAL_FUTURE" &&
        item["assetClass"] !== "INDEX_FUTURE" &&
        item["assetClass"] !== "COMMODITY_FUTURE")
    ) {
      return false;
    }
    if (
      representation !== "ETF_PROXY" &&
      item["proxyDisclosure"] !== null
    ) {
      return false;
    }
    if (
      item["freshness"] === "UNAVAILABLE" &&
      (price !== null ||
        change !== null ||
        changeRate !== null ||
        item["receivedAt"] !== null)
    ) {
      return false;
    }
    if (
      item["freshness"] !== "UNAVAILABLE" &&
      (price === null ||
        change === null ||
        changeRate === null ||
        item["receivedAt"] === null)
    ) {
      return false;
    }
    ids.add(id);
  }
  return true;
}

export function isDesktopMarketCalendarProjection(
  value: unknown,
): value is DesktopMarketCalendarProjection {
  if (
    !isRecord(value) ||
    value["schemaVersion"] !== 1 ||
    !["LOADING", "READY", "PARTIAL", "ERROR"].includes(
      String(value["state"]),
    ) ||
    !Array.isArray(value["events"]) ||
    value["events"].length > 1_000 ||
    !Array.isArray(value["sources"]) ||
    value["sources"].length > 24 ||
    (value["fetchedAt"] !== null && !isIsoInstant(value["fetchedAt"])) ||
    !["FIXTURE", "PROVIDER"].includes(String(value["source"])) ||
    typeof value["statusMessage"] !== "string"
  ) {
    return false;
  }
  const providers = [
    "OPEN_DART",
    "KIND_KRX",
    "KSD_RIGHTS_SCHEDULE",
    "KIS_NEWS_HEADLINE",
    "SEC_EDGAR",
    "NASDAQ_DAILY_LIST",
    "NYSE_CORPORATE_ACTIONS",
    "NASDAQ_TRADER",
    "US_FEDERAL_RESERVE",
    "US_BLS",
    "US_BEA",
    "US_EIA",
    "US_TREASURY",
    "BOK_ECOS",
    "KOSIS",
    "KOREA_MOEF",
    "KRX_DERIVATIVES",
    "CBOE",
    "CME",
    "MSCI",
    "FTSE_RUSSELL",
    "ETF_ISSUER",
    "ALPHA_VANTAGE",
    "FINANCIAL_MODELING_PREP",
    "FINNHUB",
    "LICENSED_CORPORATE_EVENTS",
    "OTHER_OFFICIAL",
    "OTHER_LICENSED",
  ];
  const dataQualities = [
    "OFFICIAL",
    "REGULATOR_EXCHANGE",
    "ISSUER_PRIMARY",
    "LICENSED",
    "AGGREGATED",
    "HEADLINE_ONLY",
    "DELAYED",
    "STALE",
    "UNSUPPORTED",
  ];
  return (
    value["events"].every((event) => {
      const parsed = MarketCalendarEventSchema.safeParse(event);
      return parsed.success;
    }) &&
    value["sources"].every(
      (source) =>
        isRecord(source) &&
        providers.includes(String(source["provider"])) &&
        ["READY", "UNCONFIGURED", "UNSUPPORTED", "ERROR"].includes(
          String(source["state"]),
        ) &&
        Number.isInteger(source["itemCount"]) &&
        Number(source["itemCount"]) >= 0 &&
        Number.isInteger(source["insertedCount"]) &&
        Number(source["insertedCount"]) >= 0 &&
        Number(source["insertedCount"]) <= Number(source["itemCount"]) &&
        (source["dataQuality"] === null ||
          dataQualities.includes(String(source["dataQuality"]))) &&
        (source["fetchedAt"] === null || isIsoInstant(source["fetchedAt"])) &&
        typeof source["message"] === "string",
    )
  );
}

export function isDesktopInformationFeedProjection(
  value: unknown,
): value is DesktopInformationFeedProjection {
  if (
    !isRecord(value) ||
    !Array.isArray(value["items"]) ||
    !Array.isArray(value["sources"])
  ) {
    return false;
  }
  const providers = [
    "KIS_DOMESTIC_NEWS",
    "KIS_OVERSEAS_NEWS",
    "FINNHUB_NEWS",
    "SEC_EDGAR",
    "OPEN_DART",
  ];
  if (
    value["schemaVersion"] !== 1 ||
    !["LOADING", "READY", "PARTIAL", "ERROR"].includes(
      String(value["state"]),
    ) ||
    value["items"].length > 500 ||
    value["sources"].length > 5 ||
    (value["fetchedAt"] !== null && !isIsoInstant(value["fetchedAt"])) ||
    typeof value["statusMessage"] !== "string"
  ) {
    return false;
  }
  return (
    value["sources"].every(
      (source) =>
        isRecord(source) &&
        providers.includes(String(source["provider"])) &&
        ["READY", "UNCONFIGURED", "ERROR"].includes(
          String(source["state"]),
        ) &&
        typeof source["itemCount"] === "number" &&
        Number.isInteger(source["itemCount"]) &&
        source["itemCount"] >= 0 &&
        typeof source["message"] === "string",
    ) &&
    value["items"].every(
      (item) =>
        isRecord(item) &&
        typeof item["id"] === "string" &&
        providers.includes(String(item["provider"])) &&
        ["NEWS", "DISCLOSURE"].includes(String(item["kind"])) &&
        typeof item["titleOriginal"] === "string" &&
        isStringOrNull(item["titleKorean"]) &&
        isStringOrNull(item["summaryKorean"]) &&
        typeof item["sourceName"] === "string" &&
        typeof item["sourceLanguage"] === "string" &&
        isIsoInstant(item["publishedAt"]) &&
        ["SECOND", "DATE"].includes(String(item["publishedAtPrecision"])) &&
        isIsoInstant(item["obtainedAt"]) &&
        (item["canonicalUrl"] === null ||
          (typeof item["canonicalUrl"] === "string" &&
            /^https:\/\//.test(item["canonicalUrl"]))) &&
        ["KIS_HEADLINE_ONLY", "PUBLIC_FILING", "PROVIDER_LINK_SUMMARY"].includes(
          String(item["rights"]),
        ) &&
        Array.isArray(item["relatedInstrumentIds"]) &&
        item["relatedInstrumentIds"].every(
          (instrumentId) => typeof instrumentId === "string",
        ),
    )
  );
}
