import { z } from "zod";

import {
  DecimalStringSchema,
  InstrumentIdSchema,
  UtcInstantSchema,
} from "./scalars.js";

export const XyzCoinSchema = z.enum([
  "xyz:SMSN",
  "xyz:SKHX",
  "xyz:SKHY",
  "xyz:HYUNDAI",
  "xyz:KR200",
  "xyz:EWY",
  "xyz:CL",
  "xyz:BRENTOIL",
]);

const XYZ_MAPPING_CONTRACT = {
  "xyz:SMSN": {
    canonicalUnderlying: "KRX:005930",
    unitKind: "COMMON_SHARE",
    underlyingUnitRatio: "1",
    proxyInstrumentId: "XYZ:SMSN",
  },
  "xyz:SKHX": {
    canonicalUnderlying: "KRX:000660",
    unitKind: "COMMON_SHARE",
    underlyingUnitRatio: "1",
    proxyInstrumentId: "XYZ:SKHX",
  },
  "xyz:SKHY": {
    canonicalUnderlying: "NASDAQ:SKHY",
    unitKind: "ADS",
    underlyingUnitRatio: "0.1",
    proxyInstrumentId: "XYZ:SKHY",
  },
  "xyz:HYUNDAI": {
    canonicalUnderlying: "KRX:005380",
    unitKind: "COMMON_SHARE",
    underlyingUnitRatio: "1",
    proxyInstrumentId: "XYZ:HYUNDAI",
  },
  "xyz:KR200": {
    canonicalUnderlying: "INDEX:KR200",
    unitKind: "INDEX_LEVEL",
    underlyingUnitRatio: "1",
    proxyInstrumentId: "XYZ:KR200",
  },
  "xyz:EWY": {
    canonicalUnderlying: "NYSEARCA:EWY",
    unitKind: "ETF_SHARE",
    underlyingUnitRatio: "1",
    proxyInstrumentId: "XYZ:EWY",
  },
  "xyz:CL": {
    canonicalUnderlying: "XYZREF:WTI",
    unitKind: "BARREL_PRICE",
    underlyingUnitRatio: "1",
    proxyInstrumentId: "XYZ:CL",
  },
  "xyz:BRENTOIL": {
    canonicalUnderlying: "XYZREF:BRENT",
    unitKind: "BARREL_PRICE",
    underlyingUnitRatio: "1",
    proxyInstrumentId: "XYZ:BRENTOIL",
  },
} as const;

export const XyzInstrumentMappingSchema = z
  .object({
    coin: XyzCoinSchema,
    canonicalUnderlying: InstrumentIdSchema,
    unitKind: z.enum([
      "COMMON_SHARE",
      "ADS",
      "INDEX_LEVEL",
      "ETF_SHARE",
      "BARREL_PRICE",
    ]),
    unitDescription: z.string().min(1),
    underlyingUnitRatio: DecimalStringSchema,
    annotationHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .superRefine((mapping, context) => {
    const expected = XYZ_MAPPING_CONTRACT[mapping.coin];
    if (
      mapping.canonicalUnderlying !== expected.canonicalUnderlying ||
      mapping.unitKind !== expected.unitKind ||
      mapping.underlyingUnitRatio !== expected.underlyingUnitRatio
    ) {
      context.addIssue({
        code: "custom",
        message: `${mapping.coin} mapping does not match the verified contract`,
      });
    }
  });

export const CrossMarketSignalSnapshotSchema = z
  .object({
    instrumentId: InstrumentIdSchema,
    provider: z.literal("HYPERLIQUID"),
    venue: z.literal("XYZ_HIP3"),
    coin: XyzCoinSchema,
    quality: z.literal("ONCHAIN_TRADFI_PERP_PROXY"),
    session: z.enum(["EXTERNAL", "INTERNAL"]),
    markPx: DecimalStringSchema,
    oraclePx: DecimalStringSchema,
    midPx: DecimalStringSchema.optional(),
    fundingHourly: DecimalStringSchema,
    openInterest: DecimalStringSchema,
    openInterestNotionalUsd: DecimalStringSchema,
    dayNotionalVolumeUsd: DecimalStringSchema,
    receivedAt: UtcInstantSchema,
    metadataVersion: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .superRefine((snapshot, context) => {
    if (
      snapshot.instrumentId !==
      XYZ_MAPPING_CONTRACT[snapshot.coin].proxyInstrumentId
    ) {
      context.addIssue({
        code: "custom",
        message: "Snapshot coin and instrumentId do not match",
      });
    }
  });

export const LeadingSignalSchema = z
  .object({
    instrumentId: InstrumentIdSchema,
    direction: z.enum(["BUYING_PRESSURE", "SELLING_PRESSURE", "NO_SIGNAL"]),
    confidence: z.enum(["STRONG", "WEAK", "NONE"]),
    session: z.enum(["EXTERNAL", "INTERNAL"]),
    liquidityTier: z.enum(["STRONG", "WEAK", "EXCLUDED"]),
    basisBps: DecimalStringSchema.optional(),
    gapBps: DecimalStringSchema.optional(),
    evidenceIds: z.array(z.string().min(1)).min(1),
    warningCodes: z.array(
      z.enum([
        "CROSS_MARKET_INCONSISTENCY",
        "INTERNAL_SESSION_LOW_QUALITY",
        "INSUFFICIENT_LIQUIDITY",
        "STALE_CONTEXT",
        "STALE_BOOK",
        "UNVERIFIED_INSTRUMENT",
        "OI_CAP_REACHED",
      ]),
    ),
    cutoffAt: UtcInstantSchema,
  })
  .superRefine((signal, context) => {
    const hasBlockingWarning = signal.warningCodes.some((warning) =>
      [
        "CROSS_MARKET_INCONSISTENCY",
        "STALE_CONTEXT",
        "UNVERIFIED_INSTRUMENT",
        "OI_CAP_REACHED",
      ].includes(warning),
    );
    if (
      (signal.liquidityTier === "EXCLUDED" || hasBlockingWarning) &&
      signal.direction !== "NO_SIGNAL"
    ) {
      context.addIssue({
        code: "custom",
        message: "Excluded or stale inputs must produce NO_SIGNAL",
      });
    }
    if (signal.direction === "NO_SIGNAL" && signal.confidence !== "NONE") {
      context.addIssue({
        code: "custom",
        message: "NO_SIGNAL must use NONE confidence",
      });
    }
  });

export type CrossMarketSignalSnapshot = z.infer<
  typeof CrossMarketSignalSnapshotSchema
>;
export type LeadingSignal = z.infer<typeof LeadingSignalSchema>;
