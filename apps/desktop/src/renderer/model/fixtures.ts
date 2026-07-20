import type {
  HeaderMetric,
  InstrumentRowModel,
  MarketContextModel,
  NewsItemModel,
  OrderBookLevelModel,
  OrderTicketDraft,
  PortfolioValueModel,
  ThemeLeaderModel,
} from "../components";

export interface ChartCandleFixture {
  openedAt: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  turnover: string;
}

export interface ChartMovingAverageFixture {
  id: string;
  label: string;
  basis: "CLOSE" | "VOLUME" | "TURNOVER";
  kind: "SMA" | "EMA";
  period: number;
  values: readonly (string | null)[];
}

export interface PaperFillMarkerFixture {
  id: string;
  side: "BUY" | "SELL";
  state: "PARTIAL_FILL" | "FULL_FILL";
  filledAt: string;
  price: string;
  quantity: string;
  label: string;
}

export interface MacroIndicatorFixture {
  id: string;
  label: string;
  value: string;
  change: string;
  direction: "positive" | "negative" | "flat";
  quality: "live" | "delayed" | "stale";
  sourceLabel: string;
}

export const fixtureMeta = {
  kind: "SYNTHETIC_UI_FIXTURE",
  notice: "화면 개발용 합성 데이터이며 실제 투자 판단에 사용할 수 없습니다.",
  fixedAt: "2026-07-20T01:12:00.000Z",
} as const;

export const marketSidebarFixture = {
  markets: ["KOSPI", "KOSDAQ", "미국", "선물·Proxy"] as const,
  selectedMarket: "KOSPI",
  instruments: [
    {
      instrumentId: "KRX:005930",
      symbol: "005930",
      name: "삼성전자",
      market: "KOSPI",
      price: "72,400",
      changeRate: "+2.55",
      direction: "positive",
      turnover: "1.82조",
      selected: true,
      freshness: "live",
    },
    {
      instrumentId: "KRX:000660",
      symbol: "000660",
      name: "SK하이닉스",
      market: "KOSPI",
      price: "218,500",
      changeRate: "+4.05",
      direction: "positive",
      turnover: "1.31조",
      freshness: "live",
    },
    {
      instrumentId: "KRX:005380",
      symbol: "005380",
      name: "현대차",
      market: "KOSPI",
      price: "236,000",
      changeRate: "-0.84",
      direction: "negative",
      turnover: "3,940억",
      freshness: "live",
    },
    {
      instrumentId: "KRX:247540",
      symbol: "247540",
      name: "에코프로비엠",
      market: "KOSDAQ",
      price: "184,300",
      changeRate: "+1.21",
      direction: "positive",
      turnover: "2,280억",
      freshness: "delayed",
    },
  ] satisfies readonly InstrumentRowModel[],
};

export const instrumentHeaderFixture = {
  name: "삼성전자",
  symbol: "005930",
  market: "KOSPI",
  currency: "KRW",
  price: "72,400",
  change: "+1,800",
  changeRate: "+2.55",
  direction: "positive",
  sessionLabel: "정규장",
  asOfLabel: "10:12:00 KST",
  status: "live",
  watched: true,
  metrics: [
    { label: "시가", value: "71,000", direction: "positive" },
    { label: "고가", value: "72,800", direction: "positive" },
    { label: "저가", value: "70,700", direction: "positive" },
    { label: "거래량", value: "14,284,912주", subValue: "전일 동시간 +38%" },
    { label: "거래대금", value: "1.02조", subValue: "시장 점유 4.8%" },
  ] satisfies readonly HeaderMetric[],
} as const;

