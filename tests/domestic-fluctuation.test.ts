import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { KisDomesticFluctuationClient } from "../src/kis/domestic-fluctuation.js";

const capturedProdResponse = JSON.parse(
  readFileSync(
    new URL(
      "./fixtures/kis/domestic-fluctuation-prod.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as Record<string, unknown>;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("KisDomesticFluctuationClient", () => {
  it("uses the official prod-only request and normalizes the captured response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown, init?: RequestInit) => {
        const url = new URL(String(input));
        expect(url.origin).toBe("https://openapi.koreainvestment.com:9443");
        expect(url.pathname).toBe(
          "/uapi/domestic-stock/v1/ranking/fluctuation",
        );
        expect(url.searchParams.get("fid_cond_scr_div_code")).toBe("20170");
        expect(url.searchParams.get("fid_input_iscd")).toBe("0000");
        expect(url.searchParams.get("fid_input_cnt_1")).toBe("30");
        expect(new Headers(init?.headers).get("tr_id")).toBe(
          "FHPST01700000",
        );
        return new Response(JSON.stringify(capturedProdResponse));
      }),
    );
    const result = await new KisDomesticFluctuationClient({
      credentials: { appKey: "prod-key", appSecret: "prod-secret" },
      getAccessToken: async () => "token",
    }).getRanking();

    expect(result).toMatchObject({
      dataEnvironment: "prod",
      source: "KIS_REST",
      paginationComplete: true,
    });
    expect(result.items[0]).toMatchObject({
      symbol: "376900",
      change: "13050",
      changeRate: "26.99",
      highPrice: "62000",
    });
  });

  it("keeps exact limit-up and limit-down boundaries inside a wider query range", async () => {
    const requests: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        requests.push(new URL(String(input)));
        return new Response(JSON.stringify(capturedProdResponse));
      }),
    );
    const client = new KisDomesticFluctuationClient({
      credentials: { appKey: "prod-key", appSecret: "prod-secret" },
      getAccessToken: async () => "token",
    });
    await client.getAllRanking({
      minimumRate: "0.01",
      maximumRate: "100",
    });
    expect(requests[0]?.searchParams.get("fid_rsfl_rate1")).toBe("0.01");
    expect(requests[0]?.searchParams.get("fid_rsfl_rate2")).toBe("100");
  });

  it("accumulates continuation pages without duplicating symbols", async () => {
    const template = (
      capturedProdResponse.output as Array<Record<string, string>>
    )[0]!;
    let requestCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: unknown, init?: RequestInit) => {
        requestCount += 1;
        if (requestCount === 2) {
          expect(new Headers(init?.headers).get("tr_cont")).toBe("N");
        }
        return new Response(
          JSON.stringify({
            rt_cd: "0",
            output: [
              {
                ...template,
                stck_shrn_iscd:
                  requestCount === 1 ? "111111" : "222222",
                data_rank: String(requestCount),
              },
            ],
          }),
          requestCount === 1 ? { headers: { tr_cont: "M" } } : {},
        );
      }),
    );
    const result = await new KisDomesticFluctuationClient({
      credentials: { appKey: "prod-key", appSecret: "prod-secret" },
      getAccessToken: async () => "token",
    }).getAllRanking({ maxPages: 3 });

    expect(result.items.map((item) => item.symbol)).toEqual([
      "111111",
      "222222",
    ]);
    expect(result.paginationComplete).toBe(true);
  });

  it("fails closed on an unknown provider shape", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ rt_cd: "0", output: [{}] })),
      ),
    );
    await expect(
      new KisDomesticFluctuationClient({
        credentials: { appKey: "prod-key", appSecret: "prod-secret" },
        getAccessToken: async () => "token",
      }).getRanking(),
    ).rejects.toMatchObject({ code: "KIS_REST_SCHEMA_MISMATCH" });
  });
});
