import { z } from "zod";

import {
  DecimalStringSchema,
  InstrumentIdSchema,
  UnsignedIntegerStringSchema,
  UtcInstantSchema,
} from "./scalars.js";
import { OrderBookSnapshotSchema, TradeTickSchema } from "./market.js";

const PositiveDecimalStringSchema = DecimalStringSchema.refine(
  (value) => !value.startsWith("-") && !/^\+?0(?:\.0+)?$/.test(value),
  "Expected a positive exact decimal string",
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

function scaledDecimalKey(values: string[]): string {
  const parts = values.map(decimalParts);
  const scale = Math.max(0, ...parts.map((part) => part.scale));
  let coefficient = parts.reduce(
    (sum, part) => sum + part.coefficient * 10n ** BigInt(scale - part.scale),
    0n,
  );
  let normalizedScale = scale;
  while (normalizedScale > 0 && coefficient % 10n === 0n) {
    coefficient /= 10n;
    normalizedScale -= 1;
  }
  return `${coefficient}:${normalizedScale}`;
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

const PositiveIntegerStringSchema = UnsignedIntegerStringSchema.refine(
  (value) => BigInt(value) > 0n,
  "Expected a positive integer quantity",
);

export const PaperOrderSideSchema = z.enum(["BUY", "SELL"]);
export const PaperOrderTypeSchema = z.enum(["MARKET", "LIMIT"]);
export const PaperOrderStatusSchema = z.enum([
  "DRAFT",
  "ACCEPTED",
  "RESTING",
  "PARTIALLY_FILLED",
  "PARTIALLY_FILLED_CANCELLED",
  "FILLED",
  "CANCELLED",
  "REJECTED",
]);

export const PaperOrderCommandSchema = z
  .object({
    clientOrderId: z.string().min(1).max(128),
    accountId: z.string().min(1).max(128),
    instrumentId: InstrumentIdSchema,
    venue: z.string().min(1),
    currency: z.string().regex(/^[A-Z]{3}$/),
    side: PaperOrderSideSchema,
    orderType: PaperOrderTypeSchema,
    quantity: PositiveIntegerStringSchema,
    limitPrice: PositiveDecimalStringSchema.nullable(),
    timeInForce: z.literal("DAY"),
    session: z.literal("REGULAR"),
    submittedAt: UtcInstantSchema,
    submissionMode: z.enum(["CONFIRM_TICKET", "ONE_CLICK_ARMED"]),
    simulationOnly: z.literal(true),
  })
  .superRefine((order, context) => {
    if (order.orderType === "LIMIT" && order.limitPrice === null) {
      context.addIssue({
        code: "custom",
        path: ["limitPrice"],
        message: "LIMIT orders require limitPrice",
      });
    }
    if (order.orderType === "MARKET" && order.limitPrice !== null) {
      context.addIssue({
        code: "custom",
        path: ["limitPrice"],
        message: "MARKET orders cannot have limitPrice",
      });
    }
  });

export type PaperOrderCommand = z.infer<typeof PaperOrderCommandSchema>;

export const OrderBookRowClickSchema = z.object({
  rowSide: z.enum(["ASK", "BID"]),
  rowPrice: PositiveDecimalStringSchema,
  quantity: PositiveIntegerStringSchema,
  clientOrderId: z.string().min(1).max(128),
  accountId: z.string().min(1).max(128),
  instrumentId: InstrumentIdSchema,
  venue: z.string().min(1),
  currency: z.string().regex(/^[A-Z]{3}$/),
  clickedAt: UtcInstantSchema,
  oneClickArmed: z.boolean(),
});

export type OrderBookRowClick = z.infer<typeof OrderBookRowClickSchema>;

export const PaperOrderDraftSchema = z.object({
  order: PaperOrderCommandSchema,
  clickedRowSide: z.enum(["ASK", "BID"]),
  confirmationRequired: z.boolean(),
  localSimulationLabel: z.literal("로컬 모의주문"),
});

export type PaperOrderDraft = z.infer<typeof PaperOrderDraftSchema>;

const CanonicalEventMetadataSchema = z.object({
  marketEventId: z.string().min(1),
  sequence: UnsignedIntegerStringSchema,
  currency: z.string().regex(/^[A-Z]{3}$/),
  freshness: z.enum(["LIVE", "DELAYED", "STALE"]),
  receivedAt: UtcInstantSchema,
  tradingPhase: z.enum([
    "PREOPEN_AUCTION",
    "REGULAR_CONTINUOUS",
    "VI_PAUSED",
    "CLOSING_AUCTION",
    "AFTER_HOURS_AUCTION",
    "CLOSED",
  ]),
  sessionKey: z.string().min(1),
});

export const CanonicalOrderBookEventSchema =
  CanonicalEventMetadataSchema.extend({
    kind: z.literal("ORDER_BOOK"),
    snapshot: OrderBookSnapshotSchema,
  });

export type CanonicalOrderBookEvent = z.infer<
  typeof CanonicalOrderBookEventSchema
>;

export const CanonicalTradeEventSchema = CanonicalEventMetadataSchema.extend({
  kind: z.literal("TRADE_TICK"),
  tick: TradeTickSchema,
  auction: z
    .object({
      finalized: z.boolean(),
      clearingPrice: PositiveDecimalStringSchema,
    })
    .nullable(),
});

export type CanonicalTradeEvent = z.infer<typeof CanonicalTradeEventSchema>;

const TickRuleMetadataSchema = z
  .object({
    venue: z.string().min(1),
    version: z.string().min(1),
    effectiveFrom: UtcInstantSchema,
    effectiveTo: UtcInstantSchema.nullable(),
  })
  .superRefine((rule, context) => {
    if (
      rule.effectiveTo !== null &&
      Date.parse(rule.effectiveTo) <= Date.parse(rule.effectiveFrom)
    ) {
      context.addIssue({
        code: "custom",
        path: ["effectiveTo"],
        message: "effectiveTo must be after effectiveFrom",
      });
    }
  });

const FixedTickRuleSchema = TickRuleMetadataSchema.and(
  z.object({
    kind: z.literal("FIXED"),
    tickSize: PositiveDecimalStringSchema,
  }),
);

const BandedTickRuleSchema = TickRuleMetadataSchema.and(
  z
    .object({
      kind: z.literal("BANDED"),
      bands: z
        .array(
          z.object({
            minimumInclusive: DecimalStringSchema.refine(
              (value) => !value.startsWith("-"),
              "band minimum cannot be negative",
            ),
            maximumExclusive: PositiveDecimalStringSchema.nullable(),
            tickSize: PositiveDecimalStringSchema,
          }),
        )
        .min(1),
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
            message: "band maximum must be greater than its minimum",
          });
        }
        const nextBand = rule.bands[index + 1];
        if (nextBand !== undefined) {
          if (
            band.maximumExclusive === null ||
            compareExactDecimal(
              band.maximumExclusive,
              nextBand.minimumInclusive,
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
);

export const TickRuleSchema = z.union([
  FixedTickRuleSchema,
  BandedTickRuleSchema,
]);

export type TickRule = z.infer<typeof TickRuleSchema>;

export const PaperFillPolicySchema = z
  .object({
    maxMarketDataAgeMs: z.number().int().positive(),
    passiveFillModel: z.enum(["AT_OR_THROUGH", "TRADE_THROUGH"]),
    marketRemainder: z.literal("CANCEL"),
    marketableLimitRemainder: z.literal("REST"),
    vwapScale: z.number().int().min(0).max(18),
    version: z.string().min(1),
    tickRule: TickRuleSchema,
    minimumPrice: PositiveDecimalStringSchema,
    maximumPrice: PositiveDecimalStringSchema,
  })
  .superRefine((policy, context) => {
    if (compareExactDecimal(policy.minimumPrice, policy.maximumPrice) > 0) {
      context.addIssue({
        code: "custom",
        path: ["maximumPrice"],
        message: "maximumPrice must be greater than or equal to minimumPrice",
      });
    }
    if (
      policy.tickRule.kind === "BANDED" &&
      compareExactDecimal(
        policy.tickRule.bands[0]?.minimumInclusive ?? "0",
        policy.minimumPrice,
      ) > 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["tickRule", "bands", 0, "minimumInclusive"],
        message: "tick bands must cover minimumPrice",
      });
    }
  });

export type PaperFillPolicy = z.infer<typeof PaperFillPolicySchema>;

export const PaperPlannerStateSchema = z
  .object({
    seenClientOrderIds: z.array(z.string()),
    lastOrderBookSequence: UnsignedIntegerStringSchema.nullable(),
    lastTradeSequence: UnsignedIntegerStringSchema.nullable(),
    cursorScope: z
      .object({
        instrumentId: InstrumentIdSchema,
        sessionKey: z.string().min(1),
      })
      .nullable(),
  })
  .superRefine((state, context) => {
    const hasSequence =
      state.lastOrderBookSequence !== null || state.lastTradeSequence !== null;
    if (hasSequence !== (state.cursorScope !== null)) {
      context.addIssue({
        code: "custom",
        path: ["cursorScope"],
        message:
          "cursorScope must be present exactly when a sequence cursor is present",
      });
    }
  });

export type PaperPlannerState = z.infer<typeof PaperPlannerStateSchema>;

export const PaperFillSchema = z.object({
  fillId: z.string().min(1),
  clientOrderId: z.string().min(1),
  marketEventId: z.string().min(1),
  price: PositiveDecimalStringSchema,
  quantity: PositiveIntegerStringSchema,
  grossNotional: PositiveDecimalStringSchema,
  liquidity: z.enum([
    "BOOK_TAKING",
    "PASSIVE_AT_OR_THROUGH",
    "PASSIVE_TRADE_THROUGH",
  ]),
  fillModelVersion: z.string().min(1),
});

export type PaperFill = z.infer<typeof PaperFillSchema>;

export const PaperPlanEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("ORDER_ACCEPTED"),
    clientOrderId: z.string(),
    riskReservation: z.literal("REVERIFY_AND_RESERVE_AT_DB_COMMIT"),
  }),
  z.object({
    type: z.literal("FILL_AND_LEDGER_COMMIT_REQUESTED"),
    transactionGroupId: z.string(),
    fill: PaperFillSchema,
    feeTaxPolicyResolution: z.literal("DB_TRANSACTION_OWNER"),
    feeLedgerEvent: z.literal("PLAN_SEPARATELY"),
    taxLedgerEvent: z.literal("PLAN_SEPARATELY"),
  }),
  z.object({
    type: z.literal("ORDER_RESTING"),
    clientOrderId: z.string(),
    remainingQuantity: PositiveIntegerStringSchema,
    passiveFillModel: z.enum(["AT_OR_THROUGH", "TRADE_THROUGH"]),
  }),
  z.object({
    type: z.literal("ORDER_REMAINDER_CANCELLED"),
    clientOrderId: z.string(),
    cancelledQuantity: PositiveIntegerStringSchema,
    reason: z.literal("INSUFFICIENT_VISIBLE_DEPTH"),
  }),
  z.object({
    type: z.literal("ORDER_CANCEL_REQUESTED"),
    clientOrderId: z.string(),
    cancelledQuantity: PositiveIntegerStringSchema,
    owner: z.literal("DB_TRANSACTION_OWNER"),
  }),
]);

