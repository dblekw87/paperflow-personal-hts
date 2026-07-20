import { z } from "zod";

import { OrderBookSnapshotSchema, TradeTickSchema } from "./market.js";
import { InstrumentIdSchema, UtcInstantSchema } from "./scalars.js";

export const MarketLiveConnectionStatusSchema = z.enum([
  "idle",
  "connecting",
  "subscribing",
  "live",
  "reconnecting",
  "stopped",
  "failed",
]);

export const MarketLiveCoverageSchema = z.enum([
  "empty",
  "partial",
  "complete",
]);

export const MarketLiveErrorSchema = z.object({
  code: z.string().min(1),
  retryable: z.boolean(),
});

export const MarketLiveProjectionSchema = z
  .object({
    instrumentId: InstrumentIdSchema,
    environment: z.enum(["paper", "prod"]),
    source: z.literal("KIS_WS"),
    connectionStatus: MarketLiveConnectionStatusSchema,
    freshness: z.enum(["live", "stale", "offline"]),
    coverage: MarketLiveCoverageSchema,
    generation: z.number().int().nonnegative(),
    reconnectCount: z.number().int().nonnegative(),
    acknowledged: z.object({
      orderBook: z.boolean(),
      trade: z.boolean(),
    }),
    orderBook: OrderBookSnapshotSchema.nullable(),
    trade: TradeTickSchema.nullable(),
    asOf: UtcInstantSchema,
    lastReceivedAt: UtcInstantSchema.nullable(),
    lastOrderBookReceivedAt: UtcInstantSchema.nullable(),
    lastTradeReceivedAt: UtcInstantSchema.nullable(),
    lastError: MarketLiveErrorSchema.nullable(),
  })
  .superRefine((projection, context) => {
    for (const [field, value] of [
      ["orderBook", projection.orderBook],
      ["trade", projection.trade],
    ] as const) {
      if (value !== null && value.instrumentId !== projection.instrumentId) {
        context.addIssue({
          code: "custom",
          path: [field, "instrumentId"],
          message: "Live projection instrument identity does not match",
        });
      }
    }

    const presentCount =
      Number(projection.orderBook !== null) + Number(projection.trade !== null);
    const expectedCoverage =
      presentCount === 0
        ? "empty"
        : presentCount === 1
          ? "partial"
          : "complete";
    if (projection.coverage !== expectedCoverage) {
      context.addIssue({
        code: "custom",
        path: ["coverage"],
        message: "Live projection coverage does not match its payloads",
      });
    }

    if (
      projection.freshness === "live" &&
      (projection.connectionStatus !== "live" || presentCount === 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["freshness"],
        message: "Only a connected projection with data can be live",
      });
    }
  });

export const MarketLiveEventSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("ORDER_BOOK"),
    receivedAt: UtcInstantSchema,
    data: OrderBookSnapshotSchema,
  }),
  z.object({
    kind: z.literal("TRADE"),
    receivedAt: UtcInstantSchema,
    data: TradeTickSchema,
  }),
]);

type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? ReadonlyArray<DeepReadonly<Item>>
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export type MarketLiveError = Readonly<z.infer<typeof MarketLiveErrorSchema>>;
export type MarketLiveProjection = DeepReadonly<
  z.infer<typeof MarketLiveProjectionSchema>
>;
export type MarketLiveEvent = DeepReadonly<
  z.infer<typeof MarketLiveEventSchema>
>;
