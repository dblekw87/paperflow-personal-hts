import { describe, expect, it } from "vitest";

import { KIS_TR } from "../src/kis/endpoints.js";
import {
  describeFreeMarketContextProxy,
  FREE_MARKET_CONTEXT_PROXIES,
  freeMarketContextProxyProbeSubscriptions,
} from "../src/kis/proxy-market-data.js";

describe("free market-context proxy data", () => {
  it("uses KIS master-verified QQQ, IWM and USO exchange codes", () => {
    expect(FREE_MARKET_CONTEXT_PROXIES.nasdaq).toMatchObject({
      exchange: "NAS",
      symbol: "QQQ",
      quality: "PROXY_LIVE",
    });
    expect(FREE_MARKET_CONTEXT_PROXIES.russell).toMatchObject({
      exchange: "AMS",
      symbol: "IWM",
      instrumentId: "NYSEARCA:IWM",
      quality: "PROXY_LIVE",
    });
    expect(FREE_MARKET_CONTEXT_PROXIES.oil).toMatchObject({
      exchange: "AMS",
      symbol: "USO",
      instrumentId: "NYSEARCA:USO",
      quality: "PROXY_LIVE",
    });
    expect(describeFreeMarketContextProxy("nasdaq").trKey).toBe("DNASQQQ");
    expect(describeFreeMarketContextProxy("russell").trKey).toBe("DAMSIWM");
    expect(describeFreeMarketContextProxy("oil").trKey).toBe("DAMSUSO");
  });

  it("subscribes only to the existing read-only US equity channels", () => {
    const subscriptions = freeMarketContextProxyProbeSubscriptions();
    expect(subscriptions).toHaveLength(6);
    expect(new Set(subscriptions.map((item) => item.trId))).toEqual(
      new Set([KIS_TR.usOrderBook, KIS_TR.usTrade]),
    );
    expect(subscriptions.map((item) => item.trKey)).toEqual([
      "DNASQQQ",
      "DNASQQQ",
      "DAMSIWM",
      "DAMSIWM",
      "DAMSUSO",
      "DAMSUSO",
    ]);
    expect(subscriptions.map((item) => item.canonicalVenue)).toEqual([
      "NASDAQ",
      "NASDAQ",
      "NYSEARCA",
      "NYSEARCA",
      "NYSEARCA",
      "NYSEARCA",
    ]);
  });

  it("never labels an ETF proxy as actual CME futures data", () => {
    for (const key of ["nasdaq", "russell", "oil"] as const) {
      const proxy = describeFreeMarketContextProxy(key);
      expect(proxy.quality).toBe("PROXY_LIVE");
      expect(proxy.provider).toBe("KIS_US_EQUITY");
      expect(proxy.purpose).toMatch(/_(FUTURES_)?DIRECTION$/);
    }
  });

  it("rejects an unverified symbol override that would mislabel the proxy", () => {
    expect(() =>
      describeFreeMarketContextProxy("oil", {
        exchange: "NAS",
        symbol: "AAPL",
      }),
    ).toThrow(/Unsupported oil proxy override/);
  });
});