export type PaperPlanEvent = z.infer<typeof PaperPlanEventSchema>;

export const PaperPlanRejectionCodeSchema = z.enum([
  "DUPLICATE_CLIENT_ORDER_ID",
  "STALE_MARKET_DATA",
  "DELAYED_MARKET_DATA",
  "CLOSED_SESSION",
  "OUT_OF_ORDER_EVENT",
  "INSTRUMENT_MISMATCH",
  "VENUE_MISMATCH",
  "CURRENCY_MISMATCH",
  "EVENT_TIME_MISSING",
  "EVENT_BEFORE_ORDER",
  "LIMIT_NOT_REACHED",
  "NOT_TRADE_THROUGH",
  "NOT_OPEN",
  "VI_PAUSED",
  "AUCTION_PRINT_REQUIRED",
  "SESSION_NOT_FILLABLE",
  "INVALID_TICK",
  "PRICE_OUT_OF_RANGE",
  "INSUFFICIENT_AVAILABLE_CASH",
  "INSUFFICIENT_AVAILABLE_POSITION",
  "STATE_SCOPE_MISMATCH",
]);

export const PaperExecutionPlanSchema = z
  .object({
    clientOrderId: z.string(),
    status: PaperOrderStatusSchema,
    rejectionCode: PaperPlanRejectionCodeSchema.nullable(),
    fills: z.array(PaperFillSchema),
    orderQuantity: PositiveIntegerStringSchema,
    newlyFilledQuantity: UnsignedIntegerStringSchema,
    filledQuantity: UnsignedIntegerStringSchema,
    remainingQuantity: UnsignedIntegerStringSchema,
    cancelledQuantity: UnsignedIntegerStringSchema,
    grossNotional: DecimalStringSchema,
    vwap: DecimalStringSchema.nullable(),
    plannedEvents: z.array(PaperPlanEventSchema),
    nextState: PaperPlannerStateSchema,
    commitOwner: z.literal("DB_TRANSACTION_OWNER"),
  })
  .superRefine((plan, context) => {
    if ((plan.status === "REJECTED") !== (plan.rejectionCode !== null)) {
      context.addIssue({
        code: "custom",
        path: ["rejectionCode"],
        message: "only REJECTED plans may carry a rejectionCode",
      });
    }
    if (plan.fills.some((fill) => fill.clientOrderId !== plan.clientOrderId)) {
      context.addIssue({
        code: "custom",
        path: ["fills"],
        message: "every fill clientOrderId must match the plan",
      });
    }
    if (
      new Set(plan.fills.map((fill) => fill.fillId)).size !== plan.fills.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["fills"],
        message: "fillId must be unique within a plan",
      });
    }
    const commitEvents = plan.plannedEvents.filter(
      (event) => event.type === "FILL_AND_LEDGER_COMMIT_REQUESTED",
    );
    for (const fill of plan.fills) {
      const matchingEvents = commitEvents.filter(
        (event) => event.fill.fillId === fill.fillId,
      );
      const event = matchingEvents[0];
      if (
        matchingEvents.length !== 1 ||
        event === undefined ||
        event.fill.clientOrderId !== plan.clientOrderId ||
        event.fill.marketEventId !== fill.marketEventId ||
        event.fill.price !== fill.price ||
        event.fill.quantity !== fill.quantity ||
        event.fill.grossNotional !== fill.grossNotional ||
        event.transactionGroupId !==
          `${plan.clientOrderId}:${fill.marketEventId}`
      ) {
        context.addIssue({
          code: "custom",
          path: ["plannedEvents"],
          message:
            "each fill requires one matching commit event and transaction identity",
        });
      }
    }
    if (
      commitEvents.some(
        (event) =>
          !plan.fills.some((fill) => fill.fillId === event.fill.fillId),
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["plannedEvents"],
        message: "commit events cannot reference fills outside the plan",
      });
    }
    for (const event of plan.plannedEvents) {
      const eventClientOrderId =
        event.type === "FILL_AND_LEDGER_COMMIT_REQUESTED"
          ? event.fill.clientOrderId
          : event.clientOrderId;
      if (eventClientOrderId !== plan.clientOrderId) {
        context.addIssue({
          code: "custom",
          path: ["plannedEvents"],
          message: "planned event clientOrderId must match the plan",
        });
      }
    }
    const fillQuantity = plan.fills.reduce(
      (sum, fill) => sum + BigInt(fill.quantity),
      0n,
    );
    if (fillQuantity !== BigInt(plan.newlyFilledQuantity)) {
      context.addIssue({
        code: "custom",
        path: ["newlyFilledQuantity"],
        message: "newlyFilledQuantity must equal planned fill quantities",
      });
    }
    if (
      scaledDecimalKey(plan.fills.map((fill) => fill.grossNotional)) !==
      scaledDecimalKey([plan.grossNotional])
    ) {
      context.addIssue({
        code: "custom",
        path: ["grossNotional"],
        message: "grossNotional must equal planned fill notionals",
      });
    }
    if (
      BigInt(plan.filledQuantity) +
        BigInt(plan.remainingQuantity) +
        BigInt(plan.cancelledQuantity) !==
      BigInt(plan.orderQuantity)
    ) {
      context.addIssue({
        code: "custom",
        path: ["orderQuantity"],
        message:
          "filled, remaining and cancelled must account for orderQuantity",
      });
    }
    if (
      ["FILLED", "CANCELLED", "PARTIALLY_FILLED_CANCELLED"].includes(
        plan.status,
      ) &&
      BigInt(plan.remainingQuantity) !== 0n
    ) {
      context.addIssue({
        code: "custom",
        path: ["remainingQuantity"],
        message: "terminal plans cannot retain open quantity",
      });
    }
    if (
      plan.status === "PARTIALLY_FILLED_CANCELLED" &&
      (BigInt(plan.filledQuantity) === 0n ||
        BigInt(plan.cancelledQuantity) === 0n)
    ) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "partial-cancel status requires filled and cancelled quantity",
      });
    }
    if (
      plan.status === "FILLED" &&
      (BigInt(plan.filledQuantity) !== BigInt(plan.orderQuantity) ||
        BigInt(plan.cancelledQuantity) !== 0n)
    ) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "FILLED must account for the full order as fills",
      });
    }
    if (plan.status === "CANCELLED" && BigInt(plan.filledQuantity) !== 0n) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "a partly filled cancellation uses PARTIALLY_FILLED_CANCELLED",
      });
    }
    if (
      plan.status === "PARTIALLY_FILLED" &&
      (BigInt(plan.filledQuantity) === 0n ||
        BigInt(plan.remainingQuantity) === 0n ||
        BigInt(plan.cancelledQuantity) !== 0n)
    ) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "PARTIALLY_FILLED requires filled and open quantity only",
      });
    }
  });

