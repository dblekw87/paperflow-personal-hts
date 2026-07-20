import { describe, expect, it } from "vitest";

import {
  CrossMarketSignalSnapshotSchema,
  LeadingSignalSchema,
  XyzInstrumentMappingSchema,
} from "../src/contracts/cross-market.js";
import {
  HYPERLIQUID_PUBLIC_INFO_URL,
  HYPERLIQUID_READ_ONLY_INFO_TYPES,
  HYPERLIQUID_READ_ONLY_SUBSCRIPTIONS,
  isReadOnlyHyperliquidInfoType,
  isReadOnlyHyperliquidSubscription,
} from "../src/hyperliquid/endpoints.js";

const hash = "a".repeat(64);

describe("Hyperliquid cross-market contracts", () => {
  it("keeps SKHX common stock and SKHY ADS mappings distinct", () => {
    expect(
      XyzInstrumentMappingSchema.parse({
        coin: "xyz:SKHX",
        canonicalUnderlying: "KRX:000660",
        unitKind: "COMMON_SHARE",
        unitDescription: "one common share",
        underlyingUnitRatio: "1",
        annotationHash: hash,
      }),
    ).toBeDefined();
    expect(
      XyzInstrumentMappingSchema.parse({
        coin: "xyz:SKHY",
        canonicalUnderlying: "NASDAQ:SKHY",
        unitKind: "ADS",
        unitDescription: "one ADS representing 0.1 common share",
        underlyingUnitRatio: "0.1",
        annotationHash: hash,
      }),
    ).toBeDefined();
    expect(() =>
      XyzInstrumentMappingSchema.parse({
        coin: "xyz:SKHY",
        canonicalUnderlying: "KRX:000660",
        unitKind: "COMMON_SHARE",
        unitDescription: "incorrectly merged",
        underlyingUnitRatio: "1",
        annotationHash: hash,
      }),
    ).toThrow();
  });

  it("labels a market snapshot as an onchain TradFi perp proxy", () => {
    const snapshot = CrossMarketSignalSnapshotSchema.parse({
      instrumentId: "XYZ:SMSN",
      provider: "HYPERLIQUID",
      venue: "XYZ_HIP3",
      coin: "xyz:SMSN",
      quality: "ONCHAIN_TRADFI_PERP_PROXY",
      session: "INTERNAL",
      markPx: "167.56",
      oraclePx: "167.80",
      midPx: "167.56",
      fundingHourly: "-0.0001",
      openInterest: "309048.456",
      openInterestNotionalUsd: "51810000",
      dayNotionalVolumeUsd: "5930000",
      receivedAt: "2026-07-20T05:08:00+09:00",
      metadataVersion: hash,
    });

    expect(snapshot.quality).not.toBe("LIVE");
    expect(() =>
      CrossMarketSignalSnapshotSchema.parse({
        ...snapshot,
        coin: "xyz:CL",
      }),
    ).toThrow(/coin and instrumentId/);
  });

  it("forces stale or excluded inputs to NO_SIGNAL", () => {
    expect(() =>
      LeadingSignalSchema.parse({
        instrumentId: "KRX:005930",
        direction: "BUYING_PRESSURE",
        confidence: "STRONG",
        session: "INTERNAL",
        liquidityTier: "EXCLUDED",
        evidenceIds: ["ctx-1"],
        warningCodes: ["STALE_CONTEXT"],
        cutoffAt: "2026-07-20T05:10:00+09:00",
      }),
    ).toThrow();
    expect(
      LeadingSignalSchema.parse({
        instrumentId: "KRX:005930",
        direction: "NO_SIGNAL",
        confidence: "NONE",
        session: "INTERNAL",
        liquidityTier: "EXCLUDED",
        evidenceIds: ["ctx-1"],
        warningCodes: ["STALE_CONTEXT"],
        cutoffAt: "2026-07-20T05:10:00+09:00",
      }).direction,
    ).toBe("NO_SIGNAL");
    expect(() =>
      LeadingSignalSchema.parse({
        instrumentId: "KRX:000660",
        direction: "BUYING_PRESSURE",
        confidence: "STRONG",
        session: "INTERNAL",
        liquidityTier: "STRONG",
        evidenceIds: ["ctx-2"],
        warningCodes: ["CROSS_MARKET_INCONSISTENCY"],
        cutoffAt: "2026-07-20T05:10:00+09:00",
      }),
    ).toThrow(/NO_SIGNAL/);
  });

  it("exposes only the documented public market-data allowlist", () => {
    expect(HYPERLIQUID_PUBLIC_INFO_URL).toBe(
      "https://api.hyperliquid.xyz/info",
    );
    expect(HYPERLIQUID_READ_ONLY_INFO_TYPES).toEqual([
      "perpDexs",
      "metaAndAssetCtxs",
      "perpAnnotation",
      "l2Book",
      "perpsAtOpenInterestCap",
      "fundingHistory",
      "candleSnapshot",
    ]);
    expect(HYPERLIQUID_READ_ONLY_SUBSCRIPTIONS).toEqual([
      "allMids",
      "allDexsAssetCtxs",
      "activeAssetCtx",
      "bbo",
      "l2Book",
      "trades",
      "candle",
    ]);
    expect(isReadOnlyHyperliquidInfoType("metaAndAssetCtxs")).toBe(true);
    expect(isReadOnlyHyperliquidInfoType("userFills")).toBe(false);
    expect(isReadOnlyHyperliquidSubscription("trades")).toBe(true);
    expect(isReadOnlyHyperliquidSubscription("orderUpdates")).toBe(false);
  });
});
