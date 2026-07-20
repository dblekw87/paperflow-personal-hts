import { afterEach, describe, expect, it, vi } from "vitest";

import { KisApiError } from "../src/kis/errors.js";
import { getKisReadOnlyJson } from "../src/kis/readonly-rest.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getKisReadOnlyJson", () => {
  it("preserves authentication failures instead of relabeling them as network errors", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const authError = new KisApiError({
      code: "KIS_AUTH_FAILED",
      message: "authentication failed",
      retryable: false,
      status: 403,
    });

    await expect(
      getKisReadOnlyJson({
        url: new URL("https://example.invalid/read-only"),
        trId: "READONLY",
        credentials: { appKey: "key", appSecret: "secret" },
        getAccessToken: async () => {
          throw authError;
        },
        operation: "test",
      }),
    ).rejects.toBe(authError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("classifies transport and rate-limit failures with retryability", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValueOnce(new Response("{}", { status: 429 })),
    );
    const options = {
      url: new URL("https://example.invalid/read-only"),
      trId: "READONLY",
      credentials: { appKey: "key", appSecret: "secret" },
      getAccessToken: async () => "token",
      operation: "test",
    } as const;

    await expect(getKisReadOnlyJson(options)).rejects.toMatchObject({
      code: "KIS_NETWORK_ERROR",
      retryable: true,
    });
    await expect(getKisReadOnlyJson(options)).rejects.toMatchObject({
      code: "KIS_RATE_LIMITED",
      retryable: true,
      status: 429,
    });
  });
});