export const orderBookFixture = {
  instrumentId: "KRX:005930",
  asks: [
    {
      price: "72,900",
      quantity: "318,421",
      changeRate: "+3.26",
      direction: "positive",
      depthBand: 8,
    },
    {
      price: "72,800",
      quantity: "241,907",
      changeRate: "+3.12",
      direction: "positive",
      depthBand: 6,
    },
    {
      price: "72,700",
      quantity: "190,842",
      changeRate: "+2.97",
      direction: "positive",
      depthBand: 5,
    },
    {
      price: "72,600",
      quantity: "402,115",
      changeRate: "+2.83",
      direction: "positive",
      depthBand: 10,
    },
    {
      price: "72,500",
      quantity: "155,908",
      changeRate: "+2.69",
      direction: "positive",
      depthBand: 4,
    },
    {
      price: "72,400",
      quantity: "121,336",
      changeRate: "+2.55",
      direction: "positive",
      depthBand: 3,
    },
    {
      price: "72,300",
      quantity: "98,114",
      changeRate: "+2.41",
      direction: "positive",
      depthBand: 3,
    },
    {
      price: "72,200",
      quantity: "73,591",
      changeRate: "+2.27",
      direction: "positive",
      depthBand: 2,
    },
    {
      price: "72,100",
      quantity: "64,813",
      changeRate: "+2.12",
      direction: "positive",
      depthBand: 2,
    },
    {
      price: "72,000",
      quantity: "45,320",
      changeRate: "+1.98",
      direction: "positive",
      depthBand: 1,
    },
  ] satisfies readonly OrderBookLevelModel[],
  bids: [
    {
      price: "71,900",
      quantity: "172,431",
      changeRate: "+1.84",
      direction: "positive",
      depthBand: 5,
    },
    {
      price: "71,800",
      quantity: "224,901",
      changeRate: "+1.70",
      direction: "positive",
      depthBand: 6,
    },
    {
      price: "71,700",
      quantity: "368,550",
      changeRate: "+1.56",
      direction: "positive",
      depthBand: 10,
    },
    {
      price: "71,600",
      quantity: "289,017",
      changeRate: "+1.42",
      direction: "positive",
      depthBand: 8,
    },
    {
      price: "71,500",
      quantity: "192,881",
      changeRate: "+1.27",
      direction: "positive",
      depthBand: 5,
    },
    {
      price: "71,400",
      quantity: "147,205",
      changeRate: "+1.13",
      direction: "positive",
      depthBand: 4,
    },
    {
      price: "71,300",
      quantity: "119,540",
      changeRate: "+0.99",
      direction: "positive",
      depthBand: 3,
    },
    {
      price: "71,200",
      quantity: "83,913",
      changeRate: "+0.85",
      direction: "positive",
      depthBand: 2,
    },
    {
      price: "71,100",
      quantity: "71,218",
      changeRate: "+0.71",
      direction: "positive",
      depthBand: 2,
    },
    {
      price: "71,000",
      quantity: "52,007",
      changeRate: "+0.57",
      direction: "positive",
      depthBand: 1,
    },
  ] satisfies readonly OrderBookLevelModel[],
  totalAskQuantity: "1,712,367",
  totalBidQuantity: "1,721,663",
  currentPrice: "72,400",
  currentDirection: "positive",
  freshness: "live",
  depthLabel: "국내 10호가",
  asOfLabel: "10:12:00.084 KST",
} as const;

