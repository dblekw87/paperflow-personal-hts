import { z } from "zod";

import {
  DecimalStringSchema,
  InstrumentIdSchema,
  UnsignedIntegerStringSchema,
  UtcInstantSchema,
} from "./scalars.js";

const PositiveDecimalStringSchema = DecimalStringSchema.refine(
  (value) => !value.startsWith("-") && !/^\+?0(?:\.0+)?$/.test(value),
  "Expected a positive exact decimal string",
);

const PositiveIntegerStringSchema = UnsignedIntegerStringSchema.refine(
  (value) => BigInt(value) > 0n,
  "Expected a positive integer string",
);

function decimalParts(value: string): { coefficient: bigint; scale: number } {
  const negative = value.startsWith("-");
  const unsigned = /^[+-]/.test(value) ? value.slice(1) : value;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const coefficient = BigInt(`${whole}${fraction}`);
  return {
    coefficient: negative ? -coefficient : coefficient,
    scale: fraction.length,
  };
}

function compareExactDecimal(left: string, right: string): number {
  const leftParts = decimalParts(left);
  const rightParts = decimalParts(right);
  const scale = Math.max(leftParts.scale, rightParts.scale);
  const leftCoefficient =
    leftParts.coefficient * 10n ** BigInt(scale - leftParts.scale);
  const rightCoefficient =
    rightParts.coefficient * 10n ** BigInt(scale - rightParts.scale);
  return leftCoefficient < rightCoefficient
    ? -1
    : leftCoefficient > rightCoefficient
      ? 1
      : 0;
}

function isExactTickAligned(price: string, tickSize: string): boolean {
  const priceParts = decimalParts(price);
  const tickParts = decimalParts(tickSize);
  const scale = Math.max(priceParts.scale, tickParts.scale);
  const priceCoefficient =
    priceParts.coefficient * 10n ** BigInt(scale - priceParts.scale);
  const tickCoefficient =
    tickParts.coefficient * 10n ** BigInt(scale - tickParts.scale);
  return tickCoefficient > 0n && priceCoefficient % tickCoefficient === 0n;
}

export const CanonicalTradingPhaseSchema = z.enum([
  "PREOPEN_AUCTION",
  "REGULAR_CONTINUOUS",
  "VI_PAUSED",
  "CLOSING_AUCTION",
  "AFTER_HOURS_AUCTION",
  "CLOSED",
]);

export type CanonicalTradingPhase = z.infer<
  typeof CanonicalTradingPhaseSchema
>;

export const AuctionTradingPhaseSchema = z.enum([
  "PREOPEN_AUCTION",
  "CLOSING_AUCTION",
  "AFTER_HOURS_AUCTION",
]);

const PhaseEventBaseSchema = z.object({
  instrumentId: InstrumentIdSchema,
  venue: z.string().min(1),
  tradingDayId: z.string().min(1).max(128),
  sessionKey: z.string().min(1).max(128),
  marketEventId: z.string().min(1).max(256),
  sequence: UnsignedIntegerStringSchema,
  occurredAt: UtcInstantSchema,
  receivedAt: UtcInstantSchema,
  freshness: z.enum(["LIVE", "DELAYED", "STALE"]),
  source: z.literal("CANONICAL_MARKET_DATA"),
});

export const TradingPhaseTransitionEventSchema = PhaseEventBaseSchema.extend({
  kind: z.literal("PHASE_TRANSITION"),
  phase: CanonicalTradingPhaseSchema,
  reason: z.enum([
    "CALENDAR",
    "VI_TRIGGERED",
    "VI_RELEASED",
    "SESSION_BOUNDARY",
  ]),
}).superRefine((event, context) => {
  if (event.reason === "VI_TRIGGERED" && event.phase !== "VI_PAUSED") {
    context.addIssue({
      code: "custom",
      path: ["phase"],
      message: "VI_TRIGGERED must enter VI_PAUSED",
    });
  }
  if (
    event.reason === "VI_RELEASED" &&
    event.phase !== "REGULAR_CONTINUOUS"
  ) {
    context.addIssue({
      code: "custom",
      path: ["phase"],
      message: "VI_RELEASED must enter REGULAR_CONTINUOUS",
    });
  }
});

