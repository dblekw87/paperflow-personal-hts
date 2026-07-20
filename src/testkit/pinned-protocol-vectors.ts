import { KIS_TR } from "../kis/endpoints.js";
import type { SupportedWsTrId } from "../kis/ws/layouts.js";

export interface PinnedProtocolVector {
  id: string;
  trId: SupportedWsTrId;
  referenceCommit: "885dd4e2f5c37e4f7e23dd63c15555a9967bc7bc";
  referenceFile: string;
  environment:
    | "SYNTHETIC_PINNED_PROTOCOL_VECTOR"
    | "KIS_PAPER_OBSERVED_PUBLIC_MARKET_DATA";
  containsCredentials: false;
  observedAt?: string;
  providerFieldCount?: number;
  raw: string;
}

const metadata = {
  referenceCommit: "885dd4e2f5c37e4f7e23dd63c15555a9967bc7bc",
  environment: "SYNTHETIC_PINNED_PROTOCOL_VECTOR",
  containsCredentials: false,
} as const;

export const PINNED_PROTOCOL_VECTORS = {
  domesticTrade: {
    ...metadata,
    id: "kis-ws-domestic-trade-v1",
    trId: KIS_TR.domesticTrade,
    referenceFile:
      "examples_user/domestic_stock/domestic_stock_functions_ws.py",
    raw: "0|H0STCNT0|001|005930^101530^80000^2^1000^1.27^0^0^0^0^0^0^10^1000000^80000000000^0^0^0^0^0^0^0^0^0^0^0^0^0^0^0^0^0^0^20260720^0^0^0^0^0^0^0^0^0^0^0^0",
  },
  domesticOrderBook: {
    ...metadata,
    id: "kis-ws-domestic-orderbook-v1",
    trId: KIS_TR.domesticOrderBook,
    referenceFile:
      "examples_user/domestic_stock/domestic_stock_functions_ws.py",
    raw: "0|H0STASP0|001|005930^101530^0^80100^0^0^0^0^0^0^0^0^0^80000^0^0^0^0^0^0^0^0^0^120^0^0^0^0^0^0^0^0^0^140^0^0^0^0^0^0^0^0^0^1200^1400^0^0^0^0^0^0^0^0^0^0^0^0^0^0",
  },
  domesticOrderBookObserved62: {
    referenceCommit: metadata.referenceCommit,
    environment: "KIS_PAPER_OBSERVED_PUBLIC_MARKET_DATA",
    containsCredentials: false,
    id: "kis-ws-domestic-orderbook-observed-62-v1",
    trId: KIS_TR.domesticOrderBook,
    referenceFile:
      "live H0STASP0 observation; official names remain pinned to domestic_stock_functions_ws.py",
    observedAt: "2026-07-20T06:05:26.000Z",
    providerFieldCount: 62,
    raw: "0|H0STASP0|001|005930^150526^0^244500^245000^245500^246000^246500^247000^247500^248000^248500^249000^244000^243500^243000^242500^242000^241500^241000^240500^240000^239500^11496^36948^19007^22540^12870^12221^13073^19411^20347^22276^12170^22374^52388^48566^62462^69521^94224^95922^258614^54062^190189^770303^0^0^0^0^1168850^-255000^5^-100.00^20948916^0^1^0^0^0^244250^0^0",
  },
  usTrade: {
    ...metadata,
    id: "kis-ws-us-trade-v1",
    trId: KIS_TR.usTrade,
    referenceFile:
      "examples_user/overseas_stock/overseas_stock_functions_ws.py",
    raw: "0|HDFSCNT0|001|AAPL^0^0^20260719^101530^0^0^0^0^0^250.125^2^2.500^1.010^0^0^0^0^10^100000^25012500^0^0^0^0",
  },
  usOrderBook: {
    ...metadata,
    id: "kis-ws-us-orderbook-v1",
    trId: KIS_TR.usOrderBook,
    referenceFile:
      "examples_user/overseas_stock/overseas_stock_functions_ws.py",
    raw: "0|HDFSASP0|001|AAPL^0^20260719^101530^0^0^1000^900^0^0^250.120^250.130^100^90^0^0",
  },
} as const satisfies Record<string, PinnedProtocolVector>;
