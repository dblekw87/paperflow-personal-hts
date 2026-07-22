import { afterEach, describe, expect, it, vi } from "vitest";

import { KisDomesticInvestorFlowClient } from "../src/kis/domestic-investor-flow.js";

const NOW = new Date("2026-07-21T06:30:00.000Z");
const credentials = { appKey: "prod-key", appSecret: "prod-secret" };

function client() {
  return new KisDomesticInvestorFlowClient({
    environment: "prod",
    credentials,
    getAccessToken: async () => "token",
    clock: () => NOW,
  });
}

const stockInvestorRow = {
  stck_bsop_date: "20260720",
  stck_clpr: "70000",
  prdy_vrss: "-500",
  prdy_vrss_sign: "5",
  prsn_ntby_qty: "-120",
  frgn_ntby_qty: "80",
  orgn_ntby_qty: "40",
  prsn_ntby_tr_pbmn: "-8400000",
  frgn_ntby_tr_pbmn: "5600000",
  orgn_ntby_tr_pbmn: "2800000",
  prsn_shnu_vol: "1000",
  frgn_shnu_vol: "800",
  orgn_shnu_vol: "400",
  prsn_shnu_tr_pbmn: "70000000",
  frgn_shnu_tr_pbmn: "56000000",
  orgn_shnu_tr_pbmn: "28000000",
  prsn_seln_vol: "1120",
  frgn_seln_vol: "720",
  orgn_seln_vol: "360",
  prsn_seln_tr_pbmn: "78400000",
  frgn_seln_tr_pbmn: "50400000",
  orgn_seln_tr_pbmn: "25200000",
};

const programRow = {
  bsop_hour: "153000",
  stck_prpr: "70000",
  prdy_vrss: "-500",
  prdy_vrss_sign: "5",
  prdy_ctrt: "-0.71",
  acml_vol: "3000",
  whol_smtn_seln_vol: "1200",
  whol_smtn_shnu_vol: "1000",
  whol_smtn_ntby_qty: "-200",
  whol_smtn_seln_tr_pbmn: "84000000",
  whol_smtn_shnu_tr_pbmn: "70000000",
  whol_smtn_ntby_tr_pbmn: "-14000000",
  whol_ntby_vol_icdc: "-20",
  whol_ntby_tr_pbmn_icdc: "-1400000",
};

