import { z } from "zod";

import {
  DecimalStringSchema,
  InstrumentIdSchema,
  UnsignedIntegerStringSchema,
  UtcInstantSchema,
} from "./scalars.js";

export const FreshnessSchema = z.enum(["live", "delayed", "stale", "offline"]);
export const SupportVerificationSchema = z.enum([
  "verified",
  "unknown",
  "unsupported",
]);

export const DataSupportSchema = z.object({
  verification: SupportVerificationSchema,
  realtime: z.boolean().nullable(),
  observedDelayMs: z.number().int().nonnegative().nullable(),
  orderBookDepth: z.number().int().positive().nullable(),
  evidenceIds: z.array(z.string()),
});

export const TradeTickSchema = z.object({
  instrumentId: InstrumentIdSchema,
  venue: z.string().min(1),
  session: z.enum(["PRE", "REGULAR", "AFTER", "CLOSED", "UNKNOWN"]),
  price: DecimalStringSchema,
  quantity: UnsignedIntegerStringSchema,
  change: DecimalStringSchema.nullable(),
  changeRate: DecimalStringSchema.nullable(),
  executionStrength: DecimalStringSchema.nullable().optional(),
  cumulativeVolume: UnsignedIntegerStringSchema.nullable(),
  cumulativeTurnover: DecimalStringSchema.nullable(),
  occurredAt: UtcInstantSchema.nullable(),
  providerDate: z.string().nullable(),
  providerTime: z.string().nullable(),
  source: z.literal("KIS_WS"),
});

export type TradeTick = z.infer<typeof TradeTickSchema>;

const OrderBookLevelSchema = z.object({
  price: DecimalStringSchema,
  quantity: UnsignedIntegerStringSchema,
});

export const OrderBookSnapshotSchema = z.object({
  instrumentId: InstrumentIdSchema,
  venue: z.string().min(1),
  bids: z.array(OrderBookLevelSchema),
  asks: z.array(OrderBookLevelSchema),
  totalBidQuantity: UnsignedIntegerStringSchema.nullable(),
  totalAskQuantity: UnsignedIntegerStringSchema.nullable(),
  occurredAt: UtcInstantSchema.nullable(),
  providerDate: z.string().nullable(),
  providerTime: z.string().nullable(),
  source: z.literal("KIS_WS"),
});

export type OrderBookSnapshot = z.infer<typeof OrderBookSnapshotSchema>;
