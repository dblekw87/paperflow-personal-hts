import { afterEach, describe, expect, it, vi } from "vitest";

import {
  KrxOpenApiClient,
  KrxOpenApiError,
} from "../src/krx/openapi-client.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("KrxOpenApiClient", () => {
  it("passes the KRX auth key only through the AUTH_KEY header", async () => {
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/svc/apis/sto/stk_bydd_trd");
      expect(url.searchParams.get("basDd")).toBe("20260721");
      expect(url.search).not.toContain("secret-auth-key");
      expect(new Headers(init?.headers).get("AUTH_KEY")).toBe(
        "secret-auth-key-1234567890",
      );
      return new Response(
        JSON.stringify({
          OutBlock_1: [{ ISU_CD: "005930", ISU_NM: "삼성전자" }],
        }),
      );
    });
    const client = new KrxOpenApiClient({
      credentials: { authKey: "secret-auth-key-1234567890" },
      fetch: fetchMock as typeof fetch,
    });

    const result = await client.get(
      "/sto/stk_bydd_trd",
      new URLSearchParams({ basDd: "20260721" }),
    );

    expect(result.OutBlock_1?.[0]).toMatchObject({ ISU_CD: "005930" });
  });

  it("redacts long provider tokens from error messages", async () => {
    const client = new KrxOpenApiClient({
      credentials: { authKey: "secret-auth-key-1234567890" },
      fetch: vi.fn(async () =>
        new Response("token abcdefghijklmnopqrstuvwxyz1234567890 leaked", {
          status: 401,
        }),
      ) as typeof fetch,
    });

    await expect(
      client.get("/sto/stk_bydd_trd", new URLSearchParams({ basDd: "20260721" })),
    ).rejects.toMatchObject({
      code: "KRX_OPENAPI_HTTP_ERROR",
      retryable: false,
      status: 401,
    } satisfies Partial<KrxOpenApiError>);
    await expect(
      client.get("/sto/stk_bydd_trd", new URLSearchParams({ basDd: "20260721" })),
    ).rejects.not.toThrow("abcdefghijklmnopqrstuvwxyz1234567890");
  });

  it("turns provider timeouts into retryable KRX errors", async () => {
    const client = new KrxOpenApiClient({
      credentials: { authKey: "secret-auth-key-1234567890" },
      fetch: vi.fn(async () => {
        throw new DOMException("timeout", "TimeoutError");
      }) as typeof fetch,
    });

    await expect(
      client.get("/sto/stk_bydd_trd", new URLSearchParams({ basDd: "20260721" })),
    ).rejects.toMatchObject({
      code: "KRX_OPENAPI_NETWORK_ERROR",
      retryable: true,
      status: null,
    });
  });
});
