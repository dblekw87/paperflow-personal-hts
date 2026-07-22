import { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  Bell,
  BookOpenText,
  BriefcaseBusiness,
  CalendarDays,
  CandlestickChart,
  ChevronDown,
  CircleDollarSign,
  LayoutDashboard,
  Moon,
  Newspaper,
  Search,
  Settings,
  ShieldCheck,
  Sun,
  WalletCards,
} from "lucide-react";

import {
  InstrumentHeader,
  InvestorFlowPanel,
  MarketContextStrip,
  MarketSidebar,
  NewsPanel,
  OrderBookPanel,
  PortfolioStrip,
  ShortSellingPanel,
  ThemeLeaders,
  type OrderTicketDraft,
} from "../components/index.js";
import {
  MarketChart,
  type ChartIndicatorViewModel,
  type ChartInterval,
  type ChartRange,
  type MarketCandleViewModel,
  type PaperFillMarkerViewModel,
} from "../features/chart/MarketChart.js";
import { applyLiveTradeToCandles } from "../features/chart/live-candle-overlay.js";
import {
  buildDomesticPriceLimits,
  buildReferencePriceLadder,
  buildUsOneLevelPriceLadder,
  type DomesticEquityMarket,
  type DomesticSecurityType,
} from "../features/orderbook/reference-price-ladder.js";
import {
  ObservedTradeTapeAccumulator,
  type ObservedTradeTapeItem,
} from "../features/orderbook/observed-trade-tape.js";
import {
  LOCAL_WATCHLIST_KEY,
  readLocalWatchlist,
  type LocalWatchlistItem,
} from "../features/watchlist/local-watchlist.js";
import { useDesktopRuntime } from "../hooks/useDesktopRuntime.js";
import { formatKrwTurnoverEok } from "../lib/market-format.js";
import {
  buildLiveInformationInsights,
  buildLiveThemeLeaders,
} from "../model/live-dashboard-insights.js";
import type {
  DesktopInformationItemProjection,
  DesktopInstrumentSearchItemProjection,
  DesktopTradingPhase,
  DesktopRankingSort,
} from "../../shared/desktop-contracts.js";
import {
  isSearchableDomesticInstrumentQuery,
  isSearchableUsInstrumentQuery,
} from "../../shared/desktop-contracts.js";
import { valuePaperPosition } from "../../shared/paper-valuation.js";
import { truncateUsPrice } from "../model/price-display.js";
import type { MarketCalendarEvent } from "../../../../../src/contracts/market-calendar.js";

type ThemePreference = "system" | "dark" | "light";
type WatchlistQuoteSnapshot = {
  readonly price: string;
  readonly changeRate: string;
  readonly direction: "positive" | "negative" | "flat";
  readonly turnover: string;
  readonly freshness: "live" | "stale";
};
type WorkspacePage =
  | "DASHBOARD"
  | "RANKINGS"
  | "PORTFOLIO"
  | "ORDERS"
  | "CALENDAR"
  | "NEWS"
  | "NOTES"
  | "SECURITY"
  | "SETTINGS";

const WORKSPACE_PAGE_LABELS: Readonly<Record<WorkspacePage, string>> = {
  DASHBOARD: "시장 대시보드",
  RANKINGS: "종목 순위",
  PORTFOLIO: "포트폴리오",
  ORDERS: "주문·체결",
  CALENDAR: "이벤트 캘린더",
  NEWS: "뉴스·공시",
  NOTES: "분석 노트",
  SECURITY: "보안 상태",
  SETTINGS: "설정",
};

const INTRADAY_CHART_INTERVALS: readonly ChartInterval[] = [
  "1m",
  "5m",
  "15m",
  "30m",
  "60m",
  "4h",
];
const EMPTY_MARKET_CALENDAR_EVENTS: readonly MarketCalendarEvent[] = [];

type CalendarMarketFilter = "ALL" | "KR" | "US" | "GLOBAL";
type CalendarCategoryFilter =
  | "ALL"
  | "CORPORATE"
  | "MACRO"
  | "DERIVATIVES"
  | "REBALANCE";
type CalendarQualityFilter = "ALL" | MarketCalendarEvent["dataQuality"];
type CalendarSourceState = "READY" | "UNCONFIGURED" | "UNSUPPORTED" | "ERROR";

const CALENDAR_MARKET_LABELS: Readonly<Record<CalendarMarketFilter, string>> = {
  ALL: "전 시장",
  KR: "국내",
  US: "미국",
  GLOBAL: "글로벌",
};

const CALENDAR_CATEGORY_LABELS: Readonly<
  Record<CalendarCategoryFilter, string>
> = {
  ALL: "모든 유형",
  CORPORATE: "기업",
  MACRO: "거시",
  DERIVATIVES: "파생",
  REBALANCE: "리밸런싱",
};

const CALENDAR_QUALITY_LABELS: Readonly<Record<CalendarQualityFilter, string>> = {
  ALL: "모든 품질",
  OFFICIAL: "공식",
  REGULATOR_EXCHANGE: "거래소·규제",
  ISSUER_PRIMARY: "기업 1차",
  LICENSED: "라이선스",
  AGGREGATED: "집계",
  HEADLINE_ONLY: "제목만",
  DELAYED: "지연",
  STALE: "Stale",
  UNSUPPORTED: "미지원",
};

const CALENDAR_KIND_LABELS: Readonly<Record<MarketCalendarEvent["kind"], string>> = {
  EARNINGS: "실적",
  EARNINGS_GUIDANCE: "가이던스",
  DIVIDEND_DECLARATION: "배당 선언",
  EX_DIVIDEND: "Ex-dividend",
  DIVIDEND_RECORD_DATE: "배당 기준일",
  DIVIDEND_PAYMENT: "배당 지급",
  CAPITAL_INCREASE: "유상증자",
  BONUS_ISSUE: "무상증자",
  RIGHTS_OFFERING: "Rights",
  STOCK_SPLIT: "액면분할",
  REVERSE_SPLIT: "액면병합",
  CAPITAL_REDUCTION: "감자",
  BUYBACK: "자사주",
  MERGER_ACQUISITION: "M&A",
  SPIN_OFF: "분할",
  SHARE_EXCHANGE: "주식교환",
  TENDER_OFFER: "공개매수",
  IPO: "IPO",
  NEW_LISTING: "신규상장",
  DELISTING: "상장폐지",
  LOCKUP_RELEASE: "Lock-up",
  SHAREHOLDER_MEETING: "주주총회",
  INVESTOR_DAY: "Investor day",
  CONFERENCE_PRESENTATION: "발표",
  TRADING_HALT: "거래정지",
  REGULATORY_ACTION: "규제",
  CENTRAL_BANK_RATE_DECISION: "금리결정",
  CENTRAL_BANK_MINUTES: "의사록",
  CENTRAL_BANK_SPEECH: "중앙은행 발언",
  FOMC: "FOMC",
  MACRO_RELEASE: "경제지표",
  CPI: "CPI",
  PPI: "PPI",
  PCE: "PCE",
  GDP: "GDP",
  EMPLOYMENT: "고용",
  PMI: "PMI",
  RETAIL_SALES: "소매판매",
  TRADE_BALANCE: "무역수지",
  EIA_INVENTORY: "EIA 재고",
  TREASURY_AUCTION: "국채입찰",
  OPTIONS_EXPIRY: "옵션만기",
  FUTURES_EXPIRY: "선물만기",
  INDEX_REBALANCE: "지수 리밸런싱",
  MSCI_REBALANCE: "MSCI",
  RUSSELL_REBALANCE: "Russell",
  ETF_REBALANCE: "ETF 리밸런싱",
  OTHER_CORPORATE: "기업 이벤트",
  OTHER_MACRO: "거시 이벤트",
  OTHER_MARKET_STRUCTURE: "시장 구조",
};

const CALENDAR_PROVIDER_LABELS: Readonly<Record<MarketCalendarEvent["provider"], string>> = {
  OPEN_DART: "OpenDART",
  KIND_KRX: "KIND/KRX",
  KSD_RIGHTS_SCHEDULE: "예탁원 권리일정",
  KIS_NEWS_HEADLINE: "KIS 뉴스",
  SEC_EDGAR: "SEC EDGAR",
  NASDAQ_DAILY_LIST: "Nasdaq Daily List",
  NYSE_CORPORATE_ACTIONS: "NYSE Corporate Actions",
  NASDAQ_TRADER: "Nasdaq Trader",
  US_FEDERAL_RESERVE: "Federal Reserve",
  US_BLS: "BLS",
  US_BEA: "BEA",
  US_EIA: "EIA",
  US_TREASURY: "US Treasury",
  BOK_ECOS: "BOK ECOS",
  KOSIS: "KOSIS",
  KOREA_MOEF: "기재부",
  KRX_DERIVATIVES: "KRX 파생",
  CBOE: "Cboe",
  CME: "CME",
  MSCI: "MSCI",
  FTSE_RUSSELL: "FTSE Russell",
  ETF_ISSUER: "ETF Issuer",
  ALPHA_VANTAGE: "Alpha Vantage",
  FINANCIAL_MODELING_PREP: "FMP",
  FINNHUB: "Finnhub",
  LICENSED_CORPORATE_EVENTS: "Licensed Events",
  OTHER_OFFICIAL: "기타 공식",
  OTHER_LICENSED: "기타 라이선스",
};

function playPaperOrderChime(): void {
  const AudioContextConstructor =
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioContextConstructor) return;
  const context = new AudioContextConstructor();
  const start = context.currentTime;
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.12, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.42);
  gain.connect(context.destination);
  for (const [frequency, delay] of [[880, 0], [1174.66, 0.15]] as const) {
    const oscillator = context.createOscillator();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, start + delay);
    oscillator.connect(gain);
    oscillator.start(start + delay);
    oscillator.stop(start + delay + 0.24);
  }
  window.setTimeout(() => void context.close(), 700);
}

const instruments = [
  {
    instrumentId: "KRX:005930",
    symbol: "005930",
    name: "삼성전자",
    market: "KOSPI",
    price: "84,700",
    changeRate: "+2.05",
    direction: "positive" as const,
    turnover: "1.42조",
    selected: true,
    freshness: "live" as const,
  },
  {
    instrumentId: "KRX:000660",
    symbol: "000660",
    name: "SK하이닉스",
    market: "KOSPI",
    price: "238,500",
    changeRate: "+3.47",
    direction: "positive" as const,
    turnover: "9,840억",
    freshness: "live" as const,
  },
  {
    instrumentId: "KRX:005380",
    symbol: "005380",
    name: "현대차",
    market: "KOSPI",
    price: "292,000",
    changeRate: "-0.68",
    direction: "negative" as const,
    turnover: "3,120억",
    freshness: "live" as const,
  },
  {
    instrumentId: "KRX:373220",
    symbol: "373220",
    name: "LG에너지솔루션",
    market: "KOSPI",
    price: "359,500",
    changeRate: "+1.12",
    direction: "positive" as const,
    turnover: "2,670억",
    freshness: "delayed" as const,
  },
  {
    instrumentId: "KRX:247540",
    symbol: "247540",
    name: "에코프로비엠",
    market: "KOSDAQ",
    price: "138,900",
    changeRate: "+5.23",
    direction: "positive" as const,
    turnover: "4,520억",
    freshness: "live" as const,
  },
  {
    instrumentId: "NASDAQ:NVDA",
    symbol: "NVDA",
    name: "NVIDIA",
    market: "NASDAQ",
    price: "$173.24",
    changeRate: "-1.38",
    direction: "negative" as const,
    turnover: "$18.2B",
    freshness: "stale" as const,
  },
];

const asks = Array.from({ length: 10 }, (_, index) => {
  const level = 10 - index;
  const price = 84_700 + level * 100;
  return {
    price: price.toLocaleString("ko-KR"),
    quantity: (11_800 + level * 3_740).toLocaleString("ko-KR"),
    changeRate: `+${(2.05 + level * 0.12).toFixed(2)}`,
    direction: "positive" as const,
    depthBand: level as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10,
  };
});

const bids = Array.from({ length: 10 }, (_, index) => {
  const level = index + 1;
  const price = 84_700 - level * 100;
  return {
    price: price.toLocaleString("ko-KR"),
    quantity: (17_400 + level * 4_170).toLocaleString("ko-KR"),
    changeRate: `+${Math.max(0.8, 2.05 - level * 0.12).toFixed(2)}`,
    direction: "positive" as const,
    depthBand: level as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10,
  };
});

function buildCandles(): MarketCandleViewModel[] {
  const baseTime = Date.parse("2026-07-20T00:00:00.000Z");
  let previousClose = 82_450;
  return Array.from({ length: 54 }, (_, index) => {
    const drift = 28 + Math.sin(index / 4) * 92 + Math.cos(index / 7) * 38;
    const open = previousClose;
    const close = Math.round(open + drift);
    const high = Math.max(open, close) + 85 + (index % 5) * 17;
    const low = Math.min(open, close) - 70 - (index % 4) * 21;
    const volume = 185_000 + ((index * 71_311) % 610_000);
    previousClose = close;
    return {
      id: `candle-${index}`,
      openedAt: new Date(baseTime + index * 60_000).toISOString(),
      open: String(open),
      high: String(high),
      low: String(low),
      close: String(close),
      volume: String(volume),
      turnover: String(volume * Math.round((open + close) / 2)),
      forming: index === 53,
    };
  });
}

const initialMarkers: PaperFillMarkerViewModel[] = [
  {
    id: "fill-buy-1",
    orderId: "paper-order-001",
    filledAt: "2026-07-20T00:17:30.000Z",
    price: "83210",
    quantity: "12",
    side: "BUY",
    completion: "FULL",
    source: "LOCAL_PAPER_FILL",
  },
  {
    id: "fill-sell-partial",
    orderId: "paper-order-002",
    filledAt: "2026-07-20T00:42:15.000Z",
    price: "84480",
    quantity: "5",
    side: "SELL",
    completion: "PARTIAL",
    source: "LOCAL_PAPER_FILL",
  },
];

const initialIndicators: ChartIndicatorViewModel[] = [
  { id: "price-sma-5", source: "PRICE", kind: "SMA", period: 5, visible: true },
  {
    id: "price-sma-20",
    source: "PRICE",
    kind: "SMA",
    period: 20,
    visible: true,
  },
  {
    id: "price-sma-60",
    source: "PRICE",
    kind: "SMA",
    period: 60,
    visible: true,
  },
  {
    id: "price-sma-120",
    source: "PRICE",
    kind: "SMA",
    period: 120,
    visible: true,
  },
];

const themes = [
  {
    rank: 1,
    themeId: "semiconductor-materials",
    name: "반도체 · 소부장",
    state: "LEADING" as const,
    turnover: "4.82조",
    acceleration: "3.42x",
    marketShare: "12.8%",
    breadth: "81%",
    leaderName: "SK하이닉스",
    leaderChangeRate: "+3.47",
    direction: "positive" as const,
    evidenceLabel: "거래대금 가속·시장 점유율·상승 breadth",
  },
  {
    rank: 2,
    themeId: "power-grid",
    name: "전력기기 · 전력망",
    state: "EMERGING" as const,
    turnover: "2.16조",
    acceleration: "2.07x",
    marketShare: "6.4%",
    breadth: "67%",
    leaderName: "HD현대일렉트릭",
    leaderChangeRate: "+4.12",
    direction: "positive" as const,
    evidenceLabel: "동시간 거래대금 중앙값 대비 가속",
  },
  {
    rank: 3,
    themeId: "defense",
    name: "방산 · 우주항공",
    state: "ROTATING" as const,
    turnover: "1.38조",
    acceleration: "1.61x",
    marketShare: "4.1%",
    breadth: "44%",
    leaderName: "한화에어로스페이스",
    leaderChangeRate: "+1.28",
    direction: "positive" as const,
    evidenceLabel: "상위 종목 집중도 높음",
  },
];

