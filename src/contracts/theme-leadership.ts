import { z } from "zod";

import {
  DecimalStringSchema,
  InstrumentIdSchema,
  UtcInstantSchema,
} from "./scalars.js";

function ratioParts(
  value: string,
): { numerator: bigint; denominator: bigint } | null {
  const match = /^\+?(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return null;
  const integer = match[1] ?? "0";
  const places = match[2] ?? "";
  return {
    numerator: BigInt(`${integer}${places}`),
    denominator: 10n ** BigInt(places.length),
  };
}

function compareParts(
  left: { numerator: bigint; denominator: bigint },
  right: { numerator: bigint; denominator: bigint },
): number {
  const difference =
    left.numerator * right.denominator - right.numerator * left.denominator;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

function addParts(
  left: { numerator: bigint; denominator: bigint },
  right: { numerator: bigint; denominator: bigint },
): { numerator: bigint; denominator: bigint } {
  return {
    numerator:
      left.numerator * right.denominator + right.numerator * left.denominator,
    denominator: left.denominator * right.denominator,
  };
}

function dateInKorea(instant: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(instant));
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

const RatioDecimalSchema = DecimalStringSchema.refine((value) => {
  const parts = ratioParts(value);
  return parts !== null && parts.numerator <= parts.denominator;
}, "Expected a decimal ratio between 0 and 1");

const NonNegativeDecimalSchema = DecimalStringSchema.refine(
  (value) => !value.startsWith("-"),
  "Expected a non-negative decimal string",
);

const PercentDecimalSchema = NonNegativeDecimalSchema.refine((value) => {
  const parts = ratioParts(value);
  return (
    parts !== null &&
    compareParts(parts, { numerator: 100n, denominator: 1n }) <= 0
  );
}, "Expected a percentage between 0 and 100");

export const ThemeTaxonomyNodeSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/),
  labelKo: z.string().min(1),
  kind: z.enum(["INDUSTRY", "THEME", "SUBTHEME"]),
  parentId: z.string().min(1).nullable(),
});

export const ThemeMappingEvidenceSchema = z.object({
  id: z.string().min(1),
  source: z.enum([
    "OPEN_DART_BUSINESS_REPORT",
    "OPEN_DART_COMPANY_PROFILE",
    "KRX_INDUSTRY",
    "KRX_KIND",
    "ISSUER_IR",
  ]),
  sourceDocumentId: z.string().min(1),
  canonicalUrl: z.string().url(),
  asOf: UtcInstantSchema,
});

export const InstrumentThemeMappingSchema = z
  .object({
    instrumentId: InstrumentIdSchema,
    nodeId: z.string().min(1),
    allocationWeight: RatioDecimalSchema.refine((value) => {
      const parts = ratioParts(value);
      return parts !== null && parts.numerator > 0n;
    }, "Allocation weight must be greater than zero"),
    confidence: RatioDecimalSchema,
    asOf: UtcInstantSchema,
    validFrom: UtcInstantSchema,
    validTo: UtcInstantSchema.nullable(),
    evidence: z.array(ThemeMappingEvidenceSchema).min(1),
  })
  .superRefine((mapping, context) => {
    if (
      mapping.validTo !== null &&
      Date.parse(mapping.validTo) <= Date.parse(mapping.validFrom)
    ) {
      context.addIssue({
        code: "custom",
        path: ["validTo"],
        message: "validTo must be later than validFrom",
      });
    }
  });

export const ThemeInstrumentSchema = z.object({
  instrumentId: InstrumentIdSchema,
  symbol: z.string().min(1),
  nameKo: z.string().min(1),
  venue: z.enum(["KOSPI", "KOSDAQ"]),
  securityType: z.enum(["COMMON", "PREFERRED", "ETF", "SPAC", "REIT", "OTHER"]),
  isLargeCap: z.boolean(),
});

export const ThemeTurnoverSnapshotSchema = z.object({
  instrumentId: InstrumentIdSchema,
  sessionDate: z.string().date(),
  observedAt: UtcInstantSchema,
  elapsedMinutes: z.number().int().nonnegative(),
  baselineElapsedMinutes: z.number().int().nonnegative(),
  cumulativeTurnoverKrw: NonNegativeDecimalSchema,
  median20TurnoverKrwSameElapsed: NonNegativeDecimalSchema.nullable(),
  changePct: DecimalStringSchema,
  dataQuality: z.enum(["LIVE", "DELAYED", "STALE", "MISSING"]),
  source: z.literal("KIS_CANONICAL_MARKET_DATA"),
});

