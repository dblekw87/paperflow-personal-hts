import { describe, expect, it, vi } from "vitest";

import { KrxDailyStockTradeClient } from "../src/krx/daily-stock-trade.js";
import { KrxOpenApiClient } from "../src/krx/openapi-client.js";

const NOW = new Date("2026-07-22T00:00:00.000Z");

function client(rowsByPath: Readonly<Record<string, readonly unknown[]>>) {
  const openApi = new KrxOpenApiClient({
    credentials: { authKey: "krx-auth-key-1234567890" },
    fetch: vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("basDd")).toBe("20260721");
      expect(new Headers(init?.headers).get("AUTH_KEY")).toBe(
        "krx-auth-key-1234567890",
      );
      return new Response(
        JSON.stringify({ OutBlock_1: rowsByPath[url.pathname] ?? [] }),
      );
    }) as typeof fetch,
  });
  return new KrxDailyStockTradeClient({
    client: openApi,
    clock: () => NOW,
  });
}

const kospiRows = [
  {
    BAS_DD: "20260721",
    ISU_CD: "005930",
    ISU_NM: "삼성전자",
    MKT_NM: "KOSPI",
    TDD_CLSPRC: "259,000",
    CMPPREVDD_PRC: "15,000",
    FLUC_RT: "6.15",
    ACC_TRDVOL: "20,386,896",
    ACC_TRDVAL: "5,224,700,000,000",
    MKTCAP: "1,546,170,000,000,000",
    LIST_SHRS: "5,969,782,550",
  },
  {
    BAS_DD: "20260721",
    ISU_CD: "000660",
    ISU_NM: "SK하이닉스",
    MKT_NM: "KOSPI",
    TDD_CLSPRC: "1,836,000",
    CMPPREVDD_PRC: "-72,000",
    FLUC_RT: "-4.08",
    ACC_TRDVOL: "1,000,000",
    ACC_TRDVAL: "1,836,000,000,000",
  },
] as const;

const kosdaqRows = [
  {
    BAS_DD: "20260721",
    ISU_CD: "091990",
    ISU_NM: "셀트리온헬스케어",
    MKT_NM: "KOSDAQ",
    TDD_CLSPRC: "91,500",
    CMPPREVDD_PRC: "2,500",
    FLUC_RT: "2.81",
    ACC_TRDVOL: "30,000,000",
    ACC_TRDVAL: "2,745,000,000,000",
  },
] as const;

describe("KrxDailyStockTradeClient", () => {
  it("normalizes KRX daily trade rows without leaking provider formatting", async () => {
    const result = await client({
      "/svc/apis/sto/stk_bydd_trd": kospiRows,
    }).getDailyTrades("KOSPI", "20260721");

    expect(result[0]).toMatchObject({
      businessDate: "20260721",
      market: "KOSPI",
      symbol: "005930",
      name: "삼성전자",
      price: "259000",
      change: "15000",
      changeRate: "6.15",
      cumulativeVolume: "20386896",
      cumulativeTurnover: "5224700000000",
      marketCap: "1546170000000000",
      listedShares: "5969782550",
    });
  });

  it("sorts KOSPI and KOSDAQ rows for turnover and change-rate rankings", async () => {
    const rankingClient = client({
      "/svc/apis/sto/stk_bydd_trd": kospiRows,
      "/svc/apis/sto/ksq_bydd_trd": kosdaqRows,
    });

    await expect(
      rankingClient.getRanking({
        businessDate: "20260721",
        sort: "TURNOVER",
        limit: 2,
      }),
    ).resolves.toMatchObject({
      market: "KRX",
      source: "KRX_OPENAPI",
      fetchedAt: NOW.toISOString(),
      items: [{ symbol: "005930" }, { symbol: "091990" }],
    });
    await expect(
      rankingClient.getRanking({
        businessDate: "20260721",
        sort: "CHANGE_RATE_LOSERS",
      }),
    ).resolves.toMatchObject({
      items: [{ symbol: "000660", changeRate: "-4.08" }],
    });
  });

  it("fails closed when KRX changes the daily trade shape", async () => {
    await expect(
      client({
        "/svc/apis/sto/stk_bydd_trd": [{ ISU_CD: "005930" }],
      }).getDailyTrades("KOSPI", "20260721"),
    ).rejects.toMatchObject({
      code: "KRX_DAILY_STOCK_SCHEMA_MISMATCH",
    });
  });
});
