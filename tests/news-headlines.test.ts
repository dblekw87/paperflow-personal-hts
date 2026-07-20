import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { KisProdNewsClient } from "../src/kis/news-headlines.js";

function fixture(name: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(
      new URL(`./fixtures/kis/${name}`, import.meta.url),
      "utf8",
    ),
  ) as Record<string, unknown>;
}

const domesticFixture = fixture("domestic-news-headlines-prod.json");
const overseasFixture = fixture("overseas-news-headlines-prod.json");

afterEach(() => {
  vi.unstubAllGlobals();
});

function client(): KisProdNewsClient {
  return new KisProdNewsClient({
    credentials: { appKey: "prod-key", appSecret: "prod-secret" },
    getAccessToken: async () => "token",
  });
}

describe("KisProdNewsClient", () => {
  it("normalizes captured domestic headlines without inventing a URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown, init?: RequestInit) => {
        const url = new URL(String(input));
        expect(url.origin).toBe("https://openapi.koreainvestment.com:9443");
        expect(url.pathname).toBe(
          "/uapi/domestic-stock/v1/quotations/news-title",
        );
        expect(url.searchParams.get("FID_INPUT_ISCD")).toBe("005930");
        expect(new Headers(init?.headers).get("tr_id")).toBe(
          "FHKST01011800",
        );
        return new Response(JSON.stringify(domesticFixture));
      }),
    );

    const result = await client().getDomesticHeadlines({
      symbol: "005930",
    });
    expect(result.dataEnvironment).toBe("prod");
    expect(result.items[0]).toMatchObject({
      providerCode: "B",
      sourceName: "헤럴드경제",
      relatedSymbols: [],
      relatedNames: [],
      rights: {
        contentScope: "HEADLINE_ONLY",
        originalUrl: null,
      },
    });
  });

  it("normalizes captured overseas headlines and exposes continuation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown, init?: RequestInit) => {
        const url = new URL(String(input));
        expect(url.pathname).toBe(
          "/uapi/overseas-price/v1/quotations/news-title",
        );
        expect(url.searchParams.get("NATION_CD")).toBe("US");
        expect(new Headers(init?.headers).get("tr_id")).toBe(
          "HHPSTH60100C1",
        );
        return new Response(JSON.stringify(overseasFixture), {
          headers: { tr_cont: "F" },
        });
      }),
    );

    const result = await client().getOverseasHeadlines({
      nationCode: "US",
    });
    expect(result).toMatchObject({
      continuation: "F",
      paginationComplete: false,
    });
    expect(result.items[0]).toMatchObject({
      providerKey: "ICH796805",
      symbol: "META",
      rights: {
        contentScope: "HEADLINE_ONLY",
        originalUrl: null,
      },
    });
  });

  it("rejects business errors and changed response shapes", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              rt_cd: "1",
              msg_cd: "EGW00201",
              msg1: "rate limited",
            }),
          ),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ rt_cd: "0", outblock1: [{}] })),
        ),
    );

    await expect(client().getDomesticHeadlines()).rejects.toMatchObject({
      code: "EGW00201",
      retryable: true,
    });
    await expect(client().getOverseasHeadlines()).rejects.toMatchObject({
      code: "KIS_REST_SCHEMA_MISMATCH",
      retryable: false,
    });
  });
});
