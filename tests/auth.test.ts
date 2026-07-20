import { afterEach, describe, expect, it, vi } from "vitest";

import { KisAuthClient } from "../src/kis/auth.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("KIS authentication contracts", () => {
  it("single-flights access token requests and uses appsecret", async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) => {
        expect(JSON.parse(String(init?.body))).toEqual({
          grant_type: "client_credentials",
          appkey: "a".repeat(20),
          appsecret: "s".repeat(20),
        });
        return jsonResponse({ access_token: "token", expires_in: 86400 });
      },
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const auth = new KisAuthClient("paper", {
      appKey: "a".repeat(20),
      appSecret: "s".repeat(20),
    });

    await Promise.all([auth.getAccessToken(), auth.getAccessToken()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses secretkey for WebSocket approval instead of appsecret", async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as Record<string, string>;
        expect(body.secretkey).toBe("s".repeat(20));
        expect(body.appsecret).toBeUndefined();
        return jsonResponse({ approval_key: "approval" });
      },
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const auth = new KisAuthClient("prod", {
      appKey: "a".repeat(20),
      appSecret: "s".repeat(20),
    });

    expect(await auth.getApprovalKey()).toBe("approval");
  });
});

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
