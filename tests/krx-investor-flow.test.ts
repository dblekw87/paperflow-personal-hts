import { describe, expect, it, vi } from "vitest";

import { KrxInvestorFlowClient } from "../src/krx/investor-flow.js";
import { KrxStatDownloadClient } from "../src/krx/stat-download-client.js";

const NOW = new Date("2026-07-22T00:00:00.000Z");

const csv = [
  "투자자구분,거래량,거래량,거래량,거래대금,거래대금,거래대금",
  ",매도,매수,순매수,매도,매수,순매수",
  "기관합계,\"287,710\",\"300,103\",\"12,393\",\"49,536,855\",\"50,981,666\",\"1,444,811\"",
  "개인,\"2,946,843\",\"2,948,680\",\"1,837\",\"65,461,704\",\"61,897,378\",\"-3,564,326\"",
  "외국인,\"1,375,180\",\"1,339,654\",\"-35,525\",\"76,360,799\",\"78,389,185\",\"2,028,386\"",
  "전체,\"4,653,930\",\"4,653,930\",0,\"192,813,404\",\"192,813,404\",0",
].join("\n");

function client(downloadedCsv: string) {
  return new KrxInvestorFlowClient({
    clock: () => NOW,
    client: new KrxStatDownloadClient({
      fetch: vi
        .fn()
        .mockResolvedValueOnce(new Response("otp-code"))
        .mockResolvedValueOnce(
          new Response(downloadedCsv, {
            headers: { "content-type": "text/csv; charset=UTF-8" },
          }),
        ) as unknown as typeof fetch,
    }),
  });
}

describe("KrxInvestorFlowClient", () => {
  it("normalizes MDCSTAT02301 investor-by-stock CSV into base share and KRW units", async () => {
    const result = await client(csv).getInvestorByStock({
      symbol: "005930",
      isin: "KR7005930003",
      name: "삼성전자",
      fromDate: "20260714",
      toDate: "20260721",
    });

    expect(result).toMatchObject({
      instrumentId: "KRX:005930",
      source: "KRX_DATA_PRODUCT",
      fetchedAt: NOW.toISOString(),
      rows: [
        {
          businessDate: "20260721",
          individual: {
            sellQuantity: "2946843000",
            buyQuantity: "2948680000",
            netBuyQuantity: "1837000",
            sellAmount: "65461704000000",
            buyAmount: "61897378000000",
            netBuyAmount: "-3564326000000",
          },
          foreign: {
            netBuyQuantity: "-35525000",
            netBuyAmount: "2028386000000",
          },
          institution: {
            netBuyQuantity: "12393000",
            netBuyAmount: "1444811000000",
          },
        },
      ],
    });
  });

  it("sends the confirmed KRX MDCSTAT02301 request parameters", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async (_input: unknown, init?: RequestInit) => {
        const body = new URLSearchParams(String(init?.body));
        expect(body.get("locale")).toBe("ko_KR");
        expect(body.get("inqTpCd")).toBe("1");
        expect(body.get("trdVolVal")).toBe("2");
        expect(body.get("askBid")).toBe("3");
        expect(body.get("isuCd")).toBe("KR7005930003");
        expect(body.get("url")).toBe("dbms/MDC/STAT/standard/MDCSTAT02301");
        expect(body.get("share")).toBe("1");
        expect(body.get("money")).toBe("1");
        return new Response("otp-code");
      })
      .mockResolvedValueOnce(
        new Response(csv, {
          headers: { "content-type": "text/csv; charset=UTF-8" },
        }),
      );

    await new KrxInvestorFlowClient({
      clock: () => NOW,
      client: new KrxStatDownloadClient({
        fetch: fetchMock as unknown as typeof fetch,
      }),
    }).getInvestorByStock({
      symbol: "005930",
      isin: "KR7005930003",
      name: "삼성전자",
      fromDate: "20260714",
      toDate: "20260721",
    });
  });

  it("fails closed when a required participant row is missing", async () => {
    await expect(
      client("투자자구분,매도,매수,순매수,매도,매수,순매수\n개인,1,1,0,1,1,0")
        .getInvestorByStock({
          symbol: "005930",
          isin: "KR7005930003",
          name: "삼성전자",
          fromDate: "20260714",
          toDate: "20260721",
        }),
    ).rejects.toMatchObject({
      code: "KRX_INVESTOR_FLOW_MISSING_PARTICIPANT",
    });
  });

  it("normalizes MDCSTAT02201 market investor CSV using whole-share and KRW units", async () => {
    const result = await client(csv).getMarketInvestorFlow({
      market: "ALL",
      fromDate: "20260714",
      toDate: "20260721",
    });

    expect(result).toMatchObject({
      market: "ALL",
      source: "KRX_DATA_PRODUCT",
      fetchedAt: NOW.toISOString(),
      quality: "PROVIDER_REPORTED_SNAPSHOT_FINALITY_UNKNOWN",
      rows: [
        {
          businessDate: "20260721",
          individual: {
            sellQuantity: "2946843",
            buyQuantity: "2948680",
            netBuyQuantity: "1837",
            sellAmount: "65461704000000",
            buyAmount: "61897378000000",
            netBuyAmount: "-3564326000000",
          },
          foreign: {
            netBuyQuantity: "-35525",
            netBuyAmount: "2028386000000",
          },
          institution: {
            netBuyQuantity: "12393",
            netBuyAmount: "1444811000000",
          },
        },
      ],
    });
  });

  it("sends the confirmed KRX MDCSTAT02201 market request parameters", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async (_input: unknown, init?: RequestInit) => {
        const body = new URLSearchParams(String(init?.body));
        expect(body.get("locale")).toBe("ko_KR");
        expect(body.get("inqTpCd")).toBe("1");
        expect(body.get("trdVolVal")).toBe("2");
        expect(body.get("askBid")).toBe("3");
        expect(body.get("mktId")).toBe("ALL");
        expect(body.get("strtDd")).toBe("20260714");
        expect(body.get("endDd")).toBe("20260721");
        expect(body.get("share")).toBe("2");
        expect(body.get("money")).toBe("3");
        expect(body.get("url")).toBe("dbms/MDC/STAT/standard/MDCSTAT02201");
        return new Response("otp-code");
      })
      .mockResolvedValueOnce(
        new Response(csv, {
          headers: { "content-type": "text/csv; charset=UTF-8" },
        }),
      );

    await new KrxInvestorFlowClient({
      clock: () => NOW,
      client: new KrxStatDownloadClient({
        fetch: fetchMock as unknown as typeof fetch,
      }),
    }).getMarketInvestorFlow({
      market: "ALL",
      fromDate: "20260714",
      toDate: "20260721",
    });
  });
});
