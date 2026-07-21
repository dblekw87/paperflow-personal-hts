import { describe, expect, it, vi } from "vitest";

import { KrxShortSellingClient } from "../src/krx/short-selling.js";
import { KrxStatDownloadClient } from "../src/krx/stat-download-client.js";

const NOW = new Date("2026-07-22T00:00:00.000Z");

const csv = [
  "일자,종목코드,종목명,시장구분,공매도 거래량,거래량,공매도 거래대금,거래대금,공매도 비중",
  "2026/07/21,005930,삼성전자,KOSPI,\"1,234\",\"20,386,896\",\"319,606\",\"5,224,700\",\"6.12\"",
  "2026/07/21,000660,SK하이닉스,KOSPI,\"100\",\"1,000\",\"183,600\",\"1,836,000\",\"10.00\"",
].join("\n");

const balanceCsv = [
  "일자,종목코드,종목명,공매도 잔고수량,상장주식수,공매도 잔고금액,시가총액,비중",
  "2026/07/21,042700,한미반도체,\"11,000\",\"127,000,000\",\"1,650,000\",\"19,050,000\",\"0.09\"",
  "2026/07/21,005930,삼성전자,\"100,000\",\"5,969,782,550\",\"25,900,000\",\"1,546,170,000\",\"0.02\"",
].join("\n");

function client(downloadedCsv: string, fetchMock?: ReturnType<typeof vi.fn>) {
  return new KrxShortSellingClient({
    clock: () => NOW,
    client: new KrxStatDownloadClient({
      fetch: (fetchMock ??
        vi
          .fn()
          .mockResolvedValueOnce(new Response("otp-code"))
          .mockResolvedValueOnce(
            new Response(downloadedCsv, {
              headers: { "content-type": "text/csv; charset=UTF-8" },
            }),
          )) as unknown as typeof fetch,
    }),
  });
}

describe("KrxShortSellingClient", () => {
  it("normalizes MDCSTAT30101 short-selling trade CSV for the selected symbol", async () => {
    const result = await client(csv).getTradeByStock({
      symbol: "005930",
      market: "KOSPI",
      fromDate: "20260619",
      toDate: "20260721",
    });

    expect(result).toMatchObject({
      source: "KRX_DATA_PRODUCT",
      fetchedAt: NOW.toISOString(),
      businessDate: "20260721",
      market: "KOSPI",
      symbol: "005930",
      name: "삼성전자",
      shortSellVolume: "1234",
      shortSellTurnover: "319606",
      shortSellRatio: "6.12",
    });
  });

  it("sends the confirmed KRX MDCSTAT30101 request parameters", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async (_input: unknown, init?: RequestInit) => {
        const body = new URLSearchParams(String(init?.body));
        expect(body.get("locale")).toBe("ko_KR");
        expect(body.get("searchType")).toBe("1");
        expect(body.get("mktId")).toBe("STK");
        expect(body.get("secugrpId")).toBe("BC");
        expect(body.get("inqCond")).toBe("STMFRTSCIFDRFSSRSWBC");
        expect(body.get("trdDd")).toBe("20260721");
        expect(body.get("share")).toBe("1");
        expect(body.get("money")).toBe("1");
        expect(body.get("url")).toBe("dbms/MDC/STAT/srt/MDCSTAT30101");
        return new Response("otp-code");
      })
      .mockResolvedValueOnce(
        new Response(csv, {
          headers: { "content-type": "text/csv; charset=UTF-8" },
        }),
      );

    await client(csv, fetchMock).getTradeByStock({
      symbol: "005930",
      market: "KOSPI",
      fromDate: "20260619",
      toDate: "20260721",
    });
  });

  it("fails closed when the selected symbol is absent", async () => {
    await expect(
      client(csv).getTradeByStock({
        symbol: "035720",
        market: "KOSPI",
        fromDate: "20260619",
        toDate: "20260721",
      }),
    ).rejects.toMatchObject({
      code: "KRX_SHORT_SELLING_SYMBOL_NOT_FOUND",
    });
  });

  it("normalizes MDCSTAT30501 short-selling balance CSV for the selected symbol", async () => {
    const result = await client(balanceCsv).getBalanceByStock({
      symbol: "042700",
      isin: "KR7042700005",
      name: "한미반도체",
      market: "KOSPI",
      fromDate: "20260619",
      toDate: "20260721",
    });

    expect(result).toMatchObject({
      source: "KRX_DATA_PRODUCT",
      fetchedAt: NOW.toISOString(),
      businessDate: "20260721",
      market: "KOSPI",
      symbol: "042700",
      name: "한미반도체",
      shortBalanceQuantity: "11000",
      shortBalanceTurnover: "1650000",
      shortBalanceRatio: "0.09",
    });
  });

  it("sends the confirmed KRX MDCSTAT30501 balance request parameters", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async (_input: unknown, init?: RequestInit) => {
        const body = new URLSearchParams(String(init?.body));
        expect(body.get("locale")).toBe("ko_KR");
        expect(body.get("searchType")).toBe("1");
        expect(body.get("mktTpCd")).toBe("1");
        expect(body.get("trdDd")).toBe("20260721");
        expect(body.get("isuCd")).toBe("KR7042700005");
        expect(body.get("tboxisuCd_finder_srtisu0_9")).toBe("042700/한미반도체");
        expect(body.get("share")).toBe("1");
        expect(body.get("money")).toBe("1");
        expect(body.get("url")).toBe("dbms/MDC/STAT/srt/MDCSTAT30501");
        return new Response("otp-code");
      })
      .mockResolvedValueOnce(
        new Response(balanceCsv, {
          headers: { "content-type": "text/csv; charset=UTF-8" },
        }),
      );

    await client(balanceCsv, fetchMock).getBalanceByStock({
      symbol: "042700",
      isin: "KR7042700005",
      name: "한미반도체",
      market: "KOSPI",
      fromDate: "20260619",
      toDate: "20260721",
    });
  });
});