export type PaperExecutionPlan = z.infer<typeof PaperExecutionPlanSchema>;

export const OpenPaperOrderSchema = z
  .object({
    order: PaperOrderCommandSchema,
    status: z.enum(["ACCEPTED", "RESTING", "PARTIALLY_FILLED"]),
    filledQuantity: UnsignedIntegerStringSchema,
    acceptedAt: UtcInstantSchema,
  })
  .superRefine((openOrder, context) => {
    if (BigInt(openOrder.filledQuantity) >= BigInt(openOrder.order.quantity)) {
      context.addIssue({
        code: "custom",
        path: ["filledQuantity"],
        message: "open filledQuantity must be less than order quantity",
      });
    }
    if (
      openOrder.status === "PARTIALLY_FILLED" &&
      BigInt(openOrder.filledQuantity) === 0n
    ) {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "PARTIALLY_FILLED requires positive filledQuantity",
      });
    }
  });

export type OpenPaperOrder = z.infer<typeof OpenPaperOrderSchema>;

export const OrderBookCapabilitySchema = z.object({
  venueFamily: z.enum(["KRX", "US"]),
  bidDepth: z.number().int().positive(),
  askDepth: z.number().int().positive(),
  capabilityEvidence: z.enum([
    "KR_DOMESTIC_TEN_LEVEL",
    "US_CURRENT_CONTRACT_ONE_LEVEL",
  ]),
});

