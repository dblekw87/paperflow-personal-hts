import {
  OrderBookSnapshotSchema,
  TradeTickSchema,
  type OrderBookSnapshot,
  type TradeTick,
} from "../../contracts/market.js";
import { KisApiError } from "../errors.js";
import { KIS_TR } from "../endpoints.js";
import type { KisPipeFrame } from "./frame.js";

function required(
  record: Readonly<Record<string, string | null>>,
  field: string,
): string {
  const value = record[field];
  if (value === undefined || value === null) {
    throw new KisApiError({
      code: "KIS_WS_REQUIRED_FIELD_MISSING",
      message: `Required KIS field ${field} is missing`,
      retryable: false,
    });
  }
  return value;
}

function optional(
  record: Readonly<Record<string, string | null>>,
  field: string,
): string | null {
  return record[field] ?? null;
}

function parseOffsetInstant(
  date: string,
  time: string,
  offset: string,
): string | null {
  if (!/^\d{8}$/.test(date) || !/^\d{6}$/.test(time)) {
    return null;
  }
  const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time.slice(
    0,
    2,
  )}:${time.slice(2, 4)}:${time.slice(4, 6)}${offset}`;
  const instant = new Date(iso);
  return Number.isNaN(instant.getTime()) ? null : instant.toISOString();
}

function signedChange(
  value: string | null,
  signCode: string | null,
): string | null {
  if (value === null) {
    return null;
  }
  const absolute = value.replace(/^[+-]/, "");
  return signCode === "5" || signCode === "4" ? `-${absolute}` : absolute;
}

export function domesticSessionFromProviderTime(
  providerTime: string,
): TradeTick["session"] {
  if (!/^\d{6}$/.test(providerTime)) {
    return "UNKNOWN";
  }
  if (providerTime >= "083000" && providerTime < "090000") {
    return "PRE";
  }
  if (providerTime >= "090000" && providerTime < "152000") {
    return "REGULAR";
  }
  if (providerTime >= "154000" && providerTime <= "180000") {
    return "AFTER";
  }
  return "CLOSED";
}

export function nxtSessionFromProviderTime(
  providerTime: string,
): TradeTick["session"] {
  if (!/^\d{6}$/.test(providerTime)) return "UNKNOWN";
  if (providerTime >= "080000" && providerTime < "085000") return "PRE";
  if (providerTime >= "090030" && providerTime < "152000") return "REGULAR";
  if (providerTime >= "154000" && providerTime <= "200000") return "AFTER";
  return "CLOSED";
}

export function consolidatedSessionFromProviderTime(
  providerTime: string,
): TradeTick["session"] {
  if (!/^\d{6}$/.test(providerTime)) return "UNKNOWN";
  if (providerTime >= "080000" && providerTime < "085000") return "PRE";
  if (providerTime >= "090000" && providerTime <= "153000") return "REGULAR";
  if (providerTime >= "154000" && providerTime <= "200000") return "AFTER";
  return "CLOSED";
}

export function normalizeDomesticTrade(frame: KisPipeFrame): TradeTick[] {
  if (frame.trId !== KIS_TR.domesticTrade) {
    throw new KisApiError({
      code: "KIS_WS_WRONG_TR_ID",
      message: "Domestic trade normalizer received a different TR ID",
      retryable: false,
    });
  }

  return frame.records.map((record) => {
    const providerTime = required(record, "STCK_CNTG_HOUR");
    return TradeTickSchema.parse({
      instrumentId: `KRX:${required(record, "MKSC_SHRN_ISCD")}`,
      venue: "KRX",
      session: domesticSessionFromProviderTime(providerTime),
      price: required(record, "STCK_PRPR"),
      quantity: required(record, "CNTG_VOL"),
      change: signedChange(
        optional(record, "PRDY_VRSS"),
        optional(record, "PRDY_VRSS_SIGN"),
      ),
      changeRate: signedChange(
        optional(record, "PRDY_CTRT"),
        optional(record, "PRDY_VRSS_SIGN"),
      ),
      executionStrength: optional(record, "CTTR"),
      cumulativeVolume: optional(record, "ACML_VOL"),
      cumulativeTurnover: optional(record, "ACML_TR_PBMN"),
      occurredAt: parseOffsetInstant(
        required(record, "BSOP_DATE"),
        providerTime,
        "+09:00",
      ),
      providerDate: required(record, "BSOP_DATE"),
      providerTime,
      source: "KIS_WS",
    });
  });
}

function normalizeAlternativeDomesticTrade(
  frame: KisPipeFrame,
  expectedTrId:
    | typeof KIS_TR.domesticNxtTrade
    | typeof KIS_TR.domesticUnifiedTrade,
  venue: "NXT" | "CONSOLIDATED",
): TradeTick[] {
  if (frame.trId !== expectedTrId) {
    throw new KisApiError({
      code: "KIS_WS_WRONG_TR_ID",
      message: `${venue} trade normalizer received a different TR ID`,
      retryable: false,
    });
  }
  return frame.records.map((record) => {
    const providerTime = required(record, "STCK_CNTG_HOUR");
    return TradeTickSchema.parse({
      instrumentId: `${venue}:${required(record, "MKSC_SHRN_ISCD")}`,
      venue,
      session:
        venue === "NXT"
          ? nxtSessionFromProviderTime(providerTime)
          : consolidatedSessionFromProviderTime(providerTime),
      price: required(record, "STCK_PRPR"),
      quantity: required(record, "CNTG_VOL"),
      change: signedChange(
        optional(record, "PRDY_VRSS"),
        optional(record, "PRDY_VRSS_SIGN"),
      ),
      changeRate: signedChange(
        optional(record, "PRDY_CTRT"),
        optional(record, "PRDY_VRSS_SIGN"),
      ),
      executionStrength: optional(record, "CTTR"),
      cumulativeVolume: optional(record, "ACML_VOL"),
      cumulativeTurnover: optional(record, "ACML_TR_PBMN"),
      occurredAt: parseOffsetInstant(
        required(record, "BSOP_DATE"),
        providerTime,
        "+09:00",
      ),
      providerDate: required(record, "BSOP_DATE"),
      providerTime,
      source: "KIS_WS",
    });
  });
}

export function normalizeNxtTrade(frame: KisPipeFrame): TradeTick[] {
  return normalizeAlternativeDomesticTrade(
    frame,
    KIS_TR.domesticNxtTrade,
    "NXT",
  );
}

export function normalizeUnifiedDomesticTrade(
  frame: KisPipeFrame,
): TradeTick[] {
  return normalizeAlternativeDomesticTrade(
    frame,
    KIS_TR.domesticUnifiedTrade,
    "CONSOLIDATED",
  );
}

export function normalizeDomesticOrderBook(
  frame: KisPipeFrame,
  businessDate: string,
): OrderBookSnapshot[] {
  if (frame.trId !== KIS_TR.domesticOrderBook) {
    throw new KisApiError({
      code: "KIS_WS_WRONG_TR_ID",
      message: "Domestic order-book normalizer received a different TR ID",
      retryable: false,
    });
  }

  return frame.records.map((record) => {
    const asks = Array.from({ length: 10 }, (_, index) => ({
      price: required(record, `ASKP${index + 1}`),
      quantity: required(record, `ASKP_RSQN${index + 1}`),
    }));
    const bids = Array.from({ length: 10 }, (_, index) => ({
      price: required(record, `BIDP${index + 1}`),
      quantity: required(record, `BIDP_RSQN${index + 1}`),
    }));
    const providerTime = required(record, "BSOP_HOUR");

    return OrderBookSnapshotSchema.parse({
      instrumentId: `KRX:${required(record, "MKSC_SHRN_ISCD")}`,
      venue: "KRX",
      bids,
      asks,
      totalBidQuantity: optional(record, "TOTAL_BIDP_RSQN"),
      totalAskQuantity: optional(record, "TOTAL_ASKP_RSQN"),
      occurredAt: parseOffsetInstant(businessDate, providerTime, "+09:00"),
      providerDate: businessDate,
      providerTime,
      source: "KIS_WS",
    });
  });
}

function normalizeAlternativeDomesticOrderBook(
  frame: KisPipeFrame,
  businessDate: string,
  expectedTrId:
    | typeof KIS_TR.domesticNxtOrderBook
    | typeof KIS_TR.domesticUnifiedOrderBook,
  venue: "NXT" | "CONSOLIDATED",
): OrderBookSnapshot[] {
  if (frame.trId !== expectedTrId) {
    throw new KisApiError({
      code: "KIS_WS_WRONG_TR_ID",
      message: `${venue} order-book normalizer received a different TR ID`,
      retryable: false,
    });
  }
  return frame.records.map((record) => {
    const asks = Array.from({ length: 10 }, (_, index) => ({
      price: required(record, `ASKP${index + 1}`),
      quantity: required(record, `ASKP_RSQN${index + 1}`),
    }));
    const bids = Array.from({ length: 10 }, (_, index) => ({
      price: required(record, `BIDP${index + 1}`),
      quantity: required(record, `BIDP_RSQN${index + 1}`),
    }));
    const providerTime = required(record, "BSOP_HOUR");
    return OrderBookSnapshotSchema.parse({
      instrumentId: `${venue}:${required(record, "MKSC_SHRN_ISCD")}`,
      venue,
      bids,
      asks,
      totalBidQuantity: optional(record, "TOTAL_BIDP_RSQN"),
      totalAskQuantity: optional(record, "TOTAL_ASKP_RSQN"),
      occurredAt: parseOffsetInstant(businessDate, providerTime, "+09:00"),
      providerDate: businessDate,
      providerTime,
      source: "KIS_WS",
    });
  });
}

export function normalizeNxtOrderBook(
  frame: KisPipeFrame,
  businessDate: string,
): OrderBookSnapshot[] {
  return normalizeAlternativeDomesticOrderBook(
    frame,
    businessDate,
    KIS_TR.domesticNxtOrderBook,
    "NXT",
  );
}

export function normalizeUnifiedDomesticOrderBook(
  frame: KisPipeFrame,
  businessDate: string,
): OrderBookSnapshot[] {
  return normalizeAlternativeDomesticOrderBook(
    frame,
    businessDate,
    KIS_TR.domesticUnifiedOrderBook,
    "CONSOLIDATED",
  );
}

export function normalizeUsTrade(
  frame: KisPipeFrame,
  venue: string,
): TradeTick[] {
  if (frame.trId !== KIS_TR.usTrade) {
    throw new KisApiError({
      code: "KIS_WS_WRONG_TR_ID",
      message: "US trade normalizer received a different TR ID",
      retryable: false,
    });
  }

  return frame.records.map((record) =>
    TradeTickSchema.parse({
      instrumentId: `${venue}:${required(record, "SYMB")}`,
      venue,
      session: "UNKNOWN",
      price: required(record, "LAST"),
      quantity: required(record, "EVOL"),
      change: signedChange(optional(record, "DIFF"), optional(record, "SIGN")),
      changeRate: signedChange(
        optional(record, "RATE"),
        optional(record, "SIGN"),
      ),
      executionStrength: optional(record, "STRN"),
      cumulativeVolume: optional(record, "TVOL"),
      cumulativeTurnover: optional(record, "TAMT"),
      occurredAt: null,
      providerDate: optional(record, "XYMD"),
      providerTime: optional(record, "XHMS"),
      source: "KIS_WS",
    }),
  );
}

export function normalizeUsOrderBook(
  frame: KisPipeFrame,
  venue: string,
): OrderBookSnapshot[] {
  if (frame.trId !== KIS_TR.usOrderBook) {
    throw new KisApiError({
      code: "KIS_WS_WRONG_TR_ID",
      message: "US order-book normalizer received a different TR ID",
      retryable: false,
    });
  }

  return frame.records.map((record) => {
    const depth = record.pbid10 === undefined ? 1 : 10;
    return OrderBookSnapshotSchema.parse({
      instrumentId: `${venue}:${required(record, "symb")}`,
      venue,
      bids: Array.from({ length: depth }, (_, index) => ({
        price: required(record, `pbid${index + 1}`),
        quantity: required(record, `vbid${index + 1}`),
      })),
      asks: Array.from({ length: depth }, (_, index) => ({
        price: required(record, `pask${index + 1}`),
        quantity: required(record, `vask${index + 1}`),
      })),
      totalBidQuantity: optional(record, "bvol"),
      totalAskQuantity: optional(record, "avol"),
      occurredAt: null,
      providerDate: optional(record, "xymd"),
      providerTime: optional(record, "xhms"),
      source: "KIS_WS",
    });
  });
}