export const ThemeLeadershipInputSchema = z
  .object({
    asOf: UtcInstantSchema,
    sessionDate: z.string().date(),
    staleAfterSeconds: z.number().int().positive(),
    marketTurnoverKrw: NonNegativeDecimalSchema,
    marketTurnoverObservedAt: UtcInstantSchema,
    marketDataQuality: z.enum(["LIVE", "DELAYED", "STALE", "MISSING"]),
    rankingSource: z.literal("KIS_CANONICAL_RANKING"),
    taxonomy: z.array(ThemeTaxonomyNodeSchema).min(1),
    instruments: z.array(ThemeInstrumentSchema).min(1),
    mappings: z.array(InstrumentThemeMappingSchema),
    snapshots: z.array(ThemeTurnoverSnapshotSchema),
  })
  .superRefine((input, context) => {
    const asOfMs = Date.parse(input.asOf);
    if (input.sessionDate !== dateInKorea(input.asOf)) {
      context.addIssue({
        code: "custom",
        path: ["sessionDate"],
        message: "sessionDate must match the Asia/Seoul date of asOf",
      });
    }
    if (Date.parse(input.marketTurnoverObservedAt) > asOfMs) {
      context.addIssue({
        code: "custom",
        path: ["marketTurnoverObservedAt"],
        message: "Market turnover cannot be observed after asOf",
      });
    }
    const nodeIds = new Set(input.taxonomy.map((node) => node.id));
    const instrumentIds = new Set(
      input.instruments.map((instrument) => instrument.instrumentId),
    );
    if (nodeIds.size !== input.taxonomy.length) {
      context.addIssue({
        code: "custom",
        path: ["taxonomy"],
        message: "Duplicate taxonomy node id",
      });
    }
    if (instrumentIds.size !== input.instruments.length) {
      context.addIssue({
        code: "custom",
        path: ["instruments"],
        message: "Duplicate instrument id",
      });
    }
    for (const node of input.taxonomy) {
      if (node.parentId !== null && !nodeIds.has(node.parentId)) {
        context.addIssue({
          code: "custom",
          path: ["taxonomy"],
          message: `Unknown parent taxonomy node: ${node.parentId}`,
        });
      }
    }
    for (const mapping of input.mappings) {
      if (!nodeIds.has(mapping.nodeId)) {
        context.addIssue({
          code: "custom",
          path: ["mappings"],
          message: `Unknown mapped taxonomy node: ${mapping.nodeId}`,
        });
      }
      if (!instrumentIds.has(mapping.instrumentId)) {
        context.addIssue({
          code: "custom",
          path: ["mappings"],
          message: `Unknown mapped instrument: ${mapping.instrumentId}`,
        });
      }
    }
    for (const snapshot of input.snapshots) {
      if (!instrumentIds.has(snapshot.instrumentId)) {
        context.addIssue({
          code: "custom",
          path: ["snapshots"],
          message: `Unknown snapshot instrument: ${snapshot.instrumentId}`,
        });
      }
      if (Date.parse(snapshot.observedAt) > asOfMs) {
        context.addIssue({
          code: "custom",
          path: ["snapshots"],
          message: `Snapshot cannot be observed after asOf: ${snapshot.instrumentId}`,
        });
      }
      if (
        snapshot.sessionDate !== input.sessionDate ||
        dateInKorea(snapshot.observedAt) !== input.sessionDate
      ) {
        context.addIssue({
          code: "custom",
          path: ["snapshots"],
          message: `Snapshot session date mismatch: ${snapshot.instrumentId}`,
        });
      }
    }

    const latestSnapshots = new Map<string, (typeof input.snapshots)[number]>();
    for (const snapshot of input.snapshots) {
      const previous = latestSnapshots.get(snapshot.instrumentId);
      if (
        !previous ||
        Date.parse(snapshot.observedAt) > Date.parse(previous.observedAt)
      ) {
        latestSnapshots.set(snapshot.instrumentId, snapshot);
      }
    }
    const marketTurnover = ratioParts(input.marketTurnoverKrw);
    if (marketTurnover !== null) {
      let observedSum = { numerator: 0n, denominator: 1n };
      for (const snapshot of latestSnapshots.values()) {
        const turnover = ratioParts(snapshot.cumulativeTurnoverKrw);
        if (turnover !== null) {
          if (compareParts(turnover, marketTurnover) > 0) {
            context.addIssue({
              code: "custom",
              path: ["snapshots"],
              message: `Instrument turnover exceeds market turnover: ${snapshot.instrumentId}`,
            });
          }
          observedSum = addParts(observedSum, turnover);
        }
      }
      if (compareParts(observedSum, marketTurnover) > 0) {
        context.addIssue({
          code: "custom",
          path: ["marketTurnoverKrw"],
          message: "Eligible snapshot turnover sum exceeds market turnover",
        });
      }
    }
  });