export const TradingPhaseSnapshotEventSchema = PhaseEventBaseSchema.extend({
  kind: z.literal("ORDER_BOOK_SNAPSHOT"),
  phase: CanonicalTradingPhaseSchema,
  complete: z.boolean(),
});

export const TradingPhaseAuctionPrintEventSchema = PhaseEventBaseSchema.extend({
  kind: z.literal("AUCTION_PRINT"),
  phase: AuctionTradingPhaseSchema,
  finalized: z.boolean(),
  clearingPrice: PositiveDecimalStringSchema,
  matchedQuantity: PositiveIntegerStringSchema,
});

export const CanonicalTradingPhaseEventSchema = z.union([
  TradingPhaseTransitionEventSchema,
  TradingPhaseSnapshotEventSchema,
  TradingPhaseAuctionPrintEventSchema,
]);

export type CanonicalTradingPhaseEvent = z.infer<
  typeof CanonicalTradingPhaseEventSchema
>;

export const ContinuousMarketReadinessSchema = z.enum([
  "READY",
  "REQUIRED_AFTER_VI",
  "REQUIRED_AFTER_SESSION_BOUNDARY",
]);

export const TradingPhaseGuardStateSchema = z
  .object({
    instrumentId: InstrumentIdSchema,
    venue: z.string().min(1),
    tradingDayId: z.string().min(1).max(128),
    sessionKey: z.string().min(1).max(128),
    phase: CanonicalTradingPhaseSchema,
    lastSequence: UnsignedIntegerStringSchema.nullable(),
    lastMarketEventId: z.string().min(1).max(256).nullable(),
    continuousReadiness: ContinuousMarketReadinessSchema,
    resyncAfterSequence: UnsignedIntegerStringSchema.nullable(),
    resyncAfterOccurredAt: UtcInstantSchema.nullable(),
    lastFreshSnapshotEventId: z.string().min(1).max(256).nullable(),
    finalizedAuctionPrintEventId: z.string().min(1).max(256).nullable(),
  })
  .superRefine((state, context) => {
    if (
      (state.lastSequence === null) !== (state.lastMarketEventId === null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["lastMarketEventId"],
        message: "last sequence and event ID must be present together",
      });
    }
    const resyncRequired = state.continuousReadiness !== "READY";
    if (
      resyncRequired !==
      (state.resyncAfterSequence !== null &&
        state.resyncAfterOccurredAt !== null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["continuousReadiness"],
        message:
          "a non-ready continuous market requires a sequence and time resync boundary",
      });
    }
  });

export type TradingPhaseGuardState = z.infer<
  typeof TradingPhaseGuardStateSchema
>;

export const TradingPhaseGuardPolicySchema = z.object({
  version: z.string().min(1).max(128),
  maxEventAgeMs: z.number().int().positive(),
});

export type TradingPhaseGuardPolicy = z.infer<
  typeof TradingPhaseGuardPolicySchema
>;

export const TradingPhaseCapabilitySchema = z.object({
  canAcceptLocalOrder: z.boolean(),
  canFillContinuous: z.boolean(),
  canProgressQueue: z.boolean(),
  canAllocateAuctionPrint: z.boolean(),
  shouldScanDayOrdersForExpiry: z.boolean(),
  reason: z.enum([
    "READY",
    "VI_PAUSED",
    "SNAPSHOT_RESYNC_REQUIRED",
    "AUCTION_PRINT_REQUIRED",
    "AUCTION_PRINT_READY",
    "CLOSED",
  ]),
});

export type TradingPhaseCapability = z.infer<
  typeof TradingPhaseCapabilitySchema
>;

