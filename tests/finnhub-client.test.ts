import { describe, expect, it, vi } from "vitest";

import { FinnhubNewsClient } from "../src/news/finnhub-client.js";

describe("FinnhubNewsClient", () => {
  it("loads selected-company news and maps provider data", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      expect(url.origin).toBe("https://finnhub.io");
      expect(url.pathname).toBe("/api/v1/company-news");
      expect(url.searchParams.get("symbol")).toBe("AAPL");
      expect(url.searchParams.get("from")).toBe("2026-07-18");
      expect(url.searchParams.get("to")).toBe("2026-07-21");
      expect(url.searchParams.get("token")).toBe("test-key-123");
      return new Response(JSON.stringify([{
        id: 42,
        category: "company",
        datetime: 1_753_075_800,
        headline: "Apple sample headline",
        related: "AAPL,MSFT",
        source: "Example Wire",
        summary: "A provider summary.",
        url: "https://example.com/apple-news",
      }]), { status: 200, headers: { "content-type": "application/json" } });
    });
    const client = new FinnhubNewsClient({ apiKey: "test-key-123", fetchImpl });

    const items = await client.getCompanyNews("AAPL", new Date("2026-07-21T12:00:00.000Z"));

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      providerItemId: "42",
      title: "Apple sample headline",
      summary: "A provider summary.",
      sourceName: "Example Wire",
      canonicalUrl: "https://example.com/apple-news",
      relatedTickers: ["AAPL", "MSFT"],
    });
  });

  it("rejects invalid symbols before making a request", async () => {
    const fetchImpl = vi.fn();
    const client = new FinnhubNewsClient({ apiKey: "test-key-123", fetchImpl });
    await expect(client.getCompanyNews("AAPL&token=leak")).rejects.toThrow("FINNHUB_INVALID_SYMBOL");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
