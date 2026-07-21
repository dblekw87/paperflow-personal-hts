import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { KisUsRankingClient } from "../src/kis/us-ranking.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/kis/us-ranking.json", import.meta.url), "utf8"));
afterEach(() => vi.unstubAllGlobals());

describe("KisUsRankingClient", () => {
  it.each([
    ["TURNOVER", "/uapi/overseas-stock/v1/ranking/trade-pbmn", "HHDFS76320010"],
    ["AVERAGE_VOLUME", "/uapi/overseas-stock/v1/ranking/trade-vol", "HHDFS76310010"],
    ["VOLUME_INCREASE", "/uapi/overseas-stock/v1/ranking/trade-growth", "HHDFS76330000"],
    ["CHANGE_RATE_GAINERS", "/uapi/overseas-stock/v1/ranking/updown-rate", "HHDFS76290000"],
  ] as const)("maps %s through its official read-only endpoint", async (sort, path, trId) => {
    vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe(path);
      expect(url.searchParams.get("EXCD")).toBe("NAS");
      expect(new Headers(init?.headers).get("tr_id")).toBe(trId);
      return new Response(JSON.stringify(fixture));
    }));
    const items = await new KisUsRankingClient({
      credentials: { appKey: "key", appSecret: "secret" }, getAccessToken: async () => "token",
    }).getRanking("NAS", sort);
    expect(items[0]).toMatchObject({
      symbol: "AAPL", price: "211.2399", changeRate: "1.5039",
      cumulativeVolume: "57321001", volumeIncreaseRate: "19.1099",
      cumulativeTurnover: "12089123456.78",
    });
  });
});