export const chartFixture = {
  instrumentId: "KRX:005930",
  interval: "5분",
  currency: "KRW",
  asOf: "2026-07-20T01:12:00.000Z",
  candles: [
    {
      openedAt: "2026-07-20T00:00:00.000Z",
      open: "71000",
      high: "71200",
      low: "70700",
      close: "70900",
      volume: "821302",
      turnover: "58261320000",
    },
    {
      openedAt: "2026-07-20T00:05:00.000Z",
      open: "70900",
      high: "71300",
      low: "70800",
      close: "71200",
      volume: "645817",
      turnover: "45939430000",
    },
    {
      openedAt: "2026-07-20T00:10:00.000Z",
      open: "71200",
      high: "71600",
      low: "71100",
      close: "71500",
      volume: "720104",
      turnover: "51478340000",
    },
    {
      openedAt: "2026-07-20T00:15:00.000Z",
      open: "71500",
      high: "71700",
      low: "71300",
      close: "71400",
      volume: "538411",
      turnover: "38471350000",
    },
    {
      openedAt: "2026-07-20T00:20:00.000Z",
      open: "71400",
      high: "71800",
      low: "71300",
      close: "71700",
      volume: "610903",
      turnover: "43721560000",
    },
    {
      openedAt: "2026-07-20T00:25:00.000Z",
      open: "71700",
      high: "72000",
      low: "71600",
      close: "71900",
      volume: "579024",
      turnover: "41605730000",
    },
    {
      openedAt: "2026-07-20T00:30:00.000Z",
      open: "71900",
      high: "72100",
      low: "71700",
      close: "71800",
      volume: "455781",
      turnover: "32766890000",
    },
    {
      openedAt: "2026-07-20T00:35:00.000Z",
      open: "71800",
      high: "72200",
      low: "71800",
      close: "72100",
      volume: "491203",
      turnover: "35395520000",
    },
    {
      openedAt: "2026-07-20T00:40:00.000Z",
      open: "72100",
      high: "72300",
      low: "71900",
      close: "72000",
      volume: "447802",
      turnover: "32241360000",
    },
    {
      openedAt: "2026-07-20T00:45:00.000Z",
      open: "72000",
      high: "72400",
      low: "72000",
      close: "72300",
      volume: "512506",
      turnover: "37039840000",
    },
    {
      openedAt: "2026-07-20T00:50:00.000Z",
      open: "72300",
      high: "72500",
      low: "72100",
      close: "72200",
      volume: "398722",
      turnover: "28820750000",
    },
    {
      openedAt: "2026-07-20T00:55:00.000Z",
      open: "72200",
      high: "72600",
      low: "72200",
      close: "72500",
      volume: "479306",
      turnover: "34720890000",
    },
    {
      openedAt: "2026-07-20T01:00:00.000Z",
      open: "72500",
      high: "72800",
      low: "72300",
      close: "72700",
      volume: "551208",
      turnover: "40010030000",
    },
    {
      openedAt: "2026-07-20T01:05:00.000Z",
      open: "72700",
      high: "72700",
      low: "72200",
      close: "72300",
      volume: "433902",
      turnover: "31390720000",
    },
    {
      openedAt: "2026-07-20T01:10:00.000Z",
      open: "72300",
      high: "72500",
      low: "72200",
      close: "72400",
      volume: "201887",
      turnover: "14613340000",
    },
  ] satisfies readonly ChartCandleFixture[],
  movingAverages: [
    {
      id: "close-sma-5",
      label: "가격 SMA 5",
      basis: "CLOSE",
      kind: "SMA",
      period: 5,
      values: [
        null,
        null,
        null,
        null,
        "71340",
        "71540",
        "71660",
        "71780",
        "71900",
        "72020",
        "72080",
        "72200",
        "72340",
        "72400",
        "72420",
      ],
    },
    {
      id: "close-ema-10",
      label: "가격 EMA 10",
      basis: "CLOSE",
      kind: "EMA",
      period: 10,
      values: [
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        "71770",
        "71848",
        "71967",
        "72100",
        "72136",
        "72184",
      ],
    },
  ] satisfies readonly ChartMovingAverageFixture[],
  paperFillMarkers: [
    {
      id: "fixture-fill-buy-1",
      side: "BUY",
      state: "PARTIAL_FILL",
      filledAt: "2026-07-20T00:27:00.000Z",
      price: "71800",
      quantity: "6",
      label: "모의 매수 부분체결 6주",
    },
    {
      id: "fixture-fill-buy-2",
      side: "BUY",
      state: "FULL_FILL",
      filledAt: "2026-07-20T00:32:00.000Z",
      price: "71900",
      quantity: "4",
      label: "모의 매수 잔여체결 4주",
    },
    {
      id: "fixture-fill-sell-1",
      side: "SELL",
      state: "FULL_FILL",
      filledAt: "2026-07-20T01:02:00.000Z",
      price: "72700",
      quantity: "5",
      label: "모의 매도 전량체결 5주",
    },
  ] satisfies readonly PaperFillMarkerFixture[],
} as const;

export const initialOrderDraftFixture = {
  side: "BUY",
  orderType: "LIMIT",
  quantity: "10",
  limitPrice: "71900",
} satisfies OrderTicketDraft;

export const portfolioFixture = {
  accountName: "개인 모의계좌",
  valuationQuality: "complete",
  values: [
    { label: "총자산", value: "103,482,500원", subValue: "기준 KRW" },
    { label: "주문 가능", value: "72,006,300원" },
    { label: "평가손익", value: "+3,482,500원", direction: "positive" },
    { label: "수익률", value: "+3.48%", direction: "positive" },
  ] satisfies readonly PortfolioValueModel[],
} as const;

export const themeLeadersFixture = [
  {
    rank: 1,
    themeId: "semiconductor.materials-equipment",
    name: "반도체 소부장",
    state: "LEADING",
    turnover: "4.21조",
    acceleration: "2.34배",
    marketShare: "19.8%",
    breadth: "24/31",
    leaderName: "SK하이닉스",
    leaderChangeRate: "+4.05",
    direction: "positive",
    evidenceLabel: "KRX 산업분류·DART 사업보고서 mapping fixture",
  },
  {
    rank: 2,
    themeId: "power.grid",
    name: "전력기기 · 전력망",
    state: "EMERGING",
    turnover: "2.07조",
    acceleration: "1.88배",
    marketShare: "9.7%",
    breadth: "11/16",
    leaderName: "HD현대일렉트릭",
    leaderChangeRate: "+5.62",
    direction: "positive",
    evidenceLabel: "DART 사업보고서·기업 IR mapping fixture",
  },
  {
    rank: 3,
    themeId: "automotive.mobility",
    name: "자동차 · 모빌리티",
    state: "ROTATING",
    turnover: "1.46조",
    acceleration: "1.19배",
    marketShare: "6.9%",
    breadth: "7/18",
    leaderName: "현대모비스",
    leaderChangeRate: "+1.08",
    direction: "positive",
    evidenceLabel: "KRX 산업분류 fixture",
  },
] satisfies readonly ThemeLeaderModel[];