export const TradingPhaseGuardDecisionSchema = z.object({
  accepted: z.boolean(),
  rejectionCode: z
    .enum([
      "DELAYED_MARKET_DATA",
      "STALE_MARKET_DATA",
      "OUT_OF_ORDER_EVENT",
      "INSTRUMENT_MISMATCH",
      "VENUE_MISMATCH",
      "TRADING_DAY_MISMATCH",
      "SESSION_MISMATCH",
      "INVALID_PHASE_TRANSITION",
      "FRESH_SNAPSHOT_REQUIRED",
      "AUCTION_PRINT_REQUIRED",
      "PHASE_MISMATCH",
    ])
    .nullable(),
  state: TradingPhaseGuardStateSchema,
  capability: TradingPhaseCapabilitySchema,
  plannedActions: z.array(
    z.enum([
      "PAUSE_CONTINUOUS_FILL",
      "REQUIRE_FRESH_SNAPSHOT_RESYNC",
      "CONTINUOUS_FILL_RESYNCED",
      "AUCTION_PRINT_READY",
      "SCAN_DAY_ORDERS_FOR_EXPIRY",
    ]),
  ),
  policyVersion: z.string().min(1),
});

export type TradingPhaseGuardDecision = z.infer<
  typeof TradingPhaseGuardDecisionSchema
>;

const TickBandSchema = z.object({
  minimumInclusive: DecimalStringSchema.refine(
    (value) => !value.startsWith("-"),
    "tick band minimum cannot be negative",
  ),
  maximumExclusive: PositiveDecimalStringSchema.nullable(),
  tickSize: PositiveDecimalStringSchema,
});

const InjectedTickRuleSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("FIXED"),
    tickSize: PositiveDecimalStringSchema,
  }),
  z
    .object({
      kind: z.literal("BANDED"),
      bands: z.array(TickBandSchema).min(1),
    })
    .superRefine((rule, context) => {
      for (let index = 0; index < rule.bands.length; index += 1) {
        const band = rule.bands[index];
        if (band === undefined) continue;
        if (
          band.maximumExclusive !== null &&
          compareExactDecimal(band.minimumInclusive, band.maximumExclusive) >= 0
        ) {
          context.addIssue({
            code: "custom",
            path: ["bands", index, "maximumExclusive"],
            message: "tick band maximum must exceed its minimum",
          });
        }
        const next = rule.bands[index + 1];
        if (next !== undefined) {
          if (
            band.maximumExclusive === null ||
            compareExactDecimal(
              band.maximumExclusive,
              next.minimumInclusive,
            ) !== 0
          ) {
            context.addIssue({
              code: "custom",
              path: ["bands", index + 1, "minimumInclusive"],
              message: "tick bands must be ordered and contiguous",
            });
          }
        } else if (band.maximumExclusive !== null) {
          context.addIssue({
            code: "custom",
            path: ["bands", index, "maximumExclusive"],
            message: "the final tick band must be open-ended",
          });
        }
      }
    }),
]);

export const CanonicalInstrumentPricePolicySchema = z
  .object({
    instrumentId: InstrumentIdSchema,
    venue: z.string().min(1),
    version: z.string().min(1).max(128),
    effectiveFrom: UtcInstantSchema,
    effectiveTo: UtcInstantSchema.nullable(),
    lowerLimitPrice: PositiveDecimalStringSchema,
    upperLimitPrice: PositiveDecimalStringSchema,
    tickRule: InjectedTickRuleSchema,
    evidenceIds: z.array(z.string().min(1)).min(1),
  })
  .superRefine((policy, context) => {
    if (
      policy.effectiveTo !== null &&
      Date.parse(policy.effectiveTo) <= Date.parse(policy.effectiveFrom)
    ) {
      context.addIssue({
        code: "custom",
        path: ["effectiveTo"],
        message: "effectiveTo must be after effectiveFrom",
      });
    }
    if (
      compareExactDecimal(policy.lowerLimitPrice, policy.upperLimitPrice) > 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["upperLimitPrice"],
        message: "upper limit must be greater than or equal to lower limit",
      });
    }
    if (
      policy.tickRule.kind === "BANDED" &&
      compareExactDecimal(
        policy.tickRule.bands[0]?.minimumInclusive ?? "0",
        policy.lowerLimitPrice,
      ) > 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["tickRule", "bands", 0, "minimumInclusive"],
        message: "tick bands must cover the lower price limit",
      });
    }
    const tickFor = (price: string): string | null =>
      policy.tickRule.kind === "FIXED"
        ? policy.tickRule.tickSize
        : (policy.tickRule.bands.find(
            (band) =>
              compareExactDecimal(price, band.minimumInclusive) >= 0 &&
              (band.maximumExclusive === null ||
                compareExactDecimal(price, band.maximumExclusive) < 0),
          )?.tickSize ?? null);
    for (const [path, price] of [
      ["lowerLimitPrice", policy.lowerLimitPrice],
      ["upperLimitPrice", policy.upperLimitPrice],
    ] as const) {
      const tickSize = tickFor(price);
      if (tickSize === null || !isExactTickAligned(price, tickSize)) {
        context.addIssue({
          code: "custom",
          path: [path],
          message: "daily price limits must align with the injected tick rule",
        });
      }
    }
  });