const news = [
  {
    id: "news-1",
    titleKo: "메모리 가격 반등 기대…HBM 공급 확대 계획 재확인",
    source: "기업 IR",
    publishedAtLabel: "10:21",
    category: "기업" as const,
    impact: "positive" as const,
    summaryKo:
      "공식 IR 자료와 반도체 업종 거래대금 증가가 같은 시간대에 관측됐습니다.",
    evidenceCount: 4,
  },
  {
    id: "news-2",
    titleKo: "미 국채금리 하락과 기술주 선물 반등",
    source: "US Treasury · KIS",
    publishedAtLabel: "09:58",
    category: "거시" as const,
    impact: "mixed" as const,
    summaryKo:
      "금리 경로는 우호적이지만 달러 강세가 이어져 직접 인과는 확정할 수 없습니다.",
    evidenceCount: 6,
  },
  {
    id: "news-3",
    titleKo: "외국인 반도체 대형주 순매수 확대",
    source: "KIS 시장 데이터",
    publishedAtLabel: "09:43",
    category: "산업" as const,
    impact: "positive" as const,
    summaryKo:
      "삼성전자·SK하이닉스 동반 거래대금 증가와 외국인 순매수 흐름을 확인했습니다.",
    evidenceCount: 3,
  },
];

const contexts = [
  {
    id: "macro-fed",
    title: "미 연준 금리 경로 재평가",
    status: "WATCH" as const,
    observedReaction: "QQQ +0.8% · USD/KRW +0.2%",
    confidenceLabel: "가능한 맥락 · 중간 신뢰도",
  },
  {
    id: "ai-competition",
    title: "AI 모델 가격 경쟁 심화",
    status: "CONFIRMED" as const,
    observedReaction: "미 반도체 혼조 · 국내 HBM 강세",
    confidenceLabel: "사건 확인 · 전달 경로는 가설",
  },
];

function resolveTheme(preference: ThemePreference): "dark" | "light" {
  if (preference !== "system") return preference;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function formatWholeNumber(value: string | null, fallback: string): string {
  if (value === null || !/^-?\d+$/.test(value)) return fallback;
  return BigInt(value).toLocaleString("ko-KR");
}

function formatCompactUsdTurnover(
  value: string | null | undefined,
  fallback = "",
): string {
  if (value === null || value === undefined || !/^\d+(?:\.\d+)?$/.test(value)) {
    return fallback;
  }
  const whole = BigInt(value.split(".")[0] ?? "0");
  const units = [
    ["T", 1_000_000_000_000n],
    ["B", 1_000_000_000n],
    ["M", 1_000_000n],
    ["K", 1_000n],
  ] as const;
  for (const [suffix, divisor] of units) {
    if (whole >= divisor) {
      const scaled = (whole * 100n) / divisor;
      const integer = scaled / 100n;
      const fraction = scaled % 100n;
      const fractionText =
        fraction === 0n
          ? ""
          : `.${fraction.toString().padStart(2, "0").replace(/0+$/, "")}`;
      return `$${integer.toLocaleString("en-US")}${fractionText}${suffix}`;
    }
  }
  return `$${whole.toLocaleString("en-US")}`;
}

function formatMarketPrice(
  value: string | null,
  currency: string,
  fallback: string,
): string {
  if (value === null) return fallback;
  if (currency === "KRW") return formatWholeNumber(value, fallback);
  return truncateUsPrice(value, fallback);
}

function marketDirection(
  changeRate: string | null | undefined,
): "positive" | "negative" | "flat" {
  if (!changeRate) return "flat";
  return changeRate.startsWith("-")
    ? "negative"
    : /^0(?:\.0+)?$/.test(changeRate)
      ? "flat"
      : "positive";
}

function tradingPhaseLabel(phase: DesktopTradingPhase | undefined): string | null {
  switch (phase) {
    case "PREOPEN_AUCTION":
      return "장전 동시호가";
    case "REGULAR_CONTINUOUS":
      return "연속매매";
    case "VI_PAUSED":
      return "VI 단일가";
    case "CLOSING_AUCTION":
      return "장마감 동시호가";
    case "AFTER_HOURS_AUCTION":
      return "시간외 단일가";
    case "CLOSED":
      return "장마감";
    default:
      return null;
  }
}

function instrumentVenueLabel(instrumentId: string, domesticMarket?: string | null): string {
  if (instrumentId.startsWith("NASDAQ:")) return "NASDAQ";
  if (instrumentId.startsWith("NYSE:")) return "NYSE";
  if (instrumentId.startsWith("AMEX:")) return "AMEX";
  return domesticMarket === "KOSPI" || domesticMarket === "KOSDAQ"
    ? domesticMarket
    : "KRX";
}

function formatInstrumentPrice(value: string, instrumentId: string): string {
  return /^(NASDAQ|NYSE|AMEX):/.test(instrumentId)
    ? `$${truncateUsPrice(value, value)}`
    : `${formatWholeNumber(value, value)}원`;
}

function orderBookLevelChange(
  priceValue: string,
  previousCloseValue: string | null,
): { changeRate: string; direction: "positive" | "negative" | "flat" } {
  const price = Number(priceValue);
  const previousClose = Number(previousCloseValue);
  if (!Number.isFinite(price) || !Number.isFinite(previousClose) || previousClose <= 0) {
    return { changeRate: "—", direction: "flat" };
  }
  const rate = ((price - previousClose) / previousClose) * 100;
  return {
    changeRate: Math.abs(rate).toFixed(2),
    direction: rate > 0 ? "positive" : rate < 0 ? "negative" : "flat",
  };
}

function domesticInstrumentName(symbol: string): string {
  const names: Readonly<Record<string, string>> = {
    "005930": "삼성전자",
    "000660": "SK하이닉스",
    "005380": "현대차",
  };
  return names[symbol] ?? `국내종목 ${symbol}`;
}

function parseWholeNumberInput(value: string): bigint {
  const normalized = value.replaceAll(",", "").trim();
  return /^(?:0|[1-9]\d*)$/.test(normalized) ? BigInt(normalized) : 0n;
}

function normalizeWholeNumberInput(value: string): string {
  return value.replace(/[^0-9]/g, "").replace(/^0+(?=\d)/, "");
}

function normalizePriceInput(value: string, currency: string): string | null {
  const normalized = value.replaceAll(",", "").trim();
  const pattern = currency === "USD"
    ? /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/
    : /^(?:0|[1-9]\d*)$/;
  return pattern.test(normalized) && normalized !== "0" ? normalized : null;
}

function currencyDecimalToMinor(value: string, currency: string): bigint | null {
  const normalized = value.replaceAll(",", "").trim();
  const scale = currency === "USD" ? 2 : currency === "KRW" ? 0 : null;
  if (scale === null || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(normalized)) {
    return null;
  }
  const [whole = "0", fraction = ""] = normalized.split(".");
  if (fraction.length > scale) return null;
  return BigInt(`${whole}${fraction.padEnd(scale, "0")}`);
}

function formatCashMinor(value: string | null | undefined, currency: string): string {
  if (value === null || value === undefined || !/^-?\d+$/.test(value)) return "—";
  if (currency === "USD") {
    const negative = value.startsWith("-");
    const digits = negative ? value.slice(1) : value;
    const padded = digits.padStart(3, "0");
    const whole = padded.slice(0, -2);
    const fraction = padded.slice(-2);
    return `${negative ? "-" : ""}$${Number(whole).toLocaleString("en-US")}.${fraction}`;
  }
  return `₩${BigInt(value).toLocaleString("ko-KR")}`;
}

function informationProviderLabel(provider: string): string {
  return (
    {
      KIS_DOMESTIC_NEWS: "KIS 국내뉴스",
      KIS_OVERSEAS_NEWS: "KIS 미국뉴스",
      FINNHUB_NEWS: "Finnhub 미국뉴스",
      SEC_EDGAR: "SEC EDGAR",
      OPEN_DART: "OpenDART",
    }[provider] ?? provider
  );
}

function formatInformationTime(
  value: string,
  precision: "SECOND" | "DATE" = "SECOND",
): string {
  if (precision === "DATE") {
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) return "날짜 미상 · 시각 미제공";
    return `${new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(timestamp))} · 시각 미제공`;
  }
  const instant = new Date(value);
  return Number.isFinite(instant.getTime())
    ? instant.toLocaleString("ko-KR", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : value;
}

function calendarCategory(
  kind: MarketCalendarEvent["kind"],
): Exclude<CalendarCategoryFilter, "ALL"> {
  if (
    kind === "OPTIONS_EXPIRY" ||
    kind === "FUTURES_EXPIRY" ||
    kind === "OTHER_MARKET_STRUCTURE"
  ) {
    return "DERIVATIVES";
  }
  if (
    kind === "INDEX_REBALANCE" ||
    kind === "MSCI_REBALANCE" ||
    kind === "RUSSELL_REBALANCE" ||
    kind === "ETF_REBALANCE"
  ) {
    return "REBALANCE";
  }
  if (
    [
      "CENTRAL_BANK_RATE_DECISION",
      "CENTRAL_BANK_MINUTES",
      "CENTRAL_BANK_SPEECH",
      "FOMC",
      "MACRO_RELEASE",
      "CPI",
      "PPI",
      "PCE",
      "GDP",
      "EMPLOYMENT",
      "PMI",
      "RETAIL_SALES",
      "TRADE_BALANCE",
      "EIA_INVENTORY",
      "TREASURY_AUCTION",
      "OTHER_MACRO",
    ].includes(kind)
  ) {
    return "MACRO";
  }
  return "CORPORATE";
}

function formatCalendarEventTime(event: MarketCalendarEvent): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: event.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(event.scheduledAt));
}

function calendarMarketLabel(event: MarketCalendarEvent): string {
  return event.marketScope === "KR"
    ? "국내"
    : event.marketScope === "US"
      ? "미국"
      : "글로벌";
}

function calendarDataQualityLabel(
  quality: MarketCalendarEvent["dataQuality"],
): string {
  return (
    {
      OFFICIAL: "공식",
      REGULATOR_EXCHANGE: "거래소·규제",
      ISSUER_PRIMARY: "기업 1차",
      LICENSED: "라이선스",
      AGGREGATED: "집계",
      HEADLINE_ONLY: "제목만",
      DELAYED: "지연",
      STALE: "오래됨",
      UNSUPPORTED: "미지원",
    } satisfies Record<MarketCalendarEvent["dataQuality"], string>
  )[quality];
}

function calendarSourceStateLabel(state: CalendarSourceState): string {
  return (
    {
      READY: "수신",
      UNCONFIGURED: "미설정",
      UNSUPPORTED: "미지원",
      ERROR: "실패",
    } satisfies Record<CalendarSourceState, string>
  )[state];
}

function formatCalendarMetric(metric: MarketCalendarEvent["metrics"][number]): string {
  return `${metric.name} ${metric.value}${metric.unit ? ` ${metric.unit}` : ""}`;
}

function buildCalendarMonthDays(month: string): readonly {
  readonly date: string;
  readonly inMonth: boolean;
}[] {
  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const firstDay = new Date(Date.UTC(year, monthIndex, 1));
  const startOffset = firstDay.getUTCDay();
  const start = new Date(firstDay);
  start.setUTCDate(firstDay.getUTCDate() - startOffset);
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() + index);
    return {
      date: day.toISOString().slice(0, 10),
      inMonth: day.getUTCMonth() === monthIndex,
    };
  });
}

function TradingWorkspaceSkeleton({
  statusLabel,
}: {
  readonly statusLabel: string;
}) {
  return (
    <section
      className="pt-trading-skeleton"
      role="status"
      aria-label="거래 화면 데이터 로딩"
    >
      <div className="pt-trading-skeleton__strip">
        {Array.from({ length: 5 }, (_, index) => (
          <span key={index} />
        ))}
      </div>
      <div className="pt-trading-skeleton__header">
        <div>
          <span />
          <strong />
        </div>
        <div>
          {Array.from({ length: 6 }, (_, index) => (
            <span key={index} />
          ))}
        </div>
      </div>
      <div className="pt-trading-skeleton__portfolio">
        {Array.from({ length: 4 }, (_, index) => (
          <span key={index} />
        ))}
      </div>
      <div className="pt-trading-skeleton__grid">
        <div className="pt-trading-skeleton__book">
          {Array.from({ length: 12 }, (_, index) => (
            <span key={index} />
          ))}
        </div>
        <div className="pt-trading-skeleton__chart">
          <span />
          <i />
          <i />
          <i />
          <strong>{statusLabel}</strong>
        </div>
      </div>
      <div className="pt-trading-skeleton__insights">
        <span />
        <span />
        <span />
      </div>
    </section>
  );
}

