import { describe, expect, it } from "vitest";

import {
  isDesktopMarketContextProjection,
  type DesktopMarketContextProjection,
} from "../apps/desktop/src/shared/desktop-contracts.js";
import {
  normalizeDomesticIndexResponse,
  normalizeUsMarketProxyResponse,
} from "../src/kis/market-context.js";

describe("KIS market-context adapters", () => {
  it("normalizes a domestic official index without losing decimal scale", () => {
    expect(
      normalizeDomesticIndexResponse(
        {
          rt_cd: "0",
          output: {
            bstp_nmix_prpr: "2847.31",
            bstp_nmix_prdy_vrss: "18.42",
            prdy_vrss_sign: "2",
            bstp_nmix_prdy_ctrt: "0.65",
            acml_vol: "123456",
          },
        },
        "KRX:KOSPI",
        "2026-07-21T00:00:00.000Z",
      ),
    ).toEqual({
      instrumentId: "KRX:KOSPI",
      price: "2847.31",
      change: "18.42",
      changeRate: "0.65",
      currency: "KRW",
      receivedAt: "2026-07-21T00:00:00.000Z",
    });
  });

  it("applies the provider sign to an overseas ETF proxy", () => {
    expect(
      normalizeUsMarketProxyResponse(
        {
          rt_cd: "0",
          output: {
            rsym: "DAMSSPY",
            last: "601.2400",
            sign: "5",
            diff: "2.1300",
            rate: "0.35",
            tvol: "12345",
          },
        },
        "NYSEARCA:SPY",
        "2026-07-21T00:00:00.000Z",
        "DAMSSPY",
      ),
    ).toMatchObject({
      instrumentId: "NYSEARCA:SPY",
      price: "601.2400",
      change: "-2.1300",
      changeRate: "-0.35",
      currency: "USD",
    });
  });

  it("rejects malformed or incomplete provider payloads", () => {
    expect(() =>
      normalizeDomesticIndexResponse(
        {
          rt_cd: "0",
          output: {
            bstp_nmix_prpr: "",
          },
        },
        "KRX:KOSPI",
        "2026-07-21T00:00:00.000Z",
      ),
    ).toThrow(/expected contract/);
  });
});

function validProjection(): DesktopMarketContextProjection {
  return {
    schemaVersion: 1,
    state: "PARTIAL",
    fetchedAt: "2026-07-21T00:00:01.000Z",
    statusMessage: "일부 준비",
    items: [
      {
        id: "nasdaq-proxy",
        label: "NASDAQ 방향",
        instrumentId: "NASDAQ:QQQ",
        assetClass: "ETF_PROXY",
        representation: "ETF_PROXY",
        canonicalVenue: "NASDAQ",
        currency: "USD",
        tradable: false,
        price: "550.25",
        change: "1.20",
        changeRate: "0.22",
        transport: "REST_POLLING",
        dataQuality: "PROXY_SNAPSHOT",
        entitlement: "AUTHORIZED",
        freshness: "DELAYED_OR_POLLING",
        session: "UNKNOWN",
        provider: "KIS",
        occurredAt: null,
        receivedAt: "2026-07-21T00:00:00.000Z",
        proxyDisclosure: "QQQ ETF이며 NQ 선물이 아님",
        statusMessage: "KIS REST",
      },
    ],
  };
}

describe("desktop market-context boundary", () => {
  it("accepts a polling ETF proxy with mandatory disclosure", () => {
    expect(isDesktopMarketContextProjection(validProjection())).toBe(true);
  });

  it("rejects a proxy presented as an official index", () => {
    const projection = validProjection();
    const unsafe = {
      ...projection,
      items: [
        {
          ...projection.items[0],
          representation: "OFFICIAL_INDEX",
          proxyDisclosure: null,
        },
      ],
    };
    expect(isDesktopMarketContextProjection(unsafe)).toBe(false);
  });

  it("rejects unavailable synthetic zeroes and provider market-code venues", () => {
    const projection = validProjection();
    const unsafe = {
      ...projection,
      items: [
        {
          ...projection.items[0],
          canonicalVenue: "AMS",
          price: "0",
          freshness: "UNAVAILABLE",
          receivedAt: null,
        },
      ],
    };
    expect(isDesktopMarketContextProjection(unsafe)).toBe(false);
  });
});
