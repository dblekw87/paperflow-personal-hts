import { afterEach, describe, expect, it, vi } from "vitest";

import { KisRestClient } from "../src/kis/rest-client.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("KIS domestic current-price contract", () => {
  it("uses the exact read-only endpoint, headers and uppercase query keys", async () => {
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        expect(url.pathname).toBe(
          "/uapi/domestic-stock/v1/quotations/inquire-price",
        );
        expect(url.searchParams.get("FID_COND_MRKT_DIV_CODE")).toBe("J");
        expect(url.searchParams.get("FID_INPUT_ISCD")).toBe("005930");

        const headers = new Headers(init?.headers);
        expect(headers.get("tr_id")).toBe("FHKST01010100");
        expect(headers.get("authorization")).toBe("Bearer token");

        return jsonResponse({
          rt_cd: "0",
          msg_cd: "MCA00000",
          output: {
            stck_prpr: "80000",
            prdy_vrss: "1000",
            prdy_vrss_sign: "5",
            prdy_ctrt: "1.25",
            acml_vol: "100",
            acml_tr_pbmn: "8000000",
            stck_oprc: "79000",
            stck_hgpr: "81000",
            stck_lwpr: "78000",
          },
        });
      },
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const client = new KisRestClient({
      environment: "paper",
      credentials: {
        appKey: "a".repeat(20),
        appSecret: "s".repeat(20),
      },
      getAccessToken: async () => "token",
    });

    await expect(
      client.getDomesticCurrentPrice("005930"),
    ).resolves.toMatchObject({
      instrumentId: "KRX:005930",
      price: "80000",
      change: "-1000",
      changeRate: "-1.25",
      openPrice: "79000",
      highPrice: "81000",
      lowPrice: "78000",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("KIS domestic order-book snapshot contract", () => {
  it("loads the last ten-level KRX book through the read-only REST API", async () => {
    globalThis.fetch = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        expect(url.pathname).toBe(
          "/uapi/domestic-stock/v1/quotations/inquire-asking-price-exp-ccn",
        );
        expect(url.searchParams.get("FID_COND_MRKT_DIV_CODE")).toBe("J");
        expect(new Headers(init?.headers).get("tr_id")).toBe(
          "FHKST01010200",
        );
        const levels = Object.fromEntries(
          Array.from({ length: 10 }, (_, index) => {
            const level = index + 1;
            return [
              [`askp${level}`, String(80_000 + level * 100)],
              [`bidp${level}`, String(80_000 - level * 100)],
              [`askp_rsqn${level}`, String(level * 10)],
              [`bidp_rsqn${level}`, String(level * 20)],
            ];
          }).flat(),
        );
        return jsonResponse({
          rt_cd: "0",
          output1: {
            aspr_acpt_hour: "153000",
            ...levels,
            total_askp_rsqn: "550",
            total_bidp_rsqn: "1100",
          },
        });
      },
    ) as typeof fetch;

    const client = new KisRestClient({
      environment: "prod",
      credentials: {
        appKey: "a".repeat(20),
        appSecret: "s".repeat(20),
      },
      getAccessToken: async () => "token",
    });
    const result = await client.getDomesticOrderBook("005930");

    expect(result.asks).toHaveLength(10);
    expect(result.bids).toHaveLength(10);
    expect(result.asks[0]).toEqual({ price: "80100", quantity: "10" });
    expect(result.bids[9]).toEqual({ price: "79000", quantity: "200" });
    expect(result.providerTime).toBe("153000");
  });
});

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