export type CanonicalInstrumentPricePolicy = z.infer<
  typeof CanonicalInstrumentPricePolicySchema
>;

export const PriceBandGuardInputSchema = z.object({
  instrumentId: InstrumentIdSchema,
  venue: z.string().min(1),
  price: PositiveDecimalStringSchema,
  policy: CanonicalInstrumentPricePolicySchema,
  evaluatedAt: UtcInstantSchema,
});

export type PriceBandGuardInput = z.infer<typeof PriceBandGuardInputSchema>;

export const PriceBandGuardDecisionSchema = z.object({
  accepted: z.boolean(),
  rejectionCode: z
    .enum([
      "INSTRUMENT_MISMATCH",
      "VENUE_MISMATCH",
      "POLICY_NOT_EFFECTIVE",
      "PRICE_BELOW_LOWER_LIMIT",
      "PRICE_ABOVE_UPPER_LIMIT",
      "INVALID_TICK",
    ])
    .nullable(),
  normalizedPrice: PositiveDecimalStringSchema,
  resolvedTickSize: PositiveDecimalStringSchema.nullable(),
  policyVersion: z.string().min(1),
  evidenceIds: z.array(z.string().min(1)).min(1),
});

export type PriceBandGuardDecision = z.infer<
  typeof PriceBandGuardDecisionSchema
>;

export const DayOrderExpiryCandidateSchema = z.object({
  clientOrderId: z.string().min(1).max(128),
  instrumentId: InstrumentIdSchema,
  venue: z.string().min(1),
  tradingDayId: z.string().min(1).max(128),
  timeInForce: z.literal("DAY"),
  status: z.enum([
    "ACCEPTED",
    "RESTING",
    "PARTIALLY_FILLED",
    "FILLED",
    "CANCELLED",
    "PARTIALLY_FILLED_CANCELLED",
    "REJECTED",
    "EXPIRED",
  ]),
  remainingQuantity: UnsignedIntegerStringSchema,
});

export type DayOrderExpiryCandidate = z.infer<
  typeof DayOrderExpiryCandidateSchema
>;

export const DayOrderExpiryPlanSchema = z.object({
  shouldExpire: z.boolean(),
  reason: z.enum([
    "CLOSED_DAY_ORDER",
    "MARKET_NOT_CLOSED",
    "TRADING_DAY_MISMATCH",
    "INSTRUMENT_MISMATCH",
    "VENUE_MISMATCH",
    "ORDER_NOT_OPEN",
  ]),
  event: z
    .object({
      type: z.literal("ORDER_DAY_EXPIRY_REQUESTED"),
      clientOrderId: z.string().min(1).max(128),
      remainingQuantity: PositiveIntegerStringSchema,
      terminalStatus: z.literal("EXPIRED"),
      owner: z.literal("DB_TRANSACTION_OWNER"),
      idempotencyKey: z.string().min(1).max(512),
      tradingDayId: z.string().min(1).max(128),
    })
    .nullable(),
});

export type DayOrderExpiryPlan = z.infer<typeof DayOrderExpiryPlanSchema>;