const marketRow = {
  frgn_seln_vol: "1000",
  frgn_shnu_vol: "900",
  frgn_ntby_qty: "-100",
  frgn_seln_tr_pbmn: "80000000",
  frgn_shnu_tr_pbmn: "72000000",
  frgn_ntby_tr_pbmn: "-8000000",
  prsn_seln_vol: "700",
  prsn_shnu_vol: "850",
  prsn_ntby_qty: "150",
  prsn_seln_tr_pbmn: "56000000",
  prsn_shnu_tr_pbmn: "68000000",
  prsn_ntby_tr_pbmn: "12000000",
  orgn_seln_vol: "500",
  orgn_shnu_vol: "450",
  orgn_ntby_qty: "-50",
  orgn_seln_tr_pbmn: "40000000",
  orgn_shnu_tr_pbmn: "36000000",
  orgn_ntby_tr_pbmn: "-4000000",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("KisDomesticInvestorFlowClient", () => {
  it("enforces prod data credentials at the client boundary", () => {
    expect(
      () =>
        new KisDomesticInvestorFlowClient({
          environment: "paper" as "prod",
          credentials,
          getAccessToken: async () => "token",
        }),
    ).toThrow("require prod data credentials");
  });

  it("normalizes completed stock investor rows without inventing zero values", async () => {
    const providerRow = {
      ...stockInvestorRow,
      prsn_shnu_vol: "001000",
      prsn_ntby_qty: "+0",
      prsn_seln_vol: "001000",
      prsn_shnu_tr_pbmn: "070000000",
      prsn_ntby_tr_pbmn: "+0",
      prsn_seln_tr_pbmn: "070000000",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown, init?: RequestInit) => {
        const url = new URL(String(input));
        expect(url.origin).toBe("https://openapi.koreainvestment.com:9443");
        expect(url.pathname).toBe(
          "/uapi/domestic-stock/v1/quotations/inquire-investor",
        );
        expect(url.searchParams.get("FID_COND_MRKT_DIV_CODE")).toBe("J");
        expect(url.searchParams.get("FID_INPUT_ISCD")).toBe("005930");
        expect(new Headers(init?.headers).get("tr_id")).toBe("FHKST01010900");
        return new Response(JSON.stringify({ rt_cd: "0", output: [providerRow] }));
      }),
    );

    const result = await client().getInvestorByStock("005930");
    expect(result).toMatchObject({
      instrumentId: "KRX:005930",
      venue: "KRX",
      fetchedAt: NOW.toISOString(),
      quality: "PROVIDER_REPORTED_AFTER_CLOSE",
    });
    expect(result.rows[0]).toMatchObject({
      businessDate: "20260720",
      individual: {
        buyQuantity: "1000",
        netBuyQuantity: "0",
        buyAmount: "70000000",
        netBuyAmount: "0",
      },
      foreign: { netBuyAmount: "5600000" },
      institution: { buyQuantity: "400" },
    });
  });

  it("keeps program-by-stock provider time and cumulative quality", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown, init?: RequestInit) => {
        const url = new URL(String(input));
        expect(url.pathname).toBe(
          "/uapi/domestic-stock/v1/quotations/program-trade-by-stock",
        );
        expect(url.searchParams.get("FID_COND_MRKT_DIV_CODE")).toBe("UN");
        expect(new Headers(init?.headers).get("tr_id")).toBe("FHPPG04650101");
        return new Response(JSON.stringify({ rt_cd: "0", output: [programRow] }));
      }),
    );

    const result = await client().getProgramByStock("005930", "UNIFIED");
    expect(result.quality).toBe("PROVIDER_REPORTED_FORMING_CUMULATIVE");
    expect(result.rows[0]).toMatchObject({
      providerTime: "153000",
      cumulativeVolume: "3000",
      program: { netBuyQuantity: "-200", netBuyAmount: "-14000000" },
      netBuyQuantityChange: "-20",
    });
  });

  it.each([
    ["KOSPI" as const, "KSP", "0001"],
    ["KOSDAQ" as const, "KSQ", "1001"],
  ])("uses the verified %s market and industry codes", async (market, marketCode, industryCode) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown, init?: RequestInit) => {
        const url = new URL(String(input));
        expect(url.pathname).toBe(
          "/uapi/domestic-stock/v1/quotations/inquire-investor-time-by-market",
        );
        expect(url.searchParams.get("FID_INPUT_ISCD")).toBe(marketCode);
        expect(url.searchParams.get("FID_INPUT_ISCD_2")).toBe(industryCode);
        expect(new Headers(init?.headers).get("tr_id")).toBe("FHPTJ04030000");
        return new Response(JSON.stringify({ rt_cd: "0", output: [marketRow] }));
      }),
    );

    const result = await client().getMarketInvestorTime(market);
    expect(result).toMatchObject({
      market,
      providerTimestamp: null,
      fetchedAt: NOW.toISOString(),
      quality: "PROVIDER_REPORTED_SNAPSHOT_FINALITY_UNKNOWN",
    });
    expect(result.rows[0]).toMatchObject({
      foreign: { netBuyQuantity: "-100" },
      individual: { netBuyQuantity: "150" },
      institution: { netBuyQuantity: "-50" },
    });
  });

  it("fails closed when a successful response omits a raw flow field", async () => {
    const malformed = { ...marketRow } as Partial<typeof marketRow>;
    delete malformed.orgn_ntby_tr_pbmn;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ rt_cd: "0", output: [malformed] })),
      ),
    );

    await expect(client().getMarketInvestorTime("KOSPI")).rejects.toMatchObject({
      code: "KIS_REST_SCHEMA_MISMATCH",
    });
  });
});
