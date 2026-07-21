import type { RuntimeConfig } from "../config/runtime-config.js";

export const KIS_ENDPOINTS = {
  paper: {
    restBaseUrl: "https://openapivts.koreainvestment.com:29443",
    websocketUrl: "ws://ops.koreainvestment.com:31000/tryitout",
  },
  prod: {
    restBaseUrl: "https://openapi.koreainvestment.com:9443",
    websocketUrl: "ws://ops.koreainvestment.com:21000/tryitout",
  },
} as const;

export function getKisEndpoints(environment: RuntimeConfig["KIS_DATA_ENV"]) {
  return KIS_ENDPOINTS[environment];
}

export const KIS_TR = {
  domesticCurrentPrice: "FHKST01010100",
  domesticOrderBookSnapshot: "FHKST01010200",
  domesticIntradayCandles: "FHKST03010200",
  domesticDailyCandles: "FHKST03010100",
  domesticVolumeRank: "FHPST01710000",
  domesticFluctuationRank: "FHPST01700000",
  domesticNewsHeadlines: "FHKST01011800",
  overseasNewsHeadlines: "HHPSTH60100C1",
  domesticIndexPrice: "FHPUP02100000",
  overseasCurrentPrice: "HHDFS00000300",
  domesticInvestorByStock: "FHKST01010900",
  domesticInvestorByMarketTime: "FHPTJ04030000",
  domesticInvestorByMarketDaily: "FHPTJ04040000",
  domesticProgramByStock: "FHPPG04650101",
  domesticProgramByStockDaily: "FHPPG04650201",
  domesticOrderBook: "H0STASP0",
  domesticTrade: "H0STCNT0",
  domesticNxtOrderBook: "H0NXASP0",
  domesticNxtTrade: "H0NXCNT0",
  domesticNxtMarketStatus: "H0NXMKO0",
  domesticUnifiedOrderBook: "H0UNASP0",
  domesticUnifiedTrade: "H0UNCNT0",
  usOrderBook: "HDFSASP0",
  usTrade: "HDFSCNT0",
} as const;

export const KIS_PATH = {
  accessToken: "/oauth2/tokenP",
  approvalKey: "/oauth2/Approval",
  domesticCurrentPrice: "/uapi/domestic-stock/v1/quotations/inquire-price",
  domesticOrderBookSnapshot:
    "/uapi/domestic-stock/v1/quotations/inquire-asking-price-exp-ccn",
  domesticIntradayCandles:
    "/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice",
  domesticDailyCandles:
    "/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice",
  domesticVolumeRank: "/uapi/domestic-stock/v1/quotations/volume-rank",
  domesticFluctuationRank:
    "/uapi/domestic-stock/v1/ranking/fluctuation",
  domesticNewsHeadlines:
    "/uapi/domestic-stock/v1/quotations/news-title",
  overseasNewsHeadlines:
    "/uapi/overseas-price/v1/quotations/news-title",
  domesticIndexPrice:
    "/uapi/domestic-stock/v1/quotations/inquire-index-price",
  overseasCurrentPrice:
    "/uapi/overseas-price/v1/quotations/price",
  domesticInvestorByStock:
    "/uapi/domestic-stock/v1/quotations/inquire-investor",
  domesticInvestorByMarketTime:
    "/uapi/domestic-stock/v1/quotations/inquire-investor-time-by-market",
  domesticInvestorByMarketDaily:
    "/uapi/domestic-stock/v1/quotations/inquire-investor-daily-by-market",
  domesticProgramByStock:
    "/uapi/domestic-stock/v1/quotations/program-trade-by-stock",
  domesticProgramByStockDaily:
    "/uapi/domestic-stock/v1/quotations/program-trade-by-stock-daily",
} as const;

export const KIS_READ_ONLY_ALLOWLIST = {
  paths: [
    "/oauth2/tokenP",
    "/oauth2/Approval",
    "/uapi/domestic-stock/v1/quotations/inquire-price",
    "/uapi/domestic-stock/v1/quotations/inquire-asking-price-exp-ccn",
    "/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice",
    "/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice",
    "/uapi/domestic-stock/v1/quotations/volume-rank",
    "/uapi/domestic-stock/v1/ranking/fluctuation",
    "/uapi/domestic-stock/v1/quotations/news-title",
    "/uapi/overseas-price/v1/quotations/news-title",
    "/uapi/domestic-stock/v1/quotations/inquire-index-price",
    "/uapi/overseas-price/v1/quotations/price",
    "/uapi/domestic-stock/v1/quotations/inquire-investor",
    "/uapi/domestic-stock/v1/quotations/inquire-investor-time-by-market",
    "/uapi/domestic-stock/v1/quotations/inquire-investor-daily-by-market",
    "/uapi/domestic-stock/v1/quotations/program-trade-by-stock",
    "/uapi/domestic-stock/v1/quotations/program-trade-by-stock-daily",
  ],
  trIds: [
    "FHKST01010100",
    "FHKST01010200",
    "FHKST03010200",
    "FHKST03010100",
    "FHPST01710000",
    "FHPST01700000",
    "FHKST01011800",
    "HHPSTH60100C1",
    "FHPUP02100000",
    "HHDFS00000300",
    "FHKST01010900",
    "FHPTJ04030000",
    "FHPTJ04040000",
    "FHPPG04650101",
    "FHPPG04650201",
    "H0STASP0",
    "H0STCNT0",
    "H0NXASP0",
    "H0NXCNT0",
    "H0NXMKO0",
    "H0UNASP0",
    "H0UNCNT0",
    "HDFSASP0",
    "HDFSCNT0",
  ],
} as const;

export interface KisRegistryInspection {
  valid: boolean;
  violations: string[];
}

function unexpectedRegistryValues(
  registryName: string,
  actual: readonly string[],
  allowed: readonly string[],
): string[] {
  const allowedValues = new Set(allowed);
  const actualValues = new Set(actual);
  return [
    ...actual
      .filter((value) => !allowedValues.has(value))
      .map((value) => `unexpected-${registryName}:${value}`),
    ...allowed
      .filter((value) => !actualValues.has(value))
      .map((value) => `missing-${registryName}:${value}`),
  ];
}

export function inspectReadOnlyKisRegistry(): KisRegistryInspection {
  const violations = [
    ...unexpectedRegistryValues(
      "path",
      Object.values(KIS_PATH),
      KIS_READ_ONLY_ALLOWLIST.paths,
    ),
    ...unexpectedRegistryValues(
      "trId",
      Object.values(KIS_TR),
      KIS_READ_ONLY_ALLOWLIST.trIds,
    ),
  ];
  return { valid: violations.length === 0, violations };
}

export const KIS_ORDER_TR_ID_PATTERN = /\b[TV]TT[CTS]\d{4}U\b/;

export function isKnownKisOrderTrId(value: string): boolean {
  return KIS_ORDER_TR_ID_PATTERN.test(value);
}