export type OrderBookCapability = z.infer<typeof OrderBookCapabilitySchema>;

export const AdvancedQueueStateSchema = z.object({
  clientOrderId: z.string().min(1),
  instrumentId: InstrumentIdSchema,
  venue: z.string().min(1),
  currency: z.string().regex(/^[A-Z]{3}$/),
  side: PaperOrderSideSchema,
  limitPrice: PositiveDecimalStringSchema,
  remainingQuantity: UnsignedIntegerStringSchema,
  aheadQuantityEstimate: UnsignedIntegerStringSchema,
  lastDisplayedQuantityAtPrice: UnsignedIntegerStringSchema,
  safetyFactor: PositiveDecimalStringSchema,
  queuePositionQuality: z.literal("QUEUE_ESTIMATED"),
  sessionKey: z.string().min(1),
  lastOrderBookSequence: UnsignedIntegerStringSchema,
  lastTradeSequence: UnsignedIntegerStringSchema.nullable(),
  seenMarketEventIds: z.array(z.string().min(1)),
  viPaused: z.boolean(),
});

export type AdvancedQueueState = z.infer<typeof AdvancedQueueStateSchema>;

export const AdvancedQueueDecisionSchema = z.object({
  state: AdvancedQueueStateSchema,
  fill: PaperFillSchema.nullable(),
  rejectionCode: PaperPlanRejectionCodeSchema.nullable(),
  queueProgressQuantity: UnsignedIntegerStringSchema,
  resetRequired: z.boolean(),
  plannedEvents: z.array(PaperPlanEventSchema),
});

export type AdvancedQueueDecision = z.infer<typeof AdvancedQueueDecisionSchema>;

export const PreTradeAvailabilitySchema = z.object({
  availableCash: DecimalStringSchema.refine(
    (value) => !value.startsWith("-"),
    "availableCash cannot be negative",
  ),
  availablePositionQuantity: UnsignedIntegerStringSchema,
  estimatedFeeTaxReserve: DecimalStringSchema.refine(
    (value) => !value.startsWith("-"),
    "estimatedFeeTaxReserve cannot be negative",
  ),
});

export const PreTradeRiskDecisionSchema = z.object({
  accepted: z.boolean(),
  rejectionCode: z
    .enum(["INSUFFICIENT_AVAILABLE_CASH", "INSUFFICIENT_AVAILABLE_POSITION"])
    .nullable(),
});

export type PreTradeAvailability = z.infer<typeof PreTradeAvailabilitySchema>;
export type PreTradeRiskDecision = z.infer<typeof PreTradeRiskDecisionSchema>;
