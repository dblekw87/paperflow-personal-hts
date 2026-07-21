import { describe, expect, it, vi } from "vitest";

import { KrxStatDownloadClient } from "../src/krx/stat-download-client.js";

describe("KrxStatDownloadClient", () => {
  it("generates an OTP and posts it to the KRX CSV download endpoint", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async (input: unknown, init?: RequestInit) => {
        const url = new URL(String(input));
        expect(url.pathname).toBe("/comm/fileDn/GenerateOTP/generate.cmd");
        expect(init?.method).toBe("POST");
        expect(String(init?.body)).toContain(
          "url=dbms%2FMDC%2FSTAT%2Fstandard%2FMDCSTAT02301",
        );
        return new Response("otp-code-123", {
          headers: { "content-type": "text/html; charset=UTF-8" },
        });
      })
      .mockImplementationOnce(async (input: unknown, init?: RequestInit) => {
        const url = new URL(String(input));
        expect(url.pathname).toBe("/comm/fileDn/download_csv/download.cmd");
        expect(init?.method).toBe("POST");
        expect(String(init?.body)).toBe("code=otp-code-123");
        return new Response("투자자구분,매도\n개인,1", {
          headers: { "content-type": "text/csv; charset=UTF-8" },
        });
      });

    const client = new KrxStatDownloadClient({
      fetch: fetchMock as unknown as typeof fetch,
    });

    await expect(
      client.downloadCsvByParams(
        new URLSearchParams({
          name: "fileDown",
          url: "dbms/MDC/STAT/standard/MDCSTAT02301",
        }),
      ),
    ).resolves.toContain("개인");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails closed when KRX returns an HTML page instead of an OTP", async () => {
    const client = new KrxStatDownloadClient({
      fetch: vi.fn(async () => new Response("<html>blocked</html>")) as unknown as typeof fetch,
    });

    await expect(
      client.downloadCsvByParams(new URLSearchParams({ name: "fileDown" })),
    ).rejects.toMatchObject({
      code: "KRX_STAT_INVALID_OTP",
    });
  });
});