export const LeadershipStatusSchema = z.enum([
  "LEADING",
  "EMERGING",
  "ROTATING",
  "WEAK",
]);

export const LeadershipAvailabilitySchema = z.enum([
  "AVAILABLE",
  "PARTIAL",
  "STALE",
  "N_A",
]);

export const ThemeContributorSchema = z.object({
  instrumentId: InstrumentIdSchema,
  nameKo: z.string().min(1),
  contributionTurnoverKrw: DecimalStringSchema,
  contributionSharePct: PercentDecimalSchema,
  isLargeCap: z.boolean(),
});

export const ThemeLeadershipResultSchema = z.object({
  nodeId: z.string().min(1),
  labelKo: z.string().min(1),
  pathLabelsKo: z.array(z.string().min(1)).min(1),
  availability: LeadershipAvailabilitySchema,
  status: LeadershipStatusSchema.nullable(),
  structure: z
    .enum(["BROAD", "LARGE_CAP_SINGLE_NAME", "CONCENTRATED", "THIN"])
    .nullable(),
  leadershipScore: PercentDecimalSchema.nullable(),
  turnoverKrw: DecimalStringSchema,
  median20TurnoverKrwSameElapsed: DecimalStringSchema.nullable(),
  turnoverAcceleration: DecimalStringSchema.nullable(),
  marketTurnoverSharePct: PercentDecimalSchema.nullable(),
  advancingBreadthPct: PercentDecimalSchema.nullable(),
  top1ConcentrationPct: PercentDecimalSchema.nullable(),
  top3ConcentrationPct: PercentDecimalSchema.nullable(),
  eligibleConstituentCount: z.number().int().nonnegative(),
  advancingConstituentCount: z.number().int().nonnegative(),
  contributors: z.array(ThemeContributorSchema).max(3),
});

export const StockLeadershipResultSchema = z.object({
  rank: z.number().int().positive(),
  instrumentId: InstrumentIdSchema,
  nameKo: z.string().min(1),
  venue: z.enum(["KOSPI", "KOSDAQ"]),
  availability: LeadershipAvailabilitySchema,
  status: LeadershipStatusSchema.nullable(),
  leadershipScore: PercentDecimalSchema.nullable(),
  turnoverKrw: DecimalStringSchema,
  turnoverAcceleration: DecimalStringSchema.nullable(),
  marketTurnoverSharePct: PercentDecimalSchema.nullable(),
  changePct: DecimalStringSchema,
  themeNodeIds: z.array(z.string().min(1)),
});

export const ThemeLeadershipReportSchema = z.object({
  asOf: UtcInstantSchema,
  sessionDate: z.string().date(),
  stockLeaders: z.array(StockLeadershipResultSchema),
  themes: z.array(ThemeLeadershipResultSchema),
  excludedInstrumentIds: z.array(InstrumentIdSchema),
  warnings: z.array(z.string().min(1)),
});

export type ThemeLeadershipInput = z.infer<typeof ThemeLeadershipInputSchema>;
export type ThemeLeadershipReport = z.infer<typeof ThemeLeadershipReportSchema>;
export type ThemeLeadershipResult = z.infer<typeof ThemeLeadershipResultSchema>;