export const newsFixture = [
  {
    id: "fixture-news-1",
    titleKo: "메모리 공급 전망과 AI 서버 투자 계획에 반도체 업종 강세",
    source: "KIS 뉴스 제목 fixture",
    publishedAtLabel: "09:42 KST",
    category: "산업",
    impact: "positive",
    summaryKo:
      "동시간 반도체 업종 거래대금 확대가 함께 관측됐습니다. 뉴스가 상승의 단독 원인이라는 의미는 아닙니다.",
    evidenceCount: 3,
  },
  {
    id: "fixture-news-2",
    titleKo: "삼성전자, 분기 사업 현황 자료 게시",
    source: "기업 IR fixture",
    publishedAtLabel: "09:08 KST",
    category: "기업",
    impact: "neutral",
    summaryKo:
      "기업 공식 자료의 게시 시각과 장중 가격·거래량 반응 창을 연결한 UI 예시입니다.",
    evidenceCount: 2,
  },
  {
    id: "fixture-news-3",
    titleKo: "미국 기술주 선물 약세와 원화 변동성 확대 관찰",
    source: "공식 시장자료 fixture",
    publishedAtLabel: "08:51 KST",
    category: "거시",
    impact: "mixed",
    summaryKo:
      "나스닥 Proxy와 환율 반응이 엇갈려 국내 반도체 영향은 혼합 신호로 분류했습니다.",
    evidenceCount: 4,
  },
] satisfies readonly NewsItemModel[];

export const marketContextsFixture = [
  {
    id: "fixture-context-rates",
    title: "미국 금리 경로 재평가",
    status: "WATCH",
    observedReaction: "미 기술주 Proxy -0.8% · USD/KRW +0.3%",
    confidenceLabel: "연결 신뢰도 중간 · point-in-time fixture",
  },
  {
    id: "fixture-context-energy",
    title: "해상 운송·에너지 공급 위험",
    status: "COOLING",
    observedReaction: "원유 Proxy +0.4% · 운송 업종 -0.2%",
    confidenceLabel: "공식 경보 미확인 · 관찰 단계 fixture",
  },
] satisfies readonly MarketContextModel[];

export const macroIndicatorsFixture = [
  {
    id: "kospi",
    label: "KOSPI",
    value: "2,864.71",
    change: "+0.72%",
    direction: "positive",
    quality: "live",
    sourceLabel: "KIS canonical fixture",
  },
  {
    id: "kosdaq",
    label: "KOSDAQ",
    value: "818.42",
    change: "+0.31%",
    direction: "positive",
    quality: "live",
    sourceLabel: "KIS canonical fixture",
  },
  {
    id: "usdkrw",
    label: "USD/KRW",
    value: "1,386.20",
    change: "+0.28%",
    direction: "positive",
    quality: "delayed",
    sourceLabel: "market context fixture",
  },
  {
    id: "nasdaq-proxy",
    label: "NASDAQ Proxy",
    value: "QQQ 518.24",
    change: "-0.81%",
    direction: "negative",
    quality: "live",
    sourceLabel: "PROXY_LIVE fixture",
  },
  {
    id: "oil-proxy",
    label: "WTI Proxy",
    value: "USO 78.16",
    change: "+0.43%",
    direction: "positive",
    quality: "live",
    sourceLabel: "PROXY_LIVE fixture",
  },
] satisfies readonly MacroIndicatorFixture[];

export const samsungWorkspaceFixture = {
  meta: fixtureMeta,
  sidebar: marketSidebarFixture,
  header: instrumentHeaderFixture,
  orderBook: orderBookFixture,
  chart: chartFixture,
  initialOrderDraft: initialOrderDraftFixture,
  portfolio: portfolioFixture,
  themeLeaders: themeLeadersFixture,
  news: newsFixture,
  marketContexts: marketContextsFixture,
  macroIndicators: macroIndicatorsFixture,
} as const;
