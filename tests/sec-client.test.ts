import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import {
  findSecIssuerMappings,
  SecEdgarClient,
  SecProviderError,
  SecRateLimiter,
} from "../src/disclosures/sec-client.js";

const TICKER_FIXTURE = readFileSync(
  fileURLToPath(
    new URL("./fixtures/sec/company-tickers-exchange.json", import.meta.url),
  ),
  "utf8",
);
const SUBMISSIONS_FIXTURE = readFileSync(
  fileURLToPath(
    new URL("./fixtures/sec/submissions.json", import.meta.url),
  ),
  "utf8",
);
const TEST_IDENTITY = {
  userAgent: "PaperTradingHTS/0.0.1 sec-adapter@unit.test",
};

describe("SEC EDGAR read-only client", () => {
  it("normalizes the official ticker/CIK association shape", async () => {
    let observedUserAgent: string | null = null;
    const fetchImplementation = vi.fn(
      async (_input: unknown, init?: RequestInit) => {
        observedUserAgent = new Headers(init?.headers).get("user-agent");
        return new Response(TICKER_FIXTURE, {
          headers: { "content-type": "application/json" },
        });
      },
    ) as typeof fetch;
    const client = new SecEdgarClient({
      identity: TEST_IDENTITY,
      fetchImplementation,
      now: () => Date.parse("2026-07-20T00:00:00.000Z"),
    });

    const snapshot = await client.listTickerMappings();

    expect(observedUserAgent).toBe(TEST_IDENTITY.userAgent);
    expect(snapshot.items[0]).toEqual({
      provider: "SEC_EDGAR",
      providerIssuerId: "0000123456",
      issuerName: "EXAMPLE INDUSTRIES, INC.",
      ticker: "EXM",
      exchange: "Nasdaq",
    });
    expect(findSecIssuerMappings(snapshot, "exm", "NASDAQ")).toHaveLength(1);
    expect(snapshot.sourceUrl).toBe(
      "https://www.sec.gov/files/company_tickers_exchange.json",
    );
  });

  it("normalizes recent submissions without losing accession identity", async () => {
    const client = new SecEdgarClient({
      identity: TEST_IDENTITY,
      fetchImplementation: vi.fn(async () =>
        new Response(SUBMISSIONS_FIXTURE),
      ) as typeof fetch,
      now: () => Date.parse("2026-07-20T14:06:00.000Z"),
    });

    const snapshot = await client.getRecentFilings("0000123456");

    expect(snapshot.providerIssuerId).toBe("0000123456");
    expect(snapshot.sourceUrl).toBe(
      "https://data.sec.gov/submissions/CIK0000123456.json",
    );
    expect(snapshot.items).toHaveLength(2);
    expect(snapshot.items[0]).toMatchObject({
      provider: "SEC_EDGAR",
      providerFilingId: "0000123456-26-000002",
      dedupeKey: "SEC_EDGAR:0000123456-26-000002",
      providerIssuerId: "0000123456",
      formType: "8-K/A",
      isAmendment: true,
      acceptedAt: "2026-07-20T14:05:06.000Z",
      acceptedAtPrecision: "INSTANT",
      itemNumbers: ["1.01", "9.01"],
      filingIndexUrl:
        "https://www.sec.gov/Archives/edgar/data/123456/000012345626000002/0000123456-26-000002-index.html",
    });
    expect(snapshot.items[1]?.reportDate).toBeNull();
    expect(
      new Set(snapshot.items.map((item) => item.dedupeKey)).size,
    ).toBe(snapshot.items.length);
  });

  it("does not permit a limiter configuration above SEC's 10 rps ceiling", () => {
    expect(
      () => new SecRateLimiter({ requestsPerSecond: 11 }),
    ).toThrow("SEC_RATE_LIMIT_MUST_BE_BETWEEN_1_AND_10");
  });

  it("serializes concurrent requests at no more than 10 per second", async () => {
    let now = 0;
    const starts: number[] = [];
    const limiter = new SecRateLimiter({
      requestsPerSecond: 10,
      now: () => now,
      sleep: async (milliseconds) => {
        now += milliseconds;
      },
    });

    await Promise.all(
      Array.from({ length: 12 }, () =>
        limiter.schedule(async () => {
          starts.push(now);
        }),
      ),
    );

    expect(starts).toEqual([
      0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1_000, 1_100,
    ]);
  });

  it("honors Retry-After before retrying a rate-limited request", async () => {
    let now = 0;
    const sleeps: number[] = [];
    const sleep = async (milliseconds: number) => {
      sleeps.push(milliseconds);
      now += milliseconds;
    };
    const fetchImplementation = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("", {
          status: 429,
          headers: { "retry-after": "1" },
        }),
      )
      .mockResolvedValueOnce(new Response(TICKER_FIXTURE)) as typeof fetch;
    const client = new SecEdgarClient({
      identity: TEST_IDENTITY,
      fetchImplementation,
      limiter: new SecRateLimiter({
        requestsPerSecond: 10,
        now: () => now,
        sleep,
      }),
      now: () => now,
      sleep,
      random: () => 0,
    });

    await expect(client.listTickerMappings()).resolves.toMatchObject({
      items: expect.any(Array),
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([1_000]);
  });

  it("does not retain a raw network cause, URL query, or contact identity", async () => {
    const fetchImplementation = vi.fn(async (input: unknown) => {
      throw new Error(
        `transport failure ${String(input)} ${TEST_IDENTITY.userAgent}`,
      );
    }) as typeof fetch;
    const client = new SecEdgarClient({
      identity: TEST_IDENTITY,
      fetchImplementation,
      maxAttempts: 1,
    });

    const caught = await client.listTickerMappings().catch((error) => error);

    expect(caught).toBeInstanceOf(SecProviderError);
    const providerError = caught as SecProviderError;
    expect(providerError.cause).toBeUndefined();
    expect(providerError.message).toBe(
      "SEC_NETWORK_ERROR https://www.sec.gov/files/company_tickers_exchange.json",
    );
    const serialized = JSON.stringify({
      message: providerError.message,
      stack: providerError.stack,
      code: providerError.code,
      safeUrl: providerError.safeUrl,
      cause: providerError.cause,
    });
    expect(serialized).not.toContain(TEST_IDENTITY.userAgent);
    expect(serialized).not.toContain("unit.test");
    expect(serialized).not.toContain("?");
  });
});