export function App() {
  const hasDesktopRuntime = window.paperTradingDesktop !== undefined;
  const candles = useMemo(buildCandles, []);
  const desktop = useDesktopRuntime();
  const [themePreference, setThemePreference] = useState<ThemePreference>(
    () => {
      const previewTheme = new URLSearchParams(window.location.search).get(
        "theme",
      );
      if (
        previewTheme === "dark" ||
        previewTheme === "light" ||
        previewTheme === "system"
      ) {
        return previewTheme;
      }
      return (
        (localStorage.getItem(
          "papertrading:theme",
        ) as ThemePreference | null) ?? "dark"
      );
    },
  );
  const [systemTheme, setSystemTheme] = useState<"dark" | "light">(() =>
    resolveTheme("system"),
  );
  const [interval, setInterval] = useState<ChartInterval>("1m");
  const [chartRange, setChartRange] = useState<ChartRange>("1D");
  const [indicators, setIndicators] = useState(initialIndicators);
  const [fillMarkers, setFillMarkers] = useState(() =>
    hasDesktopRuntime ? [] : initialMarkers,
  );
  const [liveChartCandles, setLiveChartCandles] = useState<
    readonly MarketCandleViewModel[]
  >([]);
  const tradeTapeAccumulator = useRef(new ObservedTradeTapeAccumulator());
  const [observedTrades, setObservedTrades] = useState<
    readonly ObservedTradeTapeItem[]
  >([]);
  const [watchlist, setWatchlist] = useState<readonly LocalWatchlistItem[]>(() =>
    hasDesktopRuntime
      ? readLocalWatchlist(localStorage.getItem(LOCAL_WATCHLIST_KEY))
      : [],
  );
  const [watchlistQuotes, setWatchlistQuotes] = useState<
    ReadonlyMap<string, WatchlistQuoteSnapshot>
  >(() => new Map());
  const [selectedMarket, setSelectedMarket] = useState("국내");
  const [workspacePage, setWorkspacePage] =
    useState<WorkspacePage>("DASHBOARD");
  const [rankingSort, setRankingSort] =
    useState<DesktopRankingSort>("TURNOVER");
  const [informationScope, setInformationScope] = useState<
    "ALL" | "SELECTED" | "WATCHLIST"
  >("ALL");
  const [informationProvider, setInformationProvider] = useState<string | null>(
    null,
  );
  const [calendarSelectedDate, setCalendarSelectedDate] =
    useState("2026-07-22");
  const [calendarMarketFilter, setCalendarMarketFilter] =
    useState<CalendarMarketFilter>("ALL");
  const [calendarCategoryFilter, setCalendarCategoryFilter] =
    useState<CalendarCategoryFilter>("ALL");
  const [calendarQualityFilter, setCalendarQualityFilter] =
    useState<CalendarQualityFilter>("ALL");
  const [selectedCalendarEventId, setSelectedCalendarEventId] =
    useState<string | null>(null);
  const [selectedInformationItem, setSelectedInformationItem] =
    useState<DesktopInformationItemProjection | null>(null);
  const [selectedInstrument, setSelectedInstrument] = useState<{
    readonly symbol: string;
    readonly name: string;
    readonly market: DomesticEquityMarket | null;
    readonly securityType: DomesticSecurityType | null;
  } | null>(null);
  const [workspaceInstruments, setWorkspaceInstruments] = useState<readonly {
    readonly symbol: string;
    readonly name: string;
    readonly market: DomesticEquityMarket | null;
    readonly securityType: DomesticSecurityType | null;
    readonly selection?: string;
  }[]>([]);
  const [instrumentQuery, setInstrumentQuery] = useState("");
  const [instrumentSearchOpen, setInstrumentSearchOpen] = useState(false);
  const [instrumentSearchLoading, setInstrumentSearchLoading] = useState(false);
  const [instrumentSearchIndex, setInstrumentSearchIndex] = useState(0);
  const instrumentSearchRoot = useRef<HTMLDivElement | null>(null);
  const instrumentSearchInput = useRef<HTMLInputElement | null>(null);
  const [analysisNote, setAnalysisNote] = useState(
    () => localStorage.getItem("papertrading:analysis-note") ?? "",
  );
  const [draft, setDraft] = useState<OrderTicketDraft>({
    side: "BUY",
    orderType: "LIMIT",
    quantity: "10",
    limitPrice: hasDesktopRuntime ? "" : "84,700",
  });
  const [notice, setNotice] = useState(
    hasDesktopRuntime
      ? "Electron 로컬 런타임과 KIS 읽기 전용 데이터를 연결하는 중입니다."
      : "화면 미리보기 모드 · 합성 fixture · KIS/SQLite 미연결",
  );

  const effectiveTheme =
    themePreference === "system" ? systemTheme : themePreference;

  useEffect(() => {
    const market = desktop.market;
    if (!market) return;
    const observed = tradeTapeAccumulator.current.observe({
      instrumentId: market.instrumentId,
      occurredAt: market.tradeOccurredAt,
      price: market.price,
      quantity: market.lastTradeQuantity,
      cumulativeVolume: market.cumulativeVolume,
    });
    if (observed === null) return;
    setObservedTrades((current) => [
      observed,
      ...current.filter((item) => item.id !== observed.id),
    ].slice(0, 80));
  }, [
    desktop.market?.cumulativeVolume,
    desktop.market?.instrumentId,
    desktop.market?.lastTradeQuantity,
    desktop.market?.price,
    desktop.market?.sequence,
    desktop.market?.tradeOccurredAt,
  ]);

  useEffect(() => {
    if (!hasDesktopRuntime) return;
    localStorage.setItem(LOCAL_WATCHLIST_KEY, JSON.stringify(watchlist));
  }, [hasDesktopRuntime, watchlist]);

  useEffect(() => {
    const api = window.paperTradingDesktop;
    if (!hasDesktopRuntime || !api || watchlist.length === 0) return;
    const domesticSymbols = watchlist
      .filter((item) => item.instrumentId.startsWith("KRX:"))
      .map((item) => item.symbol);
    if (domesticSymbols.length === 0) return;
    let active = true;
    const refreshWatchlistQuotes = () => {
      void api.market
        .getWatchlistQuotes(domesticSymbols)
        .then((quotes) => {
          if (!active) return;
          setWatchlistQuotes((current) => {
            const next = new Map(current);
            for (const quote of quotes) {
              next.set(quote.instrumentId, {
                price: formatWholeNumber(quote.price, "—"),
                changeRate: quote.changeRate,
                direction: marketDirection(quote.changeRate),
                turnover: formatKrwTurnoverEok(quote.cumulativeTurnover, "—"),
                freshness: "stale",
              });
            }
            return next;
          });
        })
        .catch(() => {
          // Per-symbol placeholders remain visible when the read-only provider is unavailable.
        });
    };
    refreshWatchlistQuotes();
    const timer = window.setInterval(refreshWatchlistQuotes, 30_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [hasDesktopRuntime, watchlist]);

  useEffect(() => {
    setInformationProvider(null);
    setSelectedInformationItem(null);
  }, [selectedMarket]);

  useEffect(() => {
    if (selectedInformationItem === null) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedInformationItem(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selectedInformationItem]);

  useEffect(() => {
    document.documentElement.dataset.theme = effectiveTheme;
    localStorage.setItem("papertrading:theme", themePreference);
  }, [effectiveTheme, themePreference]);

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemTheme(query.matches ? "dark" : "light");
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLocaleLowerCase("en-US") === "k"
      ) {
        event.preventDefault();
        instrumentSearchInput.current?.focus();
        setInstrumentSearchOpen(true);
      }
      if (event.key === "Escape") {
        setInstrumentSearchOpen(false);
        instrumentSearchInput.current?.blur();
      }
    };
    const dismissSearch = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !instrumentSearchRoot.current?.contains(event.target)
      ) {
        setInstrumentSearchOpen(false);
      }
    };
    window.addEventListener("keydown", handleShortcut);
    window.addEventListener("pointerdown", dismissSearch);
    return () => {
      window.removeEventListener("keydown", handleShortcut);
      window.removeEventListener("pointerdown", dismissSearch);
    };
  }, []);

  useEffect(() => {
    const query = instrumentQuery.trim();
    setInstrumentSearchIndex(0);
    const searchable = selectedMarket === "미국"
      ? isSearchableUsInstrumentQuery(query)
      : isSearchableDomesticInstrumentQuery(query);
    if (
      !hasDesktopRuntime ||
      !searchable
    ) {
      setInstrumentSearchLoading(false);
      return;
    }
    setInstrumentSearchLoading(true);
    let active = true;
    const timer = window.setTimeout(() => {
      const request = selectedMarket === "미국"
        ? desktop.searchUsInstruments(query)
        : desktop.searchDomesticInstruments(query);
      void request.finally(() => {
        if (active) setInstrumentSearchLoading(false);
      });
    }, 180);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [
    desktop.searchDomesticInstruments,
    desktop.searchUsInstruments,
    hasDesktopRuntime,
    instrumentQuery,
    selectedMarket,
  ]);

  useEffect(() => {
    if (!desktop.account) return;
    const instrumentId =
      desktop.market?.instrumentId ?? "KRX:005930";
    setFillMarkers(
      desktop.account.fills
        .filter((fill) => fill.instrumentId === instrumentId)
        .map((fill) => ({
          id: fill.fillId,
          orderId: fill.clientOrderId,
          filledAt: fill.filledAt,
          price: fill.price,
          quantity: fill.quantity,
          side: fill.side,
          completion: fill.completion,
          source: "LOCAL_PAPER_FILL",
        })),
    );
  }, [desktop.account, desktop.market?.instrumentId]);

  useEffect(() => {
    const price = desktop.market?.price;
    if (!hasDesktopRuntime || price === null || price === undefined) return;
    setDraft((current) =>
      current.limitPrice.trim() === ""
        ? { ...current, limitPrice: formatWholeNumber(price, price) }
        : current,
    );
  }, [desktop.market?.price, hasDesktopRuntime]);

  useEffect(() => {
    if (window.paperTradingDesktop === undefined) {
      return;
    }
    void desktop.loadChartHistory(interval, chartRange);
  }, [
    chartRange,
    desktop.loadChartHistory,
    desktop.market?.instrumentId,
    desktop.market?.session,
    interval,
  ]);

  useEffect(() => {
    if (!hasDesktopRuntime) return;
    if (workspacePage === "DASHBOARD") {
      void desktop.loadRanking(selectedMarket === "미국" ? "US" : "KRX", "TURNOVER");
      return;
    }
    if (workspacePage === "RANKINGS") {
      void desktop.loadRanking(selectedMarket === "미국" ? "US" : "KRX", rankingSort);
    }
  }, [
    desktop.loadRanking,
    hasDesktopRuntime,
    rankingSort,
    selectedMarket,
    workspacePage,
  ]);

  useEffect(() => {
    if (
      !hasDesktopRuntime ||
      (workspacePage !== "DASHBOARD" && workspacePage !== "NEWS")
    ) {
      return;
    }
    void desktop.loadInformationFeed(false);
    const timer = window.setInterval(() => {
      void desktop.loadInformationFeed(false);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [
    desktop.loadInformationFeed,
    desktop.market?.instrumentId,
    hasDesktopRuntime,
    selectedMarket,
    workspacePage,
  ]);

  useEffect(() => {
    if (!hasDesktopRuntime || workspacePage !== "CALENDAR") return;
    void desktop.loadMarketCalendar(false);
  }, [desktop.loadMarketCalendar, hasDesktopRuntime, workspacePage]);

  const handleChartIntervalChange = (nextInterval: ChartInterval) => {
    setInterval(nextInterval);
    setChartRange((current) =>
      INTRADAY_CHART_INTERVALS.includes(nextInterval)
        ? "1D"
        : current === "1D"
          ? "6M"
          : current,
    );
  };
  const chartRanges: readonly ChartRange[] =
    INTRADAY_CHART_INTERVALS.includes(interval)
      ? ["1D"]
      : ["6M", "1Y", "5Y"];

  const isKisLive =
    desktop.market?.mode === "KIS_READ_ONLY" &&
    desktop.market.connectionState === "LIVE" &&
    desktop.market.freshness === "live";
  const activeSymbol = desktop.market?.symbol || "005930";
  const activeInstrumentId =
    desktop.market?.instrumentId ?? `KRX:${activeSymbol}`;
  const activeInstrumentName =
    selectedInstrument?.symbol === activeSymbol
      ? selectedInstrument.name
      : domesticInstrumentName(activeSymbol);
  const activeCurrency = desktop.market?.currency ?? "KRW";
  const isUsSelection = selectedMarket === "미국";
  const isUsMarket = ["NASDAQ", "NYSE", "AMEX"].includes(
    desktop.market?.venue ?? "",
  );
  const sessionLabel = (() => {
    const phaseLabel = tradingPhaseLabel(desktop.market?.tradingPhase);
    if (
      phaseLabel !== null &&
      desktop.market?.tradingPhase !== "REGULAR_CONTINUOUS"
    ) {
      return phaseLabel;
    }
    switch (desktop.market?.session) {
      case "PRE":
        return ["NASDAQ", "NYSE", "AMEX"].includes(desktop.market?.venue ?? "")
          ? "미국 프리마켓"
          : desktop.market?.venue === "NXT" ? "NXT 프리마켓" : "장전";
      case "REGULAR":
        return "정규장";
      case "AFTER":
        return ["NASDAQ", "NYSE", "AMEX"].includes(desktop.market?.venue ?? "")
          ? "미국 애프터마켓"
          : desktop.market?.venue === "NXT" ? "NXT 애프터마켓" : "장후";
      case "CLOSED":
        return "장마감";
      default:
        return isKisLive
          ? "세션 확인 중"
          : hasDesktopRuntime
            ? "연결 대기"
            : "fixture 정규장";
    }
  })();
  const displayPrice = formatMarketPrice(
    desktop.market?.price ?? null,
    activeCurrency,
    hasDesktopRuntime ? "—" : "84,700",
  );
  const displayChange = formatMarketPrice(
    desktop.market?.change ?? null,
    activeCurrency,
    hasDesktopRuntime ? "—" : "+1,700",
  );
  const displayChangeRate =
    desktop.market?.changeRate ?? (hasDesktopRuntime ? "—" : "+2.05");
  const displayDirection =
    desktop.market?.changeRate === null ||
    desktop.market?.changeRate === undefined
      ? hasDesktopRuntime
        ? "flat"
        : marketDirection(displayChangeRate)
      : marketDirection(displayChangeRate);
  useEffect(() => {
    if (!hasDesktopRuntime || !desktop.market?.price) return;
    const instrumentId = desktop.market.instrumentId;
    setWatchlistQuotes((current) => {
      const next = new Map(current);
      next.set(instrumentId, {
        price: displayPrice,
        changeRate: displayChangeRate,
        direction: displayDirection,
        turnover: isUsMarket
          ? desktop.market?.cumulativeTurnover
            ? `$${formatWholeNumber(desktop.market.cumulativeTurnover.split(".")[0] ?? null, "—")}`
            : "—"
          : formatKrwTurnoverEok(desktop.market?.cumulativeTurnover ?? null, "—"),
        freshness: isKisLive ? "live" : "stale",
      });
      return next;
    });
  }, [
    desktop.market?.cumulativeTurnover,
    desktop.market?.instrumentId,
    desktop.market?.price,
    displayChangeRate,
    displayDirection,
    displayPrice,
    hasDesktopRuntime,
    isKisLive,
    isUsMarket,
  ]);
  const chartCurrentPrice =
    desktop.market?.price ?? (hasDesktopRuntime ? null : "84700");
  const chartPreviousClosePrice = (() => {
    const price = Number(chartCurrentPrice);
    const change = Number(
      desktop.market?.change ?? (hasDesktopRuntime ? Number.NaN : "1700"),
    );
    if (!Number.isFinite(price) || !Number.isFinite(change) || price <= 0) {
      return null;
    }
    return String(Math.round(price - change));
  })();
  const activeDomesticMarket = (() => {
    if (selectedInstrument?.symbol === activeSymbol) {
      return selectedInstrument.market;
    }
    const known = instruments.find((item) => item.symbol === activeSymbol);
    return known?.market === "KOSPI" || known?.market === "KOSDAQ"
      ? known.market
      : null;
  })();
  const activeSecurityType = (() => {
    if (selectedInstrument?.symbol === activeSymbol) {
      return selectedInstrument.securityType;
    }
    return instruments.some(
      (item) => item.symbol === activeSymbol && item.market !== "NASDAQ",
    )
      ? ("STOCK" as const)
      : null;
  })();
  useEffect(() => {
    if (!hasDesktopRuntime || !activeSymbol) return;
    setWorkspaceInstruments((current) =>
      current.some((item) => item.symbol === activeSymbol)
        ? current
        : [
            ...current,
            {
              symbol: activeSymbol,
              name: activeInstrumentName,
              market: activeDomesticMarket,
              securityType: activeSecurityType,
              selection: desktop.market?.venue === "NASDAQ"
                ? `NAS:${activeSymbol}`
                : desktop.market?.venue === "NYSE"
                  ? `NYS:${activeSymbol}`
                  : desktop.market?.venue === "AMEX"
                    ? `AMS:${activeSymbol}`
                    : activeSymbol,
            },
          ],
    );
  }, [
    activeDomesticMarket,
    activeInstrumentName,
    activeSecurityType,
    activeSymbol,
    desktop.market?.venue,
    hasDesktopRuntime,
  ]);
  const watched = watchlist.some(
    (item) => item.instrumentId === activeInstrumentId,
  );
  const isClosedMarket = desktop.market?.tradingPhase === "CLOSED";
  const hasLastOrderBook =
    (desktop.market?.asks.length ?? 0) > 0 &&
    (desktop.market?.bids.length ?? 0) > 0;
  const orderBookReceivedAtMs =
    desktop.market?.orderBookReceivedAt === null ||
    desktop.market?.orderBookReceivedAt === undefined
      ? Number.NaN
      : Date.parse(desktop.market.orderBookReceivedAt);
  const hasFreshOrderBookSnapshot =
    hasLastOrderBook &&
    desktop.market?.mode === "KIS_READ_ONLY" &&
    desktop.market.connectionState !== "DISABLED" &&
    desktop.market.freshness === "stale" &&
    Number.isFinite(orderBookReceivedAtMs) &&
    Date.now() - orderBookReceivedAtMs <= 60_000;
  const isPaperOrderSession =
    (isKisLive || hasFreshOrderBookSnapshot) &&
    desktop.market?.tradingPhase !== "CLOSED";
  const marketStatus =
    isClosedMarket && (desktop.market?.price !== null || hasLastOrderBook)
      ? ("closed" as const)
      : desktop.market?.freshness === "live"
        ? ("live" as const)
        : desktop.market?.freshness === "stale"
          ? ("stale" as const)
        : ("offline" as const);
  const hasRestSnapshot =
    hasDesktopRuntime &&
    !isKisLive &&
    (desktop.market?.price !== null || hasLastOrderBook);
  const referencePriceLadder = useMemo(
    () =>
      buildReferencePriceLadder({
        anchorPrice: chartCurrentPrice,
        previousClosePrice: chartPreviousClosePrice,
        market: activeDomesticMarket,
        securityType: activeSecurityType,
      }),
    [activeDomesticMarket, activeSecurityType, chartCurrentPrice, chartPreviousClosePrice],
  );
  const domesticPriceLimits = useMemo(
    () =>
      buildDomesticPriceLimits({
        previousClosePrice: chartPreviousClosePrice,
        market: activeDomesticMarket,
        securityType: activeSecurityType,
      }),
    [activeDomesticMarket, activeSecurityType, chartPreviousClosePrice],
  );
  const isUsOneLevelBook =
    ["NASDAQ", "NYSE", "AMEX"].includes(desktop.market?.venue ?? "") &&
    desktop.market?.asks.length === 1 && desktop.market?.bids.length === 1;
  const usPriceLadder = useMemo(
    () => buildUsOneLevelPriceLadder({
      bestAskPrice: desktop.market?.asks[0]?.price ?? null,
      bestAskQuantity: desktop.market?.asks[0]?.quantity ?? null,
      bestBidPrice: desktop.market?.bids[0]?.price ?? null,
      bestBidQuantity: desktop.market?.bids[0]?.quantity ?? null,
      previousClosePrice: chartPreviousClosePrice,
    }),
    [desktop.market?.asks, desktop.market?.bids, chartPreviousClosePrice],
  );
  const isReferenceOrderBook =
    hasDesktopRuntime &&
    !hasLastOrderBook &&
    referencePriceLadder.asks.length > 0 &&
    referencePriceLadder.bids.length > 0;
  const displayedAsks = useMemo(
    () =>
      isUsOneLevelBook
        ? usPriceLadder.asks
        : desktop.market && desktop.market.asks.length > 0
        ? desktop.market.asks.slice(0, 10).reverse().map((level, index) => ({
            price: formatWholeNumber(level.price, level.price),
            quantity: formatWholeNumber(level.quantity, level.quantity),
            ...orderBookLevelChange(level.price, chartPreviousClosePrice),
            depthBand: (Math.min(10, index + 1) || 1) as
              1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10,
          }))
        : hasDesktopRuntime
          ? referencePriceLadder.asks
          : asks,
    [desktop.market, chartPreviousClosePrice, hasDesktopRuntime, isUsOneLevelBook, referencePriceLadder.asks, usPriceLadder.asks],
  );
  const displayedBids = useMemo(
    () =>
      isUsOneLevelBook
        ? usPriceLadder.bids
        : desktop.market && desktop.market.bids.length > 0
        ? desktop.market.bids.slice(0, 10).map((level, index) => ({
            price: formatWholeNumber(level.price, level.price),
            quantity: formatWholeNumber(level.quantity, level.quantity),
            ...orderBookLevelChange(level.price, chartPreviousClosePrice),
            depthBand: (Math.min(10, index + 1) || 1) as
              1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10,
          }))
        : hasDesktopRuntime
          ? referencePriceLadder.bids
          : bids,
    [desktop.market, chartPreviousClosePrice, hasDesktopRuntime, isUsOneLevelBook, referencePriceLadder.bids, usPriceLadder.bids],
  );
  const hasKisHistory =
    desktop.chart?.state === "READY" &&
    (desktop.chart.source === "KIS_REST" ||
      desktop.chart.source === "KIS_REST_AGGREGATED") &&
    desktop.chart.interval === interval &&
    desktop.chart.range === chartRange &&
    desktop.chart.instrumentId === activeInstrumentId &&
    desktop.chart.candles.length > 0;
  const baseChartCandles = useMemo(
    () =>
      hasKisHistory
      ? desktop.chart!.candles
      : hasDesktopRuntime ||
          desktop.chart?.state === "LOADING" ||
          desktop.chart?.state === "ERROR"
        ? []
        : candles,
    [candles, desktop.chart, hasDesktopRuntime, hasKisHistory],
  );
  const canOverlayLiveTradeOnChart =
    isKisLive &&
    INTRADAY_CHART_INTERVALS.includes(interval);
  useEffect(() => {
    setLiveChartCandles(baseChartCandles);
  }, [baseChartCandles]);
  useEffect(() => {
    const market = desktop.market;
    if (
      !canOverlayLiveTradeOnChart ||
      market?.price === null ||
      market?.price === undefined ||
      market.tradeOccurredAt === null
    ) {
      return;
    }
    setLiveChartCandles((current) =>
      applyLiveTradeToCandles(
        current.length > 0 ? current : baseChartCandles,
        {
          interval,
          occurredAt: market.tradeOccurredAt!,
          price: market.price!,
          cumulativeVolume: market.cumulativeVolume,
          completeSessionHistory:
            desktop.chart?.paginationComplete === true,
        },
      ),
    );
  }, [
    baseChartCandles,
    canOverlayLiveTradeOnChart,
    desktop.chart?.paginationComplete,
    desktop.market,
    desktop.market?.sequence,
    interval,
  ]);
  const displayedCandles =
    hasKisHistory &&
    INTRADAY_CHART_INTERVALS.includes(interval) &&
    liveChartCandles.length > 0
      ? liveChartCandles
      : baseChartCandles;
  const chartReferencePrice = chartCurrentPrice;
  const chartStatusLabel =
    desktop.chart?.interval === interval &&
    desktop.chart.range === chartRange
      ? desktop.chart.statusMessage
      : "KIS 차트 응답 대기 중";
  const tradingSkeletonStatusLabel =
    !hasKisHistory
      ? chartStatusLabel
      : (desktop.market?.statusMessage ?? "KIS 시세 수신 대기");
  const shouldShowTradingSkeleton =
    hasDesktopRuntime &&
    workspacePage === "DASHBOARD" &&
    !hasKisHistory &&
    (!isUsSelection || !hasLastOrderBook);
  const orderBookReferenceStats = useMemo(() => {
    const canDerive52WeekRange =
      desktop.chart?.interval === "1d" &&
      (desktop.chart.range === "1Y" || desktop.chart.range === "5Y");
    const newestDailyTime = canDerive52WeekRange
      ? Math.max(...displayedCandles.map((candle) => Date.parse(candle.openedAt)))
      : Number.NaN;
    const trailingYearCandles = canDerive52WeekRange
      ? displayedCandles.filter(
          (candle) =>
            Date.parse(candle.openedAt) >= newestDailyTime - 366 * 24 * 60 * 60 * 1_000,
        )
      : [];
    const numericHighs = trailingYearCandles
      .map((candle) => Number(candle.high))
      .filter((value) => Number.isFinite(value) && value > 0);
    const numericLows = trailingYearCandles
      .map((candle) => Number(candle.low))
      .filter((value) => Number.isFinite(value) && value > 0);
    const bestAsk = Number(desktop.market?.asks[0]?.price);
    const bestBid = Number(desktop.market?.bids[0]?.price);
    const midpoint =
      Number.isFinite(bestAsk) && Number.isFinite(bestBid)
        ? String(Math.round((bestAsk + bestBid) / 2))
        : null;
    const priceStat = (label: string, value: string | null, dividerBefore = false) => ({
      label,
      value: isUsSelection ? truncateUsPrice(value ?? "", "—") : formatWholeNumber(value, "—"),
      direction: orderBookLevelChange(value ?? "", chartPreviousClosePrice).direction,
      dividerBefore,
    });
    return [
      priceStat("52주 최고", numericHighs.length ? String(Math.max(...numericHighs)) : null),
      priceStat("52주 최저", numericLows.length ? String(Math.min(...numericLows)) : null),
      { label: "상한가", value: "—", direction: "flat" as const, dividerBefore: true },
      { label: "하한가", value: "—", direction: "flat" as const },
      { label: "상승VI", value: "—", direction: "flat" as const },
      { label: "하강VI", value: "—", direction: "flat" as const },
      priceStat("시가", desktop.market?.openPrice ?? null, true),
      priceStat("고가", desktop.market?.highPrice ?? null),
      priceStat("저가", desktop.market?.lowPrice ?? null),
      {
        label: "거래량",
        value: formatWholeNumber(desktop.market?.cumulativeVolume ?? null, "—"),
        direction: "flat" as const,
        dividerBefore: true,
      },
      { label: "어제보다", value: "—", direction: "flat" as const },
      priceStat("중간호가", midpoint, true),
    ];
  }, [chartPreviousClosePrice, desktop.market, displayedCandles, isUsSelection]);
  const activePosition = desktop.account?.positions.find(
    (position) => position.instrumentId === activeInstrumentId,
  );
  const activePositionValuation = useMemo(() => {
    try {
      return valuePaperPosition({
        quantity: activePosition?.quantity ?? "0",
        averagePrice: activePosition?.averagePrice ?? null,
        marketPrice: desktop.market?.price ?? null,
      });
    } catch {
      return null;
    }
  }, [
    activePosition?.averagePrice,
    activePosition?.quantity,
    desktop.market?.price,
  ]);
  const unrealizedPnl = activePositionValuation?.unrealizedPnlMinor ?? null;
  const unrealizedDirection =
    unrealizedPnl === null
      ? "flat"
      : marketDirection(unrealizedPnl);
  const formattedUnrealizedPnl =
    unrealizedPnl === null
      ? "평가 대기"
      : `${unrealizedPnl.startsWith("-") ? "-" : unrealizedPnl === "0" ? "" : "+"}₩${formatWholeNumber(
          unrealizedPnl.replace(/^-/, ""),
          unrealizedPnl,
        )}`;
  const liveThemeProjection = useMemo(
    () => buildLiveThemeLeaders(desktop.ranking),
    [desktop.ranking],
  );
  const marketScopedInformationFeed = useMemo(() => {
    const feed = desktop.informationFeed;
    if (feed === null) return null;
    const providers = new Set(
      isUsSelection
        ? ["KIS_OVERSEAS_NEWS", "FINNHUB_NEWS", "SEC_EDGAR"]
        : ["KIS_DOMESTIC_NEWS", "OPEN_DART"],
    );
    const items = feed.items.filter((item) => providers.has(item.provider));
    const sources = feed.sources.filter((source) => providers.has(source.provider));
    const readyCount = sources.filter((source) => source.state === "READY").length;
    return {
      ...feed,
      items,
      sources,
      statusMessage: `${isUsSelection ? "미국" : "국내"} ${readyCount}개 provider 연결 · 표시 ${items.length}건`,
    };
  }, [desktop.informationFeed, isUsSelection]);
  const liveInformationProjection = useMemo(
    () =>
      buildLiveInformationInsights(
        marketScopedInformationFeed,
        activeInstrumentId,
        activeInstrumentName,
      ),
    [
      activeInstrumentId,
      activeInstrumentName,
      marketScopedInformationFeed,
    ],
  );
  const visibleInformationItems = useMemo(() => {
    const providerItems = (marketScopedInformationFeed?.items ?? []).filter(
      (item) =>
        informationProvider === null || item.provider === informationProvider,
    );
    if (informationScope === "ALL") return providerItems;
    const instrumentIds =
      informationScope === "SELECTED"
        ? new Set([activeInstrumentId])
        : new Set(watchlist.map((item) => item.instrumentId));
    return providerItems.filter((item) =>
      item.relatedInstrumentIds.some((id) => instrumentIds.has(id)),
    );
  }, [
    activeInstrumentId,
    marketScopedInformationFeed?.items,
    informationScope,
    informationProvider,
    watchlist,
  ]);
  const calendarMonth = calendarSelectedDate.slice(0, 7);
  const calendarMonthDays = useMemo(
    () => buildCalendarMonthDays(calendarMonth),
    [calendarMonth],
  );
  const marketCalendarEvents =
    desktop.marketCalendar?.events ?? EMPTY_MARKET_CALENDAR_EVENTS;
  const calendarLoading =
    desktop.marketCalendar?.state === "LOADING" &&
    marketCalendarEvents.length === 0;
  const filteredCalendarEvents = useMemo(() => {
    const events =
      calendarMarketFilter === "ALL"
        ? marketCalendarEvents
        : marketCalendarEvents.filter((event) =>
            event.affectedMarkets.includes(calendarMarketFilter),
          );
    return events
      .filter(
        (event) =>
          calendarCategoryFilter === "ALL" ||
          calendarCategory(event.kind) === calendarCategoryFilter,
      )
      .filter(
        (event) =>
          calendarQualityFilter === "ALL" ||
          event.dataQuality === calendarQualityFilter,
      )
      .sort(
        (left, right) =>
          Date.parse(left.scheduledAt) - Date.parse(right.scheduledAt),
      );
  }, [
    calendarCategoryFilter,
    calendarMarketFilter,
    calendarQualityFilter,
    marketCalendarEvents,
  ]);
  const selectedDateCalendarEvents = filteredCalendarEvents.filter(
    (event) => event.localDate === calendarSelectedDate,
  );
  const upcomingCalendarEvents = filteredCalendarEvents
    .filter((event) => event.localDate >= calendarSelectedDate)
    .slice(0, 8);
  const selectedCalendarEvent =
    filteredCalendarEvents.find((event) => event.id === selectedCalendarEventId) ??
    selectedDateCalendarEvents[0] ??
    upcomingCalendarEvents[0] ??
    null;
  const sidebarInstruments = hasDesktopRuntime
    ? watchlist
      .filter((item) =>
        selectedMarket === "미국"
          ? /^(?:NASDAQ|NYSE|AMEX):/.test(item.instrumentId)
          : item.instrumentId.startsWith("KRX:"),
      )
      .map((item) => {
        const active = item.instrumentId === activeInstrumentId;
        const snapshot = watchlistQuotes.get(item.instrumentId);
        return {
          instrumentId: item.instrumentId,
          symbol: item.symbol,
          name: item.name,
          market: instrumentVenueLabel(item.instrumentId, item.market),
          price: active ? displayPrice : (snapshot?.price ?? "—"),
          changeRate: active
            ? displayChangeRate
            : (snapshot?.changeRate ?? "—"),
          direction: active
            ? displayDirection
            : (snapshot?.direction ?? ("flat" as const)),
          turnover: active
            ? formatKrwTurnoverEok(
                desktop.market?.cumulativeTurnover ?? null,
                "—",
              )
            : (snapshot?.turnover ?? "—"),
          selected: active,
          freshness:
            active && isKisLive
              ? ("live" as const)
              : (snapshot?.freshness ?? ("stale" as const)),
        };
      })
    : instruments;
  const normalizedInstrumentQuery = instrumentQuery.trim();
  const visibleInstrumentSearchItems =
    (selectedMarket === "미국"
      ? isSearchableUsInstrumentQuery(normalizedInstrumentQuery)
      : isSearchableDomesticInstrumentQuery(normalizedInstrumentQuery)) &&
    desktop.instrumentSearch?.query === normalizedInstrumentQuery
      ? desktop.instrumentSearch.items
      : [];

  const openSearchedInstrument = (
    item: DesktopInstrumentSearchItemProjection,
  ) => {
    const isUs = ["NASDAQ", "NYSE", "AMEX"].includes(item.market);
    const selection = item.market === "NASDAQ" ? `NAS:${item.symbol}`
      : item.market === "NYSE" ? `NYS:${item.symbol}`
      : item.market === "AMEX" ? `AMS:${item.symbol}` : item.symbol;
    const workspaceItem = {
      symbol: item.symbol,
      name: item.name,
      market: isUs ? null : item.market as DomesticEquityMarket,
      securityType: item.securityType,
      selection,
    };
    setWorkspaceInstruments((current) =>
      current.some((candidate) => (candidate.selection ?? candidate.symbol) === selection)
        ? current
        : [...current, workspaceItem],
    );
    setSelectedInstrument({
      symbol: item.symbol,
      name: item.name,
      market: isUs ? null : item.market as DomesticEquityMarket,
      securityType: item.securityType,
    });
    setSelectedMarket(isUs ? "미국" : "국내");
    setWorkspacePage("DASHBOARD");
    setInstrumentQuery("");
    setInstrumentSearchOpen(false);
    setNotice(`${item.name}(${item.symbol}) 종목 화면을 여는 중입니다.`);
    instrumentSearchInput.current?.blur();
    void desktop.selectInstrument(selection).then((projection) => {
      if (projection !== null) void desktop.loadChartHistory(interval, chartRange);
    });
  };

  const clampOrderQuantityForSide = (
    side: "BUY" | "SELL",
    quantity: string,
    price: string | null = draft.limitPrice || desktop.market?.price || null,
  ): string => {
    const normalizedQuantity = normalizeWholeNumberInput(quantity);
    if (normalizedQuantity === "") return "";
    const requested = parseWholeNumberInput(normalizedQuantity);
    if (side === "BUY") {
      const priceMinor =
        price === null ? null : currencyDecimalToMinor(price, activeCurrency);
      const cashMinor =
        desktop.account?.baseCurrency === activeCurrency &&
        /^\d+$/.test(desktop.account.cashMinor)
          ? BigInt(desktop.account.cashMinor)
          : null;
      if (priceMinor === null || priceMinor <= 0n || cashMinor === null) {
        return normalizedQuantity;
      }
      const affordableQuantity = cashMinor / priceMinor;
      return requested > affordableQuantity
        ? affordableQuantity.toString()
        : normalizedQuantity;
    }
    const available = parseWholeNumberInput(activePosition?.quantity ?? "0");
    return requested > available ? available.toString() : normalizedQuantity;
  };
  const clampOrderBookInputQuantity = (quantity: string): string => {
    const normalizedQuantity = normalizeWholeNumberInput(quantity);
    if (normalizedQuantity === "") return "";
    const requested = parseWholeNumberInput(normalizedQuantity);
    const heldQuantity = parseWholeNumberInput(activePosition?.quantity ?? "0");
    if (heldQuantity > 0n) {
      return requested > heldQuantity ? heldQuantity.toString() : normalizedQuantity;
    }
    const price = draft.limitPrice || desktop.market?.price || null;
    const priceMinor =
      price === null ? null : currencyDecimalToMinor(price, activeCurrency);
    const cashMinor =
      desktop.account?.baseCurrency === activeCurrency &&
      /^\d+$/.test(desktop.account.cashMinor)
        ? BigInt(desktop.account.cashMinor)
        : null;
    if (priceMinor === null || priceMinor <= 0n || cashMinor === null) {
      return normalizedQuantity;
    }
    const affordableQuantity = cashMinor / priceMinor;
    return requested > affordableQuantity
      ? affordableQuantity.toString()
      : normalizedQuantity;
  };

  const numericQuantity = parseWholeNumberInput(draft.quantity);

  const submitPaperDraft = async (orderDraft: OrderTicketDraft) => {
    const orderPrice = normalizePriceInput(orderDraft.limitPrice, activeCurrency);
    const orderQuantity = parseWholeNumberInput(orderDraft.quantity);
    if (
      orderQuantity <= 0n ||
      (orderDraft.orderType === "LIMIT" && orderPrice === null)
    ) {
      setNotice("수량과 지정가를 올바르게 입력해 주세요.");
      return;
    }
    if (
      isPaperOrderSession &&
      desktop.account?.storageState === "READY"
    ) {
      const requestId = `paper-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      const result = await desktop.submitPaperOrder({
        requestId,
        instrumentId: activeInstrumentId,
        side: orderDraft.side,
        orderType: orderDraft.orderType,
        quantity: orderQuantity.toString(),
        limitPrice:
          orderDraft.orderType === "LIMIT" ? orderPrice : null,
      });
      if (result?.accepted) {
        playPaperOrderChime();
        const statusLabel =
          result.status === "FILLED"
            ? "전량 체결"
            : result.status === "PARTIALLY_FILLED"
              ? "부분 체결"
              : result.status === "RESTING"
                ? "미체결 대기"
                : result.status;
        setNotice(`${orderDraft.side === "BUY" ? "매수" : "매도"} 주문 · ${statusLabel} · 로컬 SQLite 저장 완료${result.status === "RESTING" ? " (체결 전에는 보유수량·평가손익이 변하지 않습니다)" : ""}`);
      } else {
        setNotice(
          `모의주문 거절 · ${result?.rejectionCode ?? "LOCAL_RUNTIME_ERROR"}`,
        );
      }
      return;
    }

    if (hasDesktopRuntime) {
      setNotice(
        desktop.account?.storageState !== "READY"
          ? "SQLite 모의계좌가 준비되지 않아 주문하지 않았습니다."
          : "장마감이거나 최근 호가 스냅샷이 없어 호가 클릭 모의주문을 잠급니다.",
      );
      return;
    }

    const lastCandle = displayedCandles.at(-1);
    if (!lastCandle) return;
    const marker: PaperFillMarkerViewModel = {
      id: `preview-fill-${Date.now()}`,
      orderId: `preview-order-${Date.now()}`,
      filledAt: lastCandle.openedAt,
      price:
        orderDraft.orderType === "MARKET"
          ? lastCandle.close
          : orderDraft.limitPrice.replaceAll(",", ""),
      quantity: orderDraft.quantity,
      side: orderDraft.side,
      completion: "PARTIAL",
      source: "LOCAL_PAPER_FILL",
    };
    setFillMarkers((current) => [...current, marker]);
    setNotice(
      `${orderDraft.side === "BUY" ? "매수" : "매도"} ${orderDraft.quantity}주 주문 미리보기 마커를 차트에 추가했습니다.`,
    );
  };
  const submitOrderBookLevel = (side: "BUY" | "SELL", price: string) => {
    const quantity = clampOrderQuantityForSide(side, draft.quantity, price);
    if (parseWholeNumberInput(quantity) <= 0n) {
      setDraft((current) => ({
        ...current,
        side,
        orderType: "LIMIT",
        limitPrice: price,
        quantity,
      }));
      setNotice(
        side === "BUY"
          ? "가용 현금으로는 선택한 가격에서 매수 가능한 수량이 없습니다."
          : "선택 종목의 매도 가능 보유수량이 없습니다.",
      );
      return;
    }
    const nextDraft: OrderTicketDraft = {
      ...draft,
      side,
      orderType: "LIMIT",
      limitPrice: price,
      quantity,
    };
    setDraft(nextDraft);
    setNotice(
      `${side === "BUY" ? "매수" : "매도"} ${quantity}주 · ${price} 로컬 주문 처리 중`,
    );
    void submitPaperDraft(nextDraft);
  };

  const cancelPendingOrder = async (clientOrderId: string) => {
    if (!hasDesktopRuntime || desktop.account?.storageState !== "READY") {
      setNotice("SQLite 로컬 계좌가 준비되지 않아 대기 주문을 취소하지 않았습니다.");
      return;
    }
    const result = await desktop.cancelPaperOrder({
      requestId: `paper-cancel-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
      clientOrderId,
      instrumentId: activeInstrumentId,
    });
    if (result?.accepted) {
      setNotice("대기 주문을 취소했습니다. 로컬 SQLite 계좌에만 반영됩니다.");
    } else {
      setNotice(
        `대기 주문 취소 거절 · ${result?.rejectionCode ?? "LOCAL_RUNTIME_ERROR"}`,
      );
    }
  };

  return (
    <div className="app-shell">
      <header className="global-header">
        <div className="brand">
          <span className="brand__mark">
            <CandlestickChart size={20} />
          </span>
          <div>
            <strong>PAPERFLOW</strong>
            <small>PERSONAL HTS</small>
          </div>
        </div>

        <label className="market-selector">
          <span className="sr-only">시장 선택</span>
          <select
            value={selectedMarket}
            onChange={(event) => {
              const market = event.target.value;
              setSelectedMarket(market);
              if (hasDesktopRuntime && market === "미국") {
                setSelectedInstrument({ symbol: "AAPL", name: "Apple", market: null, securityType: "STOCK" });
                setDraft((current) => ({ ...current, limitPrice: "" }));
                setNotice("Apple(AAPL) 미국 3개 세션 실시간 시세를 연결하는 중입니다.");
                void desktop.selectInstrument("NAS:AAPL").then((projection) => {
                  if (projection !== null) void desktop.loadChartHistory(interval, chartRange);
                });
              } else if (hasDesktopRuntime && market === "국내" && ["NASDAQ", "NYSE", "AMEX"].includes(desktop.market?.venue ?? "")) {
                setSelectedInstrument({ symbol: "005930", name: "삼성전자", market: "KOSPI", securityType: "STOCK" });
                setDraft((current) => ({ ...current, limitPrice: "" }));
                setNotice("삼성전자(005930) 국내 통합 시세를 연결하는 중입니다.");
                void desktop.selectInstrument("005930").then((projection) => {
                  if (projection !== null) void desktop.loadChartHistory(interval, chartRange);
                });
              }
            }}
          >
            <option>국내</option>
            <option>미국</option>
            <option disabled={hasDesktopRuntime}>
              글로벌 선행지표 · 연결 준비 중
            </option>
          </select>
          <ChevronDown size={14} aria-hidden="true" />
        </label>

        <div
          className="global-search"
          ref={instrumentSearchRoot}
          data-open={instrumentSearchOpen && instrumentQuery.trim().length > 0}
        >
          <Search size={16} aria-hidden="true" />
          <input
            ref={instrumentSearchInput}
            type="search"
            value={instrumentQuery}
            placeholder={selectedMarket === "미국" ? "미국 티커 (예: AAPL, NYS:IBM)" : "종목명 · 종목코드 검색"}
            aria-label={selectedMarket === "미국" ? "미국 종목 티커 검색" : "국내 종목 검색"}
            aria-autocomplete="list"
            aria-controls="domestic-instrument-search-results"
            aria-expanded={
              instrumentSearchOpen && instrumentQuery.trim().length > 0
            }
            autoComplete="off"
            disabled={!hasDesktopRuntime}
            onFocus={() => setInstrumentSearchOpen(true)}
            onChange={(event) => {
              setInstrumentQuery(event.target.value.slice(0, 40));
              setInstrumentSearchOpen(true);
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              const items = visibleInstrumentSearchItems;
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setInstrumentSearchIndex((current) =>
                  items.length === 0 ? 0 : (current + 1) % items.length,
                );
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setInstrumentSearchIndex((current) =>
                  items.length === 0
                    ? 0
                    : (current - 1 + items.length) % items.length,
                );
              } else if (event.key === "Enter") {
                const item = items[instrumentSearchIndex];
                if (item) {
                  event.preventDefault();
                  openSearchedInstrument(item);
                }
              }
            }}
          />
          <kbd>Ctrl K</kbd>
          {instrumentSearchOpen && instrumentQuery.trim().length > 0 ? (
            <div
              className="global-search__results"
              id="domestic-instrument-search-results"
              role="listbox"
              aria-label={selectedMarket === "미국" ? "미국 종목 검색 결과" : "국내 종목 검색 결과"}
            >
              <div className="global-search__status">
                {!(selectedMarket === "미국" ? isSearchableUsInstrumentQuery(instrumentQuery) : isSearchableDomesticInstrumentQuery(instrumentQuery))
                  ? selectedMarket === "미국" ? "회사명 또는 티커를 입력하세요." : "완성형 한글 1자 또는 종목코드를 입력하세요."
                  : instrumentSearchLoading
                  ? "KIS 종목 마스터 검색 중…"
                  : (desktop.instrumentSearch?.statusMessage ??
                    "검색어를 확인하고 있습니다.")}
              </div>
              {!instrumentSearchLoading &&
              (selectedMarket === "미국" ? isSearchableUsInstrumentQuery(instrumentQuery) : isSearchableDomesticInstrumentQuery(instrumentQuery))
                ? visibleInstrumentSearchItems.map(
                    (item, index) => (
                      <button
                        type="button"
                        role="option"
                        aria-selected={index === instrumentSearchIndex}
                        className={
                          index === instrumentSearchIndex
                            ? "global-search__result global-search__result--active"
                            : "global-search__result"
                        }
                        key={item.instrumentId}
                        onMouseDown={(event) => event.preventDefault()}
                        onMouseEnter={() => setInstrumentSearchIndex(index)}
                        onClick={() => openSearchedInstrument(item)}
                      >
                        <span>
                          <strong>{item.name}</strong>
                          <small>{item.symbol}</small>
                        </span>
                        <em>{item.market}</em>
                      </button>
                    ),
                  )
                : null}
              {!instrumentSearchLoading &&
              (selectedMarket === "미국" ? isSearchableUsInstrumentQuery(instrumentQuery) : isSearchableDomesticInstrumentQuery(instrumentQuery)) &&
              desktop.instrumentSearch?.state === "READY" &&
              desktop.instrumentSearch.query === normalizedInstrumentQuery &&
              visibleInstrumentSearchItems.length === 0 ? (
                <p className="global-search__empty">
                  일치하는 {selectedMarket === "미국" ? "미국" : "KOSPI·KOSDAQ"} 종목이 없습니다.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="connection-summary">
          <span
            className={isKisLive ? "live-dot" : "offline-dot"}
            aria-hidden="true"
          />
          <span>
            <strong>
              {isKisLive
                ? "KIS READ ONLY"
                : hasRestSnapshot
                  ? "KIS REST SNAPSHOT"
                  : "KIS READ ONLY 준비"}
            </strong>
            <small>
              {desktop.loading
                ? "로컬 projection 준비 중"
                : hasRestSnapshot
                  ? "REST snapshot 사용 · WS 실시간 갱신 대기"
                  : (desktop.market?.statusMessage ?? "WS 미연결 · fixture")}
            </small>
          </span>
        </div>

        <div className="theme-switcher" role="group" aria-label="화면 테마">
          <button
            type="button"
            aria-label="라이트 모드"
            aria-pressed={themePreference === "light"}
            onClick={() => setThemePreference("light")}
          >
            <Sun size={15} />
          </button>
          <button
            type="button"
            aria-label="시스템 테마"
            aria-pressed={themePreference === "system"}
            onClick={() => setThemePreference("system")}
          >
            A
          </button>
          <button
            type="button"
            aria-label="다크 모드"
            aria-pressed={themePreference === "dark"}
            onClick={() => setThemePreference("dark")}
          >
            <Moon size={15} />
          </button>
        </div>

        <button className="header-icon" type="button" aria-label="알림">
          <Bell size={17} />
          <span />
        </button>
      </header>

      <aside className="navigation-rail" aria-label="주요 메뉴">
        <nav>
          <button
            type="button"
            className={workspacePage === "DASHBOARD" ? "active" : undefined}
            aria-label="시장 대시보드"
            onClick={() => setWorkspacePage("DASHBOARD")}
          >
            <LayoutDashboard />
          </button>
          <button
            type="button"
            className={workspacePage === "RANKINGS" ? "active" : undefined}
            aria-label="종목 순위"
            onClick={() => setWorkspacePage("RANKINGS")}
          >
            <BarChart3 />
          </button>
          <button
            type="button"
            className={workspacePage === "PORTFOLIO" ? "active" : undefined}
            aria-label="포트폴리오"
            onClick={() => setWorkspacePage("PORTFOLIO")}
          >
            <BriefcaseBusiness />
          </button>
          <button
            type="button"
            className={workspacePage === "ORDERS" ? "active" : undefined}
            aria-label="주문 내역"
            onClick={() => setWorkspacePage("ORDERS")}
          >
            <WalletCards />
          </button>
          <button
            type="button"
            className={workspacePage === "CALENDAR" ? "active" : undefined}
            aria-label="이벤트 캘린더"
            onClick={() => setWorkspacePage("CALENDAR")}
          >
            <CalendarDays />
          </button>
          <button
            type="button"
            className={workspacePage === "NEWS" ? "active" : undefined}
            aria-label="뉴스와 공시"
            onClick={() => setWorkspacePage("NEWS")}
          >
            <Newspaper />
          </button>
          <button
            type="button"
            className={workspacePage === "NOTES" ? "active" : undefined}
            aria-label="분석 노트"
            onClick={() => setWorkspacePage("NOTES")}
          >
            <BookOpenText />
          </button>
        </nav>
        <div>
          <button
            type="button"
            className={workspacePage === "SECURITY" ? "active" : undefined}
            aria-label="보안 상태"
            onClick={() => setWorkspacePage("SECURITY")}
          >
            <ShieldCheck />
          </button>
          <button
            type="button"
            className={workspacePage === "SETTINGS" ? "active" : undefined}
            aria-label="설정"
            onClick={() => setWorkspacePage("SETTINGS")}
          >
            <Settings />
          </button>
        </div>
      </aside>

      <MarketSidebar
        markets={["국내", "미국", "ETF"]}
        selectedMarket={selectedMarket === "미국" ? "미국" : "국내"}
        instruments={sidebarInstruments}
        onMarketChange={setSelectedMarket}
        onInstrumentSelect={(instrumentId) => {
          if (!hasDesktopRuntime) {
            setNotice(`${instrumentId} fixture workspace를 선택했습니다.`);
            return;
          }
          const item = watchlist.find(
            (candidate) => candidate.instrumentId === instrumentId,
          );
          if (!item) return;
          setSelectedInstrument({
            symbol: item.symbol,
            name: item.name,
            market:
              item.market === "KOSPI" || item.market === "KOSDAQ"
                ? item.market
                : null,
            securityType: item.securityType,
          });
          setWorkspacePage("DASHBOARD");
          setNotice(`${item.name}(${item.symbol}) 종목 화면을 여는 중입니다.`);
          const selection = item.instrumentId.startsWith("NASDAQ:")
            ? `NAS:${item.symbol}`
            : item.instrumentId.startsWith("NYSE:")
              ? `NYS:${item.symbol}`
              : item.instrumentId.startsWith("AMEX:")
                ? `AMS:${item.symbol}`
                : item.symbol;
          setSelectedMarket(selection.includes(":") ? "미국" : "국내");
          void desktop.selectInstrument(selection).then((projection) => {
            if (projection !== null) void desktop.loadChartHistory(interval, chartRange);
          });
        }}
      />

      <main className="workspace">
        <div className="workspace-tabs">
          {workspacePage === "DASHBOARD" ? (
            workspaceInstruments.map((item) => (
              <button
                type="button"
                key={item.symbol}
                className={item.symbol === activeSymbol ? "active" : undefined}
                onClick={() => {
                  if (item.symbol === activeSymbol) return;
                  setSelectedInstrument(item);
                  setNotice(`${item.name}(${item.symbol}) 종목 화면을 여는 중입니다.`);
                  const selection = item.selection ?? item.symbol;
                  setSelectedMarket(selection.includes(":") ? "미국" : "국내");
                  void desktop.selectInstrument(selection).then((projection) => {
                    if (projection !== null) void desktop.loadChartHistory(interval, chartRange);
                  });
                }}
              >
                {item.name} <span>{item.symbol}</span>
              </button>
            ))
          ) : (
            <button type="button" className="active">
              {WORKSPACE_PAGE_LABELS[workspacePage]}
            </button>
          )}
          {workspacePage === "DASHBOARD" && !hasDesktopRuntime ? (
            <button type="button">
              SK하이닉스 <span>000660</span>
            </button>
          ) : null}
          {workspacePage === "DASHBOARD" ? (
            <button
              type="button"
              className="add-tab"
              aria-label="작업공간 추가"
              onClick={() => {
                setInstrumentSearchOpen(true);
                instrumentSearchInput.current?.focus();
                setNotice("추가할 국내 종목을 검색해 선택하세요.");
              }}
              disabled={!hasDesktopRuntime}
              title="검색해서 종목 탭 추가"
            >
              +
            </button>
          ) : null}
          <div className="fixture-badge">
            {isKisLive
              ? "KIS LIVE · READ ONLY"
              : hasRestSnapshot
                ? "REST snapshot 사용 · WS 대기"
              : hasDesktopRuntime
                ? "KIS 연결 대기 · 합성 시세 없음"
                : "FIXTURE UI"}
          </div>
        </div>

        {workspacePage === "DASHBOARD" ? (
          shouldShowTradingSkeleton ? (
            <TradingWorkspaceSkeleton statusLabel={tradingSkeletonStatusLabel} />
          ) : (
            <>
        <MarketContextStrip
          projection={desktop.marketContext}
          onRefresh={() => {
            void desktop.loadMarketContext(true);
          }}
        />

        {!isUsSelection ? (
          <InvestorFlowPanel
            scope="MARKET"
            projection={desktop.investorFlow}
            onRefresh={() => void desktop.loadInvestorFlow()}
          />
        ) : null}
        <InstrumentHeader
          name={activeInstrumentName}
          symbol={activeSymbol}
          market={desktop.market?.venue ?? (isUsSelection ? "미국" : "KRX")}
          currency={activeCurrency}
          price={displayPrice}
          change={displayChange}
          changeRate={displayChangeRate}
          direction={displayDirection}
          sessionLabel={sessionLabel}
          asOfLabel={
            desktop.market?.providerTime
              ? `${desktop.market.providerTime} KST`
              : hasDesktopRuntime
                ? "수신 대기"
                : "fixture 10:32:18 KST"
          }
          status={marketStatus}
          watched={watched}
          onToggleWatch={() => {
            setWatchlist((current) => {
              if (
                current.some(
                  (item) => item.instrumentId === activeInstrumentId,
                )
              ) {
                return current.filter(
                  (item) => item.instrumentId !== activeInstrumentId,
                );
              }
              return [
                ...current,
                {
                  instrumentId: activeInstrumentId,
                  symbol: activeSymbol,
                  name: activeInstrumentName,
                  market: isUsMarket
                    ? (desktop.market?.venue as "NASDAQ" | "NYSE" | "AMEX")
                    : activeDomesticMarket,
                  securityType: activeSecurityType,
                },
              ];
            });
          }}
          metrics={[
            {
              label: isClosedMarket ? "종가" : "전일 종가",
              value: formatMarketPrice(
                isClosedMarket
                  ? desktop.market?.price ?? null
                  : chartPreviousClosePrice,
                activeCurrency,
                "—",
              ),
            },
            {
              label: "시가",
              value: formatMarketPrice(
                desktop.market?.openPrice ?? null,
                activeCurrency,
                hasDesktopRuntime ? "—" : "83,100",
              ),
            },
            {
              label: "고가",
              value: formatMarketPrice(
                desktop.market?.highPrice ?? null,
                activeCurrency,
                hasDesktopRuntime ? "—" : "85,200",
              ),
              direction: "positive",
            },
            {
              label: "저가",
              value: formatMarketPrice(
                desktop.market?.lowPrice ?? null,
                activeCurrency,
                hasDesktopRuntime ? "—" : "82,900",
              ),
              direction: "negative",
            },
            {
              label: "거래량",
              value: formatWholeNumber(
                desktop.market?.cumulativeVolume ?? null,
                hasDesktopRuntime ? "—" : "18,421,502",
              ),
            },
            {
              label: "거래대금",
              value:
                activeCurrency === "USD"
                  ? formatCompactUsdTurnover(
                      desktop.market?.cumulativeTurnover,
                      hasDesktopRuntime ? "" : "$27.27B",
                    )
                  : formatKrwTurnoverEok(
                      desktop.market?.cumulativeTurnover ?? null,
                      hasDesktopRuntime ? "" : "1.42조",
                    ),
            },
          ]}
        />

        <PortfolioStrip
          accountName="나의 모의 계좌"
          valuationQuality={
            !hasDesktopRuntime
              ? "complete"
              : desktop.market?.freshness === "stale"
                ? "stale"
                : (desktop.account?.positions.length ?? 0) === 0 ||
                    unrealizedPnl !== null
                  ? "complete"
                  : "partial"
          }
          values={[
            {
              label: "가용 현금",
              value: hasDesktopRuntime
                ? formatCashMinor(desktop.account?.cashMinor, desktop.account?.baseCurrency ?? activeCurrency)
                : "₩47,230,000",
            },
            {
              label: "평가 손익",
              value: hasDesktopRuntime
                ? formattedUnrealizedPnl
                : "+₩847,500",
              subValue: hasDesktopRuntime
                ? activePositionValuation?.unrealizedReturnRate !== null &&
                  activePositionValuation?.unrealizedReturnRate !== undefined
                  ? `${activePositionValuation.unrealizedReturnRate.startsWith("-") ? "" : "+"}${activePositionValuation.unrealizedReturnRate}% · 청산비용 전`
                  : "보유 종목 없음"
                : "+0.83%",
              direction: hasDesktopRuntime
                ? unrealizedDirection
                : "positive",
            },
            {
              label: "저장 상태",
              value:
                desktop.account?.storageState === "READY"
                  ? "SQLite READY"
                  : hasDesktopRuntime
                    ? "연결 대기"
                    : "fixture",
            },
            {
              label: `${activeInstrumentName} 보유`,
              value: activePosition
                ? `${formatWholeNumber(activePosition.quantity, activePosition.quantity)}주`
                : hasDesktopRuntime
                  ? "0주"
                  : "+₩528,000",
              ...(activePosition?.averagePrice
                ? {
                    subValue: `평균 ${formatInstrumentPrice(activePosition.averagePrice, activePosition.instrumentId)}`,
                  }
                : {}),
              direction: hasDesktopRuntime ? "flat" : "positive",
            },
          ]}
        />

        <div className="trading-grid">
          <OrderBookPanel
            instrumentId={activeInstrumentId}
            asks={displayedAsks}
            bids={displayedBids}
            totalAskQuantity={formatWholeNumber(
              desktop.market?.totalAskQuantity ?? null,
              hasDesktopRuntime ? "—" : "462,140",
            )}
            totalBidQuantity={formatWholeNumber(
              desktop.market?.totalBidQuantity ?? null,
              hasDesktopRuntime ? "—" : "589,320",
            )}
            currentPrice={displayPrice}
            currentPriceLabel={isClosedMarket ? "마지막 종가" : "현재가"}
            executionStrength={desktop.market?.executionStrength ?? null}
            recentTrades={observedTrades
              .filter((trade) => trade.instrumentId === activeInstrumentId)
              .slice(0, 8)
              .map((trade) => ({
                ...trade,
                price: formatWholeNumber(trade.price, trade.price),
                quantity:
                  trade.quantity === null
                    ? null
                    : formatWholeNumber(trade.quantity, trade.quantity),
              }))}
            referenceStats={orderBookReferenceStats}
            upperLimitPrice={domesticPriceLimits.upperLimitPrice}
            lowerLimitPrice={domesticPriceLimits.lowerLimitPrice}
            currentDirection={displayDirection}
            freshness={
              isKisLive
                ? "live"
                : isClosedMarket && hasLastOrderBook
                  ? "closed"
                  : hasLastOrderBook
                    ? "stale"
                    : "offline"
            }
            dataMode={hasDesktopRuntime ? "REAL" : "FIXTURE"}
            referenceOnly={isReferenceOrderBook}
            depthLabel={
              isUsOneLevelBook
                ? "미국 실제 1호가 + 참고 가격대"
                : isUsMarket
                  ? `미국 실제 ${Math.min(desktop.market?.bids.length ?? 0, desktop.market?.asks.length ?? 0)}호가`
                : isReferenceOrderBook
                  ? "잔량 미수신"
                  : "국내 통합 10호가"
            }
            asOfLabel={
              desktop.market?.providerTime
                ? `${desktop.market.providerTime} 마지막 수신`
                :
              (hasDesktopRuntime ? "수신 대기" : "fixture 10:32:18.421")
            }
            orderQuantity={draft.quantity}
            canOrderFromLevel={
              hasDesktopRuntime &&
              hasLastOrderBook &&
              isPaperOrderSession &&
              desktop.account?.storageState === "READY" &&
              numericQuantity > 0n
            }
            levelOrderDisabledReason={
              !hasLastOrderBook
                ? "실제 호가 잔량을 수신한 뒤 주문할 수 있습니다."
                : !isPaperOrderSession
                ? "장마감이거나 최근 호가 스냅샷이 없어 호가 클릭 주문을 잠급니다."
                : desktop.account?.storageState !== "READY"
                  ? "SQLite 로컬 계좌를 준비하는 중입니다."
                  : "수량을 입력해 주세요."
            }
            onOrderQuantityChange={(quantity) =>
              setDraft((current) => ({
                ...current,
                quantity: clampOrderBookInputQuantity(quantity),
              }))
            }
            onLevelOrder={submitOrderBookLevel}
            onPendingOrderCancel={cancelPendingOrder}
            pendingOrders={(desktop.account?.openOrders ?? []).filter(
              (order) => order.instrumentId === activeInstrumentId,
            )}
          />

          <MarketChart
            instrumentId={activeInstrumentId}
            instrumentName={activeInstrumentName}
            currency={activeCurrency}
            interval={interval}
            range={chartRange}
            ranges={chartRanges}
            candles={displayedCandles}
            indicators={indicators}
            fillMarkers={fillMarkers}
            currentPrice={chartReferencePrice}
            previousClosePrice={chartPreviousClosePrice}
            freshness={
              hasKisHistory
                ? canOverlayLiveTradeOnChart
                  ? "LIVE"
                  : desktop.market?.freshness === "stale"
                    ? "STALE"
                    : "DELAYED"
                : "OFFLINE"
            }
            marketDataSource={
              hasKisHistory
                ? "KIS_CANONICAL_MARKET_DATA"
                : hasDesktopRuntime
                  ? "UNAVAILABLE"
                  : "SYNTHETIC_UI_FIXTURE"
            }
            turnoverQuality={
              desktop.chart?.turnoverQuality ??
              (hasDesktopRuntime ? "UNAVAILABLE" : "LOCAL_TRADE_AGGREGATE")
            }
            historyComplete={
              desktop.chart?.paginationComplete ?? !hasDesktopRuntime
            }
            onIntervalChange={handleChartIntervalChange}
            onRangeChange={setChartRange}
            onIndicatorToggle={(indicatorId, visible) =>
              setIndicators((current) =>
                current.map((indicator) =>
                  indicator.id === indicatorId
                    ? { ...indicator, visible }
                    : indicator,
                ),
              )
            }
            onIndicatorAdd={(indicator) =>
              setIndicators((current) => [
                ...current,
                {
                  ...indicator,
                  id: `${indicator.source}-${indicator.kind}-${indicator.period}`,
                  visible: true,
                },
              ])
            }
          />

        </div>

        {!isUsSelection ? (
          <InvestorFlowPanel
            scope="INSTRUMENT"
            projection={desktop.investorFlow}
            onRefresh={() => void desktop.loadInvestorFlow()}
          />
        ) : null}
        <ShortSellingPanel
          instrumentId={activeInstrumentId}
          symbol={activeSymbol}
          marketScope={isUsSelection ? "US" : "KR"}
          projection={desktop.shortSelling}
          onRefresh={() => void desktop.loadShortSelling()}
        />

        <div
          className={
            isUsSelection ? "insight-grid insight-grid--wide" : "insight-grid"
          }
        >
          {!isUsSelection ? (
            <ThemeLeaders
              items={hasDesktopRuntime ? liveThemeProjection.items : themes}
              asOfLabel={
                hasDesktopRuntime
                  ? liveThemeProjection.asOfLabel
                  : "10:32 KST · 동시간 20일 중앙값 기준"
              }
              onThemeSelect={(themeId) => {
                setWorkspacePage("RANKINGS");
                setRankingSort("TURNOVER");
                setNotice(
                  `${themeId} 후보의 근거인 거래대금 상위 100위 화면으로 이동했습니다.`,
                );
              }}
            />
          ) : null}
          <NewsPanel
            news={hasDesktopRuntime ? liveInformationProjection.news : news}
            contexts={
              hasDesktopRuntime ? liveInformationProjection.contexts : contexts
            }
            onNewsSelect={(id) => {
              setWorkspacePage("NEWS");
              setNotice(`${id} 항목의 실제 뉴스·공시 피드로 이동했습니다.`);
            }}
            onContextSelect={(id) => {
              setWorkspacePage("NEWS");
              setNotice(`${id} 맥락의 근거 피드로 이동했습니다.`);
            }}
          />
        </div>
            </>
          )
        ) : null}

        {workspacePage !== "DASHBOARD" ? (
          <section className="pt-functional-page" aria-live="polite">
            <header>
              <p className="pt-eyebrow">LOCAL DESKTOP WORKSPACE</p>
              <h1>{WORKSPACE_PAGE_LABELS[workspacePage]}</h1>
              <p>
                실제 KIS 읽기 전용 데이터와 로컬 SQLite 모의계좌만 사용합니다.
                연결되지 않은 항목에는 합성 수치를 표시하지 않습니다.
              </p>
            </header>

            {workspacePage === "RANKINGS" ? (
              <article className="pt-page-card pt-page-card--wide">
                <div className="pt-page-card__toolbar">
                  <div>
                    <h2>{isUsSelection ? "KIS 미국 일일 거래 순위" : "KIS KRX 일일 거래 순위"}</h2>
                    <p>
                      {desktop.ranking?.statusMessage ??
                        "KIS 읽기 전용 거래 순위를 불러오는 중입니다."}
                      {" "}카테고리별 최대 100위까지만 표시합니다.
                    </p>
                  </div>
                  <label>
                    정렬
                    <select
                      value={rankingSort}
                      onChange={(event) =>
                        setRankingSort(
                          event.currentTarget.value as DesktopRankingSort,
                        )
                      }
                    >
                      <option value="TURNOVER">거래대금</option>
                      <option value="CHANGE_RATE_GAINERS">상승률</option>
                      <option value="CHANGE_RATE_LOSERS">하락률</option>
                      <option value="AVERAGE_VOLUME">
                        오늘 거래량 (KIS 후보)
                      </option>
                      <option value="VOLUME_INCREASE">
                        전일 대비 거래량
                      </option>
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      void desktop.loadRanking(isUsSelection ? "US" : "KRX", rankingSort)
                    }
                  >
                    새로고침
                  </button>
                </div>
                {desktop.ranking?.state === "READY" &&
                desktop.ranking.items.length > 0 ? (
                  <div className="pt-ranking-table-wrap">
                    <table>
                      <colgroup>
                        <col className="pt-ranking-col--rank" />
                        <col className="pt-ranking-col--instrument" />
                        <col className="pt-ranking-col--price" />
                        <col className="pt-ranking-col--change" />
                        <col className="pt-ranking-col--volume" />
                        <col className="pt-ranking-col--volume-rate" />
                        <col className="pt-ranking-col--turnover" />
                      </colgroup>
                      <thead>
                        <tr>
                          <th>순위</th>
                          <th>종목</th>
                          <th>현재가 / 장마감 종가</th>
                          <th>등락률</th>
                          <th>당일 거래량 (현재까지)</th>
                          <th title="오늘 현재까지 누적 거래량을 직전 거래일 하루 전체 거래량과 비교합니다.">
                            전일 총거래량 대비(장중)
                          </th>
                          <th>당일 거래대금 (현재까지)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {desktop.ranking.items.slice(0, 100).map((item) => {
                          const itemDirection = marketDirection(
                            item.changeRate,
                          );
                          const volumeDirection = marketDirection(
                            item.volumeIncreaseRate,
                          );
                          const rankingSelection = item.instrumentId.startsWith("NASDAQ:")
                            ? `NAS:${item.symbol}`
                            : item.instrumentId.startsWith("NYSE:")
                              ? `NYS:${item.symbol}`
                              : item.instrumentId.startsWith("AMEX:")
                                ? `AMS:${item.symbol}`
                                : item.symbol;
                          return (
                          <tr
                            key={`${desktop.ranking?.sort}:${item.symbol}`}
                            role="button"
                            tabIndex={0}
                            data-direction={itemDirection}
                            onClick={() => {
                              setSelectedInstrument({
                                symbol: item.symbol,
                                name: item.name,
                                market: null,
                                securityType: null,
                              });
                              setWorkspacePage("DASHBOARD");
                              setNotice(
                                `${item.name}(${item.symbol}) 종목 화면을 여는 중입니다.`,
                              );
                              void desktop.selectInstrument(rankingSelection).then((projection) => {
                                if (projection !== null) void desktop.loadChartHistory(interval, chartRange);
                              });
                            }}
                            onKeyDown={(event) => {
                              if (
                                event.key !== "Enter" &&
                                event.key !== " "
                              ) {
                                return;
                              }
                              event.preventDefault();
                              event.currentTarget.click();
                            }}
                          >
                            <td>
                              <span
                                className="pt-ranking-rank"
                                data-podium={
                                  Number(item.rank) <= 3
                                    ? item.rank
                                    : undefined
                                }
                              >
                                {item.rank}
                              </span>
                            </td>
                            <td>
                              <span className="pt-ranking-instrument">
                                <span className="pt-ranking-instrument__text">
                                  <strong>{item.name}</strong>
                                  <small>{item.symbol} · {instrumentVenueLabel(item.instrumentId)}</small>
                                </span>
                              </span>
                            </td>
                            <td className="pt-ranking-price">
                              {/^(NASDAQ|NYSE|AMEX):/.test(item.instrumentId) ? truncateUsPrice(item.price) : formatWholeNumber(item.price, "—")}
                              <small>{/^(NASDAQ|NYSE|AMEX):/.test(item.instrumentId) ? "USD" : "원"}</small>
                            </td>
                            <td
                              className={`pt-ranking-rate ${itemDirection}`}
                            >
                              <span>{item.changeRate}%</span>
                            </td>
                            <td className="pt-ranking-volume">
                              {formatWholeNumber(
                                item.cumulativeVolume,
                                "—",
                              )}
                              <small>주</small>
                            </td>
                            <td
                              className={`pt-ranking-volume-rate ${volumeDirection}`}
                            >
                              <span>
                                {item.volumeIncreaseRate === null
                                  ? "—"
                                  : `${item.volumeIncreaseRate}%`}
                              </span>
                            </td>
                            <td className="pt-ranking-turnover">
                              <strong>
                                {/^(NASDAQ|NYSE|AMEX):/.test(item.instrumentId)
                                  ? `$${formatWholeNumber(item.cumulativeTurnover?.split(".")[0] ?? null, "—")}`
                                  : formatKrwTurnoverEok(item.cumulativeTurnover, "—")}
                              </strong>
                            </td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="pt-empty-state">
                    <BarChart3 />
                    <strong>
                      {desktop.ranking?.state === "ERROR"
                        ? "KIS 거래 순위를 불러오지 못했습니다"
                        : "실제 KIS 거래 순위를 기다리는 중입니다"}
                    </strong>
                    <span>
                      {isUsSelection
                        ? "합성 순위는 표시하지 않습니다. KIS 미국 NASDAQ·NYSE·AMEX 읽기 전용 순위를 조회합니다."
                        : "합성 순위는 표시하지 않습니다. 국내 등락률 전용 순위와 뉴스는 실전 데이터 키가 필요합니다."}
                    </span>
                  </div>
                )}
              </article>
            ) : null}

            {workspacePage === "PORTFOLIO" ? (
              <div className="pt-page-grid">
                <article className="pt-page-card">
                  <h2>모의계좌</h2>
                  <dl>
                    <div>
                      <dt>가용 현금</dt>
                      <dd>
                        {formatCashMinor(desktop.account?.cashMinor, desktop.account?.baseCurrency ?? activeCurrency)}
                      </dd>
                    </div>
                    <div>
                      <dt>저장소</dt>
                      <dd>
                        {desktop.account?.storageState === "READY"
                          ? "SQLite READY"
                          : "연결 대기"}
                      </dd>
                    </div>
                  </dl>
                </article>
                <article className="pt-page-card pt-page-card--wide">
                  <h2>보유 종목</h2>
                  {desktop.account?.positions.length ? (
                    <table>
                      <thead>
                        <tr>
                          <th>종목</th>
                          <th>수량</th>
                          <th>평균단가</th>
                        </tr>
                      </thead>
                      <tbody>
                        {desktop.account.positions.map((position) => (
                          <tr key={position.instrumentId}>
                            <td>{position.instrumentId}</td>
                            <td>{position.quantity}주</td>
                            <td>
                              {position.averagePrice
                                ? formatInstrumentPrice(position.averagePrice, position.instrumentId)
                                : "계산 대기"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="pt-page-card__empty">보유 종목이 없습니다.</p>
                  )}
                </article>
              </div>
            ) : null}

            {workspacePage === "ORDERS" ? (
              <article className="pt-page-card pt-page-card--wide">
                <h2>SQLite 모의 체결 내역</h2>
                {desktop.account?.fills.length ? (
                  <table>
                    <thead>
                      <tr>
                        <th>체결시각</th>
                        <th>종목</th>
                        <th>구분</th>
                        <th>가격</th>
                        <th>수량</th>
                        <th>상태</th>
                      </tr>
                    </thead>
                    <tbody>
                      {desktop.account.fills.map((fill) => (
                        <tr key={fill.fillId}>
                          <td>
                            {new Date(fill.filledAt).toLocaleString("ko-KR")}
                          </td>
                          <td>{fill.instrumentId}</td>
                          <td
                            className={
                              fill.side === "BUY"
                                ? "pt-text--buy"
                                : "pt-text--sell"
                            }
                          >
                            {fill.side === "BUY" ? "매수" : "매도"}
                          </td>
                          <td>
                            {formatInstrumentPrice(fill.price, fill.instrumentId)}
                          </td>
                          <td>{fill.quantity}주</td>
                          <td>
                            {fill.completion === "FULL" ? "전량" : "부분"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="pt-page-card__empty">
                    아직 로컬 모의 체결이 없습니다.
                  </p>
                )}
              </article>
            ) : null}

            {workspacePage === "CALENDAR" ? (
              <article className="pt-page-card pt-page-card--wide pt-calendar-page">
                <div className="pt-page-card__toolbar">
                  <div>
                    <h2>
                      {calendarMonth.replace("-", "년 ")}월 국내·미국 이벤트
                    </h2>
                    <p>
                      {desktop.marketCalendar?.statusMessage ??
                        "Electron runtime의 캘린더 projection을 기다리는 중입니다."}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void desktop.loadMarketCalendar(true)}
                  >
                    새로고침
                  </button>
                  <input
                    type="month"
                    value={calendarMonth}
                    aria-label="캘린더 월"
                    onChange={(event) =>
                      setCalendarSelectedDate(`${event.currentTarget.value}-01`)
                    }
                  />
                </div>
                <div className="pt-calendar-filters" aria-label="캘린더 필터">
                  {(Object.keys(CALENDAR_MARKET_LABELS) as CalendarMarketFilter[]).map(
                    (filter) => (
                      <button
                        type="button"
                        key={filter}
                        className={
                          calendarMarketFilter === filter ? "active" : undefined
                        }
                        onClick={() => setCalendarMarketFilter(filter)}
                      >
                        {CALENDAR_MARKET_LABELS[filter]}
                      </button>
                    ),
                  )}
                  {(Object.keys(CALENDAR_CATEGORY_LABELS) as CalendarCategoryFilter[]).map(
                    (filter) => (
                      <button
                        type="button"
                        key={filter}
                        className={
                          calendarCategoryFilter === filter
                            ? "active"
                            : undefined
                        }
                        onClick={() => setCalendarCategoryFilter(filter)}
                      >
                        {CALENDAR_CATEGORY_LABELS[filter]}
                      </button>
                    ),
                  )}
                  {(Object.keys(CALENDAR_QUALITY_LABELS) as CalendarQualityFilter[]).map(
                    (filter) => (
                      <button
                        type="button"
                        key={filter}
                        className={
                          calendarQualityFilter === filter ? "active" : undefined
                        }
                        onClick={() => setCalendarQualityFilter(filter)}
                      >
                        {CALENDAR_QUALITY_LABELS[filter]}
                      </button>
                    ),
                  )}
                </div>
                <div className="pt-calendar-layout">
                  <section className="pt-calendar-month" aria-label="월간 이벤트 캘린더">
                    {["일", "월", "화", "수", "목", "금", "토"].map((day) => (
                      <strong key={day} className="pt-calendar-weekday">
                        {day}
                      </strong>
                    ))}
                    {calendarMonthDays.map((day) => {
                      const dayEvents = filteredCalendarEvents.filter(
                        (event) => event.localDate === day.date,
                      );
                      return (
                        <button
                          type="button"
                          key={day.date}
                          className={
                            day.date === calendarSelectedDate
                              ? "pt-calendar-day pt-calendar-day--selected"
                              : calendarLoading && day.inMonth
                                ? "pt-calendar-day pt-calendar-day--loading"
                                : "pt-calendar-day"
                          }
                          data-muted={!day.inMonth}
                          onClick={() => setCalendarSelectedDate(day.date)}
                        >
                          <span>{Number(day.date.slice(8, 10))}</span>
                          <span className="pt-calendar-day__dots">
                            {calendarLoading && day.inMonth
                              ? [0, 1, 2].map((index) => (
                                  <i key={index} data-importance="loading" />
                                ))
                              : dayEvents.slice(0, 4).map((event) => (
                                  <i
                                    key={event.id}
                                    data-importance={event.importance.toLowerCase()}
                                    title={CALENDAR_KIND_LABELS[event.kind]}
                                  />
                                ))}
                          </span>
                          {dayEvents.length > 4 ? (
                            <em>+{dayEvents.length - 4}</em>
                          ) : null}
                        </button>
                      );
                    })}
                  </section>
                  <aside className="pt-calendar-agenda" aria-label="선택 날짜 이벤트">
                    <header>
                      <div>
                        <strong>{calendarSelectedDate}</strong>
                        <span>{selectedDateCalendarEvents.length}개 이벤트</span>
                      </div>
                      <span>
                        {desktop.marketCalendar?.source === "PROVIDER"
                          ? "provider projection"
                          : "fixture projection"}
                      </span>
                    </header>
                    {calendarLoading ? (
                      <ol aria-label="캘린더 로딩">
                        {[0, 1, 2, 3].map((index) => (
                          <li key={index} className="pt-calendar-agenda__skeleton">
                            <time />
                            <div>
                              <p>
                                <span />
                                <span />
                                <span />
                              </p>
                              <strong />
                              <small />
                            </div>
                          </li>
                        ))}
                      </ol>
                    ) : selectedDateCalendarEvents.length > 0 ? (
                      <ol>
                        {selectedDateCalendarEvents.map((event) => (
                          <li
                            key={event.id}
                            className={
                              selectedCalendarEvent?.id === event.id
                                ? "pt-calendar-agenda__item pt-calendar-agenda__item--selected"
                                : "pt-calendar-agenda__item"
                            }
                          >
                            <button
                              type="button"
                              onClick={() => setSelectedCalendarEventId(event.id)}
                            >
                              <time dateTime={event.scheduledAt}>
                                {formatCalendarEventTime(event)}
                              </time>
                              <div>
                                <p>
                                  <span>{calendarMarketLabel(event)}</span>
                                  <span>{CALENDAR_KIND_LABELS[event.kind]}</span>
                                  <span>{calendarDataQualityLabel(event.dataQuality)}</span>
                                </p>
                                <strong>{event.titleKo}</strong>
                                <small>
                                  {event.instrumentIds.length > 0
                                    ? event.instrumentIds.join(", ")
                                    : event.affectedMarkets
                                        .map((market) => CALENDAR_MARKET_LABELS[market])
                                        .join(" · ")}
                                </small>
                                {event.metrics.length > 0 ? (
                                  <footer>
                                    {event.metrics.slice(0, 3).map((metric) => (
                                      <span
                                        key={`${event.id}:${metric.name}:${metric.value}`}
                                      >
                                        {formatCalendarMetric(metric)}
                                      </span>
                                    ))}
                                  </footer>
                                ) : null}
                              </div>
                            </button>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="pt-page-card__empty">
                        선택한 날짜와 필터에 맞는 이벤트가 없습니다.
                      </p>
                    )}
                  </aside>
                </div>
                <section className="pt-calendar-sources" aria-label="캘린더 provider 상태">
                  <header>
                    <strong>데이터 provider 상태</strong>
                    <span>{desktop.marketCalendar?.sources.length ?? 0}개 source</span>
                  </header>
                  {calendarLoading ? (
                    <div className="pt-calendar-sources__skeleton">
                      {[0, 1, 2, 3].map((index) => (
                        <span key={index} />
                      ))}
                    </div>
                  ) : desktop.marketCalendar?.sources.length ? (
                    <ul>
                      {desktop.marketCalendar.sources.map((source) => (
                        <li key={source.provider}>
                          <strong>{CALENDAR_PROVIDER_LABELS[source.provider]}</strong>
                          <span data-state={source.state.toLowerCase()}>
                            {calendarSourceStateLabel(source.state)}
                          </span>
                          <small>
                            {source.itemCount}개 수신 · {source.insertedCount}개 신규
                          </small>
                          <em>{source.message}</em>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>provider 상태가 아직 없습니다.</p>
                  )}
                </section>
                <section className="pt-calendar-detail" aria-label="선택 이벤트 상세">
                  <header>
                    <strong>이벤트 상세</strong>
                    <span>
                      {selectedCalendarEvent
                        ? CALENDAR_PROVIDER_LABELS[selectedCalendarEvent.provider]
                        : "선택 없음"}
                    </span>
                  </header>
                  {calendarLoading ? (
                    <div className="pt-calendar-detail__skeleton">
                      <strong />
                      <span />
                      <span />
                      <span />
                    </div>
                  ) : selectedCalendarEvent ? (
                    <div className="pt-calendar-detail__body">
                      <h3>{selectedCalendarEvent.titleKo}</h3>
                      <dl>
                        <div>
                          <dt>일시</dt>
                          <dd>
                            {selectedCalendarEvent.localDate}{" "}
                            {formatCalendarEventTime(selectedCalendarEvent)}{" "}
                            {selectedCalendarEvent.timezone}
                          </dd>
                        </div>
                        <div>
                          <dt>범위</dt>
                          <dd>
                            {selectedCalendarEvent.affectedMarkets
                              .map((market) => CALENDAR_MARKET_LABELS[market])
                              .join(" · ")}
                          </dd>
                        </div>
                        <div>
                          <dt>종목</dt>
                          <dd>
                            {selectedCalendarEvent.instrumentIds.length > 0
                              ? selectedCalendarEvent.instrumentIds.join(", ")
                              : "시장 전체"}
                          </dd>
                        </div>
                        <div>
                          <dt>상태</dt>
                          <dd>
                            {selectedCalendarEvent.status} ·{" "}
                            {calendarDataQualityLabel(selectedCalendarEvent.dataQuality)}
                          </dd>
                        </div>
                        <div>
                          <dt>근거</dt>
                          <dd>{selectedCalendarEvent.evidenceIds.join(", ")}</dd>
                        </div>
                        <div>
                          <dt>원문</dt>
                          <dd>{selectedCalendarEvent.sourceUrl ?? "원문 URL 미제공"}</dd>
                        </div>
                      </dl>
                      {selectedCalendarEvent.metrics.length > 0 ? (
                        <footer>
                          {selectedCalendarEvent.metrics.map((metric) => (
                            <span
                              key={`${selectedCalendarEvent.id}:${metric.name}:${metric.value}`}
                            >
                              {formatCalendarMetric(metric)}
                            </span>
                          ))}
                        </footer>
                      ) : null}
                    </div>
                  ) : (
                    <p>선택한 필터에 맞는 이벤트가 없습니다.</p>
                  )}
                </section>
                <section className="pt-calendar-workspace-scope">
                  <header>
                    <strong>전체 예정 이벤트</strong>
                    <span>선택 종목과 무관하게 모든 기업·시장 일정 표시</span>
                  </header>
                  {calendarLoading ? (
                    <ol aria-label="종목 캘린더 로딩">
                      {[0, 1, 2].map((index) => (
                        <li
                          key={index}
                          className="pt-calendar-workspace-scope__skeleton"
                        >
                          <time />
                          <strong />
                          <span />
                        </li>
                      ))}
                    </ol>
                  ) : upcomingCalendarEvents.length > 0 ? (
                    <ol>
                      {upcomingCalendarEvents.map((event) => (
                        <li
                          key={event.id}
                          className={
                            selectedCalendarEvent?.id === event.id
                              ? "pt-calendar-workspace-scope__item pt-calendar-workspace-scope__item--selected"
                              : "pt-calendar-workspace-scope__item"
                          }
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setCalendarSelectedDate(event.localDate);
                              setSelectedCalendarEventId(event.id);
                            }}
                          >
                            <time>{event.localDate}</time>
                            <strong>{event.titleKo}</strong>
                            <span>
                              {CALENDAR_KIND_LABELS[event.kind]} ·{" "}
                              {calendarDataQualityLabel(event.dataQuality)}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p>선택한 필터에 맞는 예정 이벤트가 없습니다.</p>
                  )}
                </section>
              </article>
            ) : null}

            {workspacePage === "NEWS" ? (
              <article className="pt-page-card pt-page-card--wide">
                <div className="pt-page-card__toolbar">
                  <div>
                    <h2>
                      {isUsSelection
                        ? `미국 · ${activeInstrumentName} 뉴스 · SEC 공시 · 전체 시장 관찰`
                        : "국내 · KIS 뉴스 · OpenDART 공시"}
                    </h2>
                    <p>
                      {marketScopedInformationFeed?.statusMessage ??
                        "KIS·SEC 읽기 전용 데이터를 불러오는 중입니다."}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      void desktop.loadInformationFeed(true)
                    }
                  >
                    새로고침
                  </button>
                </div>
                <div className="pt-information-scope" aria-label="공시·뉴스 종목 필터">
                  {([
                    ["ALL", "전체"],
                    ["SELECTED", "선택 종목"],
                    ["WATCHLIST", "관심 종목"],
                  ] as const).map(([scope, label]) => (
                    <button
                      type="button"
                      key={scope}
                      className={informationScope === scope ? "active" : undefined}
                      onClick={() => setInformationScope(scope)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="pt-information-sources">
                  {(marketScopedInformationFeed?.sources ?? []).map((source) => (
                    <button
                      type="button"
                      key={source.provider}
                      data-state={source.state.toLowerCase()}
                      className={
                        informationProvider === source.provider
                          ? "active"
                          : undefined
                      }
                      title={source.message}
                      aria-pressed={informationProvider === source.provider}
                      onClick={() =>
                        setInformationProvider((current) =>
                          current === source.provider ? null : source.provider,
                        )
                      }
                    >
                      {informationProviderLabel(source.provider)}
                      <strong>{source.itemCount}</strong>
                    </button>
                  ))}
                </div>
                {marketScopedInformationFeed &&
                visibleInformationItems.length > 0 ? (
                  <ol className="pt-information-feed">
                    {visibleInformationItems.map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          className="pt-information-feed__detail-trigger"
                          onClick={() => setSelectedInformationItem(item)}
                        >
                        <div className="pt-information-feed__meta">
                          <span>{informationProviderLabel(item.provider)}</span>
                          <span>
                            {item.kind === "DISCLOSURE" ? "공시" : "뉴스"}
                          </span>
                          <time dateTime={item.publishedAt}>
                            {formatInformationTime(
                              item.publishedAt,
                              item.publishedAtPrecision,
                            )}
                          </time>
                        </div>
                        <strong>
                          {item.sourceLanguage === "ko"
                            ? item.titleKorean ?? item.titleOriginal
                            : item.titleOriginal}
                        </strong>
                        {item.sourceLanguage !== "ko" &&
                        item.titleKorean !== null ? (
                          <small>부분 번역 참고: {item.titleKorean}</small>
                        ) : null}
                        {item.rights !== "KIS_HEADLINE_ONLY" &&
                        item.summaryKorean ? (
                          <p>{item.summaryKorean}</p>
                        ) : null}
                        </button>
                        <footer>
                          <span>{item.sourceName}</span>
                          <span>
                            {item.rights === "KIS_HEADLINE_ONLY"
                              ? "제목만 제공"
                              : item.rights === "PUBLIC_FILING"
                                ? "공식 공개 공시"
                                : "제공사 요약·원문 링크"}
                          </span>
                          {item.sourceLanguage !== "ko" &&
                          item.titleKorean === null ? (
                            <span>한국어 번역 대기</span>
                          ) : null}
                          {item.canonicalUrl !== null ? (
                            <button
                              type="button"
                              onClick={() =>
                                void window.paperTradingDesktop.information.openExternal(
                                  item.canonicalUrl!,
                                )
                              }
                            >
                              {item.provider === "OPEN_DART"
                                ? "DART 원문 보기"
                                : item.provider === "SEC_EDGAR"
                                  ? "SEC 원문 보기"
                                  : "기사 원문 보기"}
                            </button>
                          ) : null}
                        </footer>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <div className="pt-empty-state">
                    <Newspaper />
                    <strong>실제 뉴스·공시를 기다리는 중입니다</strong>
                    <span>
                      {isUsSelection
                        ? "선택 티커의 KIS 미국뉴스와 SEC EDGAR 공식 공시, 미국 전체 헤드라인을 조회하고 있습니다. 합성 뉴스는 표시하지 않습니다."
                        : "합성 뉴스는 표시하지 않습니다. OpenDART 공시는 같은 로컬 피드에 추가됩니다."}
                    </span>
                  </div>
                )}
              </article>
            ) : null}

            {workspacePage === "NOTES" ? (
              <article className="pt-page-card pt-page-card--wide pt-note-editor">
                <h2>개인 분석 노트</h2>
                <textarea
                  value={analysisNote}
                  placeholder="종목·테마·시황에 대한 개인 메모를 입력하세요."
                  onChange={(event) => setAnalysisNote(event.target.value)}
                />
                <button
                  type="button"
                  onClick={() => {
                    localStorage.setItem(
                      "papertrading:analysis-note",
                      analysisNote,
                    );
                    setNotice("분석 노트를 이 PC에 저장했습니다.");
                  }}
                >
                  이 PC에 저장
                </button>
              </article>
            ) : null}

            {workspacePage === "SECURITY" ? (
              <div className="pt-page-grid">
                <article className="pt-page-card">
                  <h2>주문 안전장치</h2>
                  <p>실제 증권 주문 API: 영구 금지</p>
                  <p>모의주문 저장: 로컬 SQLite</p>
                </article>
                <article className="pt-page-card">
                  <h2>시장 데이터</h2>
                  <p>
                    KIS WebSocket: {isKisLive ? "읽기 전용 연결" : "미연결"}
                  </p>
                  <p>실시간 거래소: 현재 {desktop.market?.venue ?? (isUsSelection ? "미국 시장" : "KRX")}</p>
                </article>
              </div>
            ) : null}

            {workspacePage === "SETTINGS" ? (
              <div className="pt-page-grid">
                <article className="pt-page-card">
                  <h2>화면 테마</h2>
                  <select
                    value={themePreference}
                    onChange={(event) =>
                      setThemePreference(event.target.value as ThemePreference)
                    }
                  >
                    <option value="system">시스템</option>
                    <option value="dark">다크</option>
                    <option value="light">라이트</option>
                  </select>
                </article>
                <article className="pt-page-card">
                  <h2>데이터 연결</h2>
                  <p>{desktop.market?.statusMessage ?? "KIS 연결 대기"}</p>
                  <p>{desktop.account?.statusMessage ?? "SQLite 연결 대기"}</p>
                </article>
              </div>
            ) : null}
          </section>
        ) : null}
      </main>

      <footer className="connection-strip">
        <span>
          <span
            className={isKisLive ? "live-dot" : "offline-dot"}
            aria-hidden="true"
          />{" "}
          KIS WebSocket{" "}
          {isKisLive
            ? "읽기 전용 연결"
            : hasRestSnapshot
              ? "REST snapshot 사용"
              : "미연결"}
        </span>
        <span>
          {desktop.market?.mode === "KIS_READ_ONLY"
            ? "REST snapshot 사용"
            : "REST 호출 없음"}
        </span>
        <span>차트 · {chartStatusLabel}</span>
        <span>
          호가{" "}
          {isKisLive
            ? `generation #${desktop.market?.sequence ?? "0"}`
            : hasDesktopRuntime
              ? "실시간 snapshot 대기"
              : "fixture snapshot"}
        </span>
        <span>
          {desktop.account?.statusMessage ?? "SQLite projection 준비 중"}
        </span>
        <span>
          체결 모델 ·{" "}
          {desktop.account?.simulationProfile === "ADVANCED_QUEUE_V1"
            ? `ADVANCED QUEUE · 추정 · ×${desktop.account.queueSafetyFactor ?? "?"}`
            : "INITIAL CONSERVATIVE"}
        </span>
        <span className="connection-strip__notice">{notice}</span>
        <span>
          <CircleDollarSign size={13} /> 실제 주문 기능 없음
        </span>
      </footer>
      {selectedInformationItem ? (
        <div
          className="pt-information-modal__backdrop"
          role="presentation"
          onMouseDown={() => setSelectedInformationItem(null)}
        >
          <section
            className="pt-information-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="information-detail-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <span>{informationProviderLabel(selectedInformationItem.provider)}</span>
                <span>{selectedInformationItem.kind === "DISCLOSURE" ? "공시" : "뉴스"}</span>
              </div>
              <button type="button" aria-label="상세 창 닫기" onClick={() => setSelectedInformationItem(null)}>×</button>
            </header>
            <h2 id="information-detail-title">
              {selectedInformationItem.sourceLanguage === "ko"
                ? selectedInformationItem.titleKorean ?? selectedInformationItem.titleOriginal
                : selectedInformationItem.titleOriginal}
            </h2>
            <div className="pt-information-modal__meta">
              <span>{selectedInformationItem.sourceName}</span>
              <time dateTime={selectedInformationItem.publishedAt}>
                {formatInformationTime(selectedInformationItem.publishedAt, selectedInformationItem.publishedAtPrecision)}
              </time>
            </div>
            {selectedInformationItem.summaryKorean ? (
              <p className="pt-information-modal__summary">{selectedInformationItem.summaryKorean}</p>
            ) : (
              <p className="pt-information-modal__notice">
                {selectedInformationItem.rights === "KIS_HEADLINE_ONLY"
                  ? "제공 정책상 제목만 표시할 수 있습니다."
                  : "이 항목에는 별도 요약문이 없습니다. 공식 원문에서 상세 내용을 확인할 수 있습니다."}
              </p>
            )}
            <footer>
              <span>
                {selectedInformationItem.rights === "PUBLIC_FILING"
                  ? "공식 공개 공시"
                  : selectedInformationItem.rights === "PROVIDER_LINK_SUMMARY"
                    ? "제공사 요약"
                    : "제목 제공"}
              </span>
              {selectedInformationItem.canonicalUrl ? (
                <button type="button" onClick={() => void window.paperTradingDesktop.information.openExternal(selectedInformationItem.canonicalUrl!)}>
                  공식 원문 열기
                </button>
              ) : null}
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  );
}
