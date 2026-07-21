import { describe, expect, it } from "vitest";

import { KIS_TR } from "../src/kis/endpoints.js";
import { KisApiError } from "../src/kis/errors.js";
import { parseKisWsFrame } from "../src/kis/ws/frame.js";
import {
  KIS_WS_LAYOUTS,
  NXT_ORDERBOOK_FIELDS,
  NXT_ORDERBOOK_PAPER_FIELDS,
} from "../src/kis/ws/layouts.js";
import {
  domesticSessionFromProviderTime,
  nxtSessionFromProviderTime,
  normalizeDomesticOrderBook,
  normalizeDomesticTrade,
  normalizeNxtOrderBook,
  normalizeNxtTrade,
  normalizeUsOrderBook,
  normalizeUsTrade,
} from "../src/kis/ws/normalize.js";
import { syntheticWsFrame } from "../src/testkit/synthetic-fixtures.js";
import { PINNED_PROTOCOL_VECTORS } from "../src/testkit/pinned-protocol-vectors.js";
import { US_ORDERBOOK_OBSERVED_FIELDS, US_TRADE_OBSERVED_FIELDS } from "../src/kis/ws/layouts.js";

describe("KIS WebSocket frame contracts", () => {
  it("accepts the exact observed KIS prod US depth and RSYM layouts", () => {
    const bookPrefix: Record<string, string> = { rsym: "DNASAAPL", symb: "AAPL", pbid1: "325.10", pask1: "325.11", vbid1: "10", vask1: "12", bvol: "100", avol: "120" };
    for (let level = 2; level <= 10; level += 1) {
      bookPrefix[`pbid${level}`] = String(325.10 - level / 100);
      bookPrefix[`pask${level}`] = String(325.11 + level / 100);
      bookPrefix[`vbid${level}`] = String(level * 10);
      bookPrefix[`vask${level}`] = String(level * 12);
      bookPrefix[`dbid${level}`] = "0";
      bookPrefix[`dask${level}`] = "0";
    }
    const bookValues = US_ORDERBOOK_OBSERVED_FIELDS.map((field) => bookPrefix[field] ?? "");
    const book = parseKisWsFrame(`0|${KIS_TR.usOrderBook}|001|${bookValues.join("^")}`);
    expect(book.kind).toBe("DATA");
    if (book.kind !== "DATA") throw new Error("Expected data frame");
    const normalizedBook = normalizeUsOrderBook(book, "NASDAQ")[0];
    expect(normalizedBook).toMatchObject({ instrumentId: "NASDAQ:AAPL" });
    expect(normalizedBook?.bids).toHaveLength(10);
    expect(normalizedBook?.asks).toHaveLength(10);

    const tradePrefix: Record<string, string> = { RSYM: "DNASAAPL", SYMB: "AAPL", LAST: "325.11", EVOL: "2", TVOL: "1000", STRN: "76.53" };
    const tradeValues = US_TRADE_OBSERVED_FIELDS.map((field) => tradePrefix[field] ?? "");
    const trade = parseKisWsFrame(`0|${KIS_TR.usTrade}|001|${tradeValues.join("^")}`);
    expect(trade.kind).toBe("DATA");
    if (trade.kind !== "DATA") throw new Error("Expected data frame");
    expect(normalizeUsTrade(trade, "NASDAQ")[0]).toMatchObject({ price: "325.11", quantity: "2", executionStrength: "76.53" });
  });
  it("parses and normalizes all four read-only market-data layouts", () => {
    const domesticTrade = parseKisWsFrame(
      PINNED_PROTOCOL_VECTORS.domesticTrade.raw,
    );
    const domesticOrderBook = parseKisWsFrame(
      PINNED_PROTOCOL_VECTORS.domesticOrderBook.raw,
    );
    const usTrade = parseKisWsFrame(PINNED_PROTOCOL_VECTORS.usTrade.raw);
    const usOrderBook = parseKisWsFrame(
      PINNED_PROTOCOL_VECTORS.usOrderBook.raw,
    );

    expect(domesticTrade.kind).toBe("DATA");
    expect(domesticOrderBook.kind).toBe("DATA");
    expect(usTrade.kind).toBe("DATA");
    expect(usOrderBook.kind).toBe("DATA");

    if (
      domesticTrade.kind !== "DATA" ||
      domesticOrderBook.kind !== "DATA" ||
      usTrade.kind !== "DATA" ||
      usOrderBook.kind !== "DATA"
    ) {
      throw new Error("Expected data frames");
    }

    expect(normalizeDomesticTrade(domesticTrade)[0]).toMatchObject({
      instrumentId: "KRX:005930",
      price: "80000",
      quantity: "10",
      executionStrength: "0",
      occurredAt: "2026-07-20T01:15:30.000Z",
    });
    const normalizedDomesticBook = normalizeDomesticOrderBook(
      domesticOrderBook,
      "20260720",
    )[0];
    expect(normalizedDomesticBook).toMatchObject({
      instrumentId: "KRX:005930",
    });
    expect(normalizedDomesticBook?.asks[0]).toEqual({
      price: "80100",
      quantity: "120",
    });
    expect(normalizeUsTrade(usTrade, "NASDAQ")[0]).toMatchObject({
      instrumentId: "NASDAQ:AAPL",
      price: "250.125",
    });
    expect(normalizeUsOrderBook(usOrderBook, "NASDAQ")[0]).toMatchObject({
      instrumentId: "NASDAQ:AAPL",
      bids: [{ price: "250.120", quantity: "100" }],
      asks: [{ price: "250.130", quantity: "90" }],
    });
  });

  it("chunks a multi-record trade frame using the exact layout size", () => {
    const raw = syntheticWsFrame(KIS_TR.domesticTrade, [
      {
        MKSC_SHRN_ISCD: "005930",
        STCK_CNTG_HOUR: "101530",
        STCK_PRPR: "80000",
        CNTG_VOL: "1",
        ACML_VOL: "1",
        ACML_TR_PBMN: "80000",
        BSOP_DATE: "20260720",
      },
      {
        MKSC_SHRN_ISCD: "000660",
        STCK_CNTG_HOUR: "101531",
        STCK_PRPR: "150000",
        CNTG_VOL: "2",
        ACML_VOL: "2",
        ACML_TR_PBMN: "300000",
        BSOP_DATE: "20260720",
      },
    ]);

    const frame = parseKisWsFrame(raw);
    expect(frame.kind).toBe("DATA");
    if (frame.kind !== "DATA") {
      throw new Error("Expected data frame");
    }
    expect(frame.recordCount).toBe(2);
    expect(frame.records[1]?.MKSC_SHRN_ISCD).toBe("000660");
  });

  it("accepts only the observed 62-field domestic order-book extension", () => {
    const official = PINNED_PROTOCOL_VECTORS.domesticOrderBook.raw;
    const observed =
      PINNED_PROTOCOL_VECTORS.domesticOrderBookObserved62;
    const frame = parseKisWsFrame(observed.raw);
    expect(frame.kind).toBe("DATA");
    if (frame.kind !== "DATA") {
      throw new Error("Expected data frame");
    }
    expect(observed).toMatchObject({
      environment: "KIS_PAPER_OBSERVED_PUBLIC_MARKET_DATA",
      containsCredentials: false,
      providerFieldCount: 62,
    });
    expect(frame.records[0]?.ASKP1).toBe("244500");
    expect(frame.records[0]?.BIDP1).toBe("244000");
    expect(frame.records[0]?.ASKP_RSQN10).toBe("22276");
    expect(frame.records[0]?.BIDP_RSQN10).toBe("54062");
    expect(frame.records[0]?.KIS_UNDOCUMENTED_TRAILING_1).toBe("244250");
    const normalized = normalizeDomesticOrderBook(frame, "20260720")[0];
    expect(normalized?.asks).toHaveLength(10);
    expect(normalized?.bids).toHaveLength(10);
    expect(normalized).toMatchObject({
      instrumentId: "KRX:005930",
      totalAskQuantity: "190189",
      totalBidQuantity: "770303",
    });

    expectKisCode(
      () => parseKisWsFrame(`${official}^244250`),
      "KIS_WS_FIELD_COUNT_MISMATCH",
    );
  });

  it("parses NXT official and observed-paper layouts without reusing KRX aliases", () => {
    const requiredBookValues: Record<string, string> = {
      MKSC_SHRN_ISCD: "005930",
      BSOP_HOUR: "181000",
    };
    for (let level = 1; level <= 10; level += 1) {
      requiredBookValues[`ASKP${level}`] = String(244_000 + level * 500);
      requiredBookValues[`BIDP${level}`] = String(244_000 - level * 500);
      requiredBookValues[`ASKP_RSQN${level}`] = String(100 + level);
      requiredBookValues[`BIDP_RSQN${level}`] = String(200 + level);
    }
    const paperValues = NXT_ORDERBOOK_PAPER_FIELDS.map(
      (field) => requiredBookValues[field] ?? "",
    );
    const paperFrame = parseKisWsFrame(
      `0|${KIS_TR.domesticNxtOrderBook}|001|${paperValues.join("^")}`,
    );
    expect(paperFrame.kind).toBe("DATA");
    if (paperFrame.kind !== "DATA") throw new Error("Expected data frame");
    expect(paperFrame.records[0]?.KMID_PRC).toBeNull();
    expect(paperFrame.records[0]).not.toHaveProperty("NMID_PRC");
    expect(normalizeNxtOrderBook(paperFrame, "20260720")[0]).toMatchObject({
      instrumentId: "NXT:005930",
      venue: "NXT",
    });

    const officialValues = NXT_ORDERBOOK_FIELDS.map(
      (field) => requiredBookValues[field] ?? "",
    );
    expect(
      parseKisWsFrame(
        `0|${KIS_TR.domesticNxtOrderBook}|001|${officialValues.join("^")}`,
      ).kind,
    ).toBe("DATA");
    expectKisCode(
      () =>
        parseKisWsFrame(
          `0|${KIS_TR.domesticNxtOrderBook}|001|${paperValues
            .slice(0, -1)
            .join("^")}`,
        ),
      "KIS_WS_FIELD_COUNT_MISMATCH",
    );

    const tradeFrame = parseKisWsFrame(
      syntheticWsFrame(KIS_TR.domesticNxtTrade, [
        {
          MKSC_SHRN_ISCD: "005930",
          STCK_CNTG_HOUR: "181001",
          STCK_PRPR: "244000",
          CNTG_VOL: "7",
          ACML_VOL: "1007",
          ACML_TR_PBMN: "245000000",
          BSOP_DATE: "20260720",
        },
      ]),
    );
    expect(tradeFrame.kind).toBe("DATA");
    if (tradeFrame.kind !== "DATA") throw new Error("Expected data frame");
    expect(normalizeNxtTrade(tradeFrame)[0]).toMatchObject({
      instrumentId: "NXT:005930",
      venue: "NXT",
      session: "AFTER",
      price: "244000",
    });
  });

  it("derives the supported KRX paper session from provider time", () => {
    expect(domesticSessionFromProviderTime("085959")).toBe("PRE");
    expect(domesticSessionFromProviderTime("090000")).toBe("REGULAR");
    expect(domesticSessionFromProviderTime("151959")).toBe("REGULAR");
    expect(domesticSessionFromProviderTime("152000")).toBe("CLOSED");
    expect(domesticSessionFromProviderTime("154000")).toBe("AFTER");
    expect(domesticSessionFromProviderTime("180001")).toBe("CLOSED");
    expect(domesticSessionFromProviderTime("invalid")).toBe("UNKNOWN");
  });

  it("uses the official NXT pre, main and after-market execution windows", () => {
    expect(nxtSessionFromProviderTime("080000")).toBe("PRE");
    expect(nxtSessionFromProviderTime("085000")).toBe("CLOSED");
    expect(nxtSessionFromProviderTime("090029")).toBe("CLOSED");
    expect(nxtSessionFromProviderTime("090030")).toBe("REGULAR");
    expect(nxtSessionFromProviderTime("152000")).toBe("CLOSED");
    expect(nxtSessionFromProviderTime("153959")).toBe("CLOSED");
    expect(nxtSessionFromProviderTime("154000")).toBe("AFTER");
    expect(nxtSessionFromProviderTime("200001")).toBe("CLOSED");
  });

  it("fails closed for encrypted, unknown, short and long frames", () => {
    const domesticTradeRaw = PINNED_PROTOCOL_VECTORS.domesticTrade.raw;
    const encrypted = domesticTradeRaw.replace(/^0\|/, "1|");
    expectKisCode(
      () => parseKisWsFrame(encrypted),
      "UNSUPPORTED_ENCRYPTED_FRAME",
    );

    const unknown = domesticTradeRaw.replace(KIS_TR.domesticTrade, "UNKNOWN0");
    expectKisCode(() => parseKisWsFrame(unknown), "KIS_WS_UNKNOWN_TR_ID");

    const short = domesticTradeRaw.slice(0, domesticTradeRaw.lastIndexOf("^"));
    expectKisCode(() => parseKisWsFrame(short), "KIS_WS_FIELD_COUNT_MISMATCH");

    const long = `${domesticTradeRaw}^EXTRA`;
    expectKisCode(() => parseKisWsFrame(long), "KIS_WS_FIELD_COUNT_MISMATCH");

    const malformedCount = domesticTradeRaw.replace("|001|", "|001junk|");
    expectKisCode(
      () => parseKisWsFrame(malformedCount),
      "KIS_WS_INVALID_RECORD_COUNT",
    );
  });

  it("pins independent protocol metadata instead of deriving raw vectors from layouts", () => {
    expect(Object.values(PINNED_PROTOCOL_VECTORS)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          referenceCommit: "885dd4e2f5c37e4f7e23dd63c15555a9967bc7bc",
          environment: "SYNTHETIC_PINNED_PROTOCOL_VECTOR",
          containsCredentials: false,
        }),
      ]),
    );
    expect(PINNED_PROTOCOL_VECTORS.domesticTrade.raw).toContain(
      "0|H0STCNT0|001|005930^",
    );
  });

  it("keeps empty raw fields as null", () => {
    const values = KIS_WS_LAYOUTS[KIS_TR.usOrderBook].map(() => "");
    const raw = `0|${KIS_TR.usOrderBook}|001|${values.join("^")}`;
    const frame = parseKisWsFrame(raw);
    expect(frame.kind).toBe("DATA");
    if (frame.kind !== "DATA") {
      throw new Error("Expected data frame");
    }
    expect(frame.records[0]?.symb).toBeNull();
  });

  it("parses PINGPONG as a control frame", () => {
    const raw = JSON.stringify({ header: { tr_id: "PINGPONG" } });
    expect(parseKisWsFrame(raw)).toEqual({
      kind: "CONTROL",
      trId: "PINGPONG",
      trKey: null,
      isPingPong: true,
      success: null,
      message: null,
    });
  });
});

function expectKisCode(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error(`Expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(KisApiError);
    expect((error as KisApiError).code).toBe(code);
  }
}
