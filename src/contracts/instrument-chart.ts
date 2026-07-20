import { z } from "zod";

import {
  DecimalStringSchema,
  InstrumentIdSchema,
  UtcInstantSchema,
} from "./scalars.js";

function decimalParts(value: string): {
  numerator: bigint;
  denominator: bigint;
} {
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) throw new Error(`Invalid decimal: ${value}`);
  const places = match[3] ?? "";
  return {
    numerator:
      (match[1] === "-" ? -1n : 1n) * BigInt(`${match[2] ?? "0"}${places}`),
    denominator: 10n ** BigInt(places.length),
  };
}

function compareDecimal(left: string, right: string): number {
  const a = decimalParts(left);
  const b = decimalParts(right);
  const difference = a.numerator * b.denominator - b.numerator * a.denominator;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

const NonNegativeDecimalSchema = DecimalStringSchema.refine(
  (value) => compareDecimal(value, "0") >= 0,
  "Expected a non-negative decimal",
);

const PositiveDecimalSchema = DecimalStringSchema.refine(
  (value) => compareDecimal(value, "0") > 0,
  "Expected a positive decimal",
);

export const ChartIntervalSchema = z.enum([
  "1m",
  "5m",
  "15m",
  "30m",
  "60m",
  "4h",
  "1d",
  "1w",
]);

export const ChartCandleSchema = z
  .object({
    instrumentId: InstrumentIdSchema,
    interval: ChartIntervalSchema,
    session: z.enum([
      "PRE_MARKET",
      "REGULAR",
      "CLOSING_AUCTION",
      "AFTER_MARKET",
    ]),
    openedAt: UtcInstantSchema,
    closedAt: UtcInstantSchema,
    state: z.enum(["FORMING", "CLOSED"]),
    open: PositiveDecimalSchema,
    high: PositiveDecimalSchema,
    low: PositiveDecimalSchema,
    close: PositiveDecimalSchema,
    volume: NonNegativeDecimalSchema.nullable(),
    volumeProvenance: z.enum([
      "PROVIDER_REPORTED",
      "LOCAL_TRADE_AGGREGATE",
      "UNAVAILABLE",
    ]),
    turnover: NonNegativeDecimalSchema.nullable(),
    turnoverProvenance: z.enum([
      "PROVIDER_REPORTED",
      "LOCAL_TRADE_AGGREGATE",
      "UNAVAILABLE",
    ]),
    turnoverCalculation: z
      .object({
        method: z.literal("SUM_TRADE_PRICE_TIMES_QUANTITY"),
        arithmetic: z.literal("EXACT_DECIMAL"),
        outputScale: z.number().int().min(0).max(18),
        rounding: z.enum(["HALF_UP", "HALF_EVEN", "DOWN"]),
      })
      .nullable(),
    currency: z.enum(["KRW", "USD"]),
    source: z.literal("KIS_CANONICAL_MARKET_DATA"),
    freshness: z.enum(["LIVE", "DELAYED", "STALE", "CLOSED"]),
    isAdjusted: z.boolean(),
  })
  .superRefine((candle, context) => {
    if (Date.parse(candle.closedAt) <= Date.parse(candle.openedAt)) {
      context.addIssue({
        code: "custom",
        path: ["closedAt"],
        message: "Candle closedAt must be later than openedAt",
      });
    }
    if (
      (candle.volume === null) !==
      (candle.volumeProvenance === "UNAVAILABLE")
    ) {
      context.addIssue({
        code: "custom",
        path: ["volume"],
        message: "Volume availability and provenance must agree",
      });
    }
    if (
      (candle.turnover === null) !==
      (candle.turnoverProvenance === "UNAVAILABLE")
    ) {
      context.addIssue({
        code: "custom",
        path: ["turnover"],
        message: "Turnover availability and provenance must agree",
      });
    }
    if (
      (candle.turnoverProvenance === "LOCAL_TRADE_AGGREGATE") !==
      (candle.turnoverCalculation !== null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["turnoverCalculation"],
        message:
          "Local turnover requires a calculation policy and provider/unavailable turnover must not have one",
      });
    }
    for (const [field, value] of [
      ["open", candle.open],
      ["low", candle.low],
      ["close", candle.close],
    ] as const) {
      if (compareDecimal(candle.high, value) < 0) {
        context.addIssue({
          code: "custom",
          path: ["high"],
          message: `Candle high is below ${field}`,
        });
      }
    }
    for (const [field, value] of [
      ["open", candle.open],
      ["high", candle.high],
      ["close", candle.close],
    ] as const) {
      if (compareDecimal(candle.low, value) > 0) {
        context.addIssue({
          code: "custom",
          path: ["low"],
          message: `Candle low is above ${field}`,
        });
      }
    }
  });

export const MovingAverageSettingSchema = z.object({
  period: z.number().int().min(2).max(500),
  basis: z.enum(["CLOSE", "VOLUME", "TURNOVER"]),
  kind: z.enum(["SMA", "EMA"]),
  visible: z.boolean(),
});

export const InstrumentChartSettingsSchema = z
  .object({
    movingAverages: z.array(MovingAverageSettingSchema).max(12),
    showVolume: z.boolean(),
    showTurnover: z.boolean(),
    showPaperFillMarkers: z.boolean(),
    timeZone: z.enum(["EXCHANGE", "ASIA_SEOUL"]),
    includeExtendedHours: z.boolean(),
  })
  .superRefine((settings, context) => {
    const identities = settings.movingAverages.map(
      (item) => `${item.basis}:${item.kind}:${item.period}`,
    );
    if (new Set(identities).size !== identities.length) {
      context.addIssue({
        code: "custom",
        path: ["movingAverages"],
        message: "Duplicate moving-average setting",
      });
    }
  });

export const PaperFillChartMarkerSchema = z.object({
  markerId: z.string().min(1),
  localOrderId: z.string().min(1),
  localFillId: z.string().min(1),
  instrumentId: InstrumentIdSchema,
  side: z.enum(["BUY", "SELL"]),
  fillState: z.enum(["PARTIAL_FILL", "FULL_FILL"]),
  filledAt: UtcInstantSchema,
  price: PositiveDecimalSchema,
  quantity: PositiveDecimalSchema,
  source: z.literal("LOCAL_PAPER_FILL"),
});

export const InstrumentChartProjectionSchema = z
  .object({
    instrumentId: InstrumentIdSchema,
    asOf: UtcInstantSchema,
    interval: ChartIntervalSchema,
    candles: z.array(ChartCandleSchema),
    paperFillMarkers: z.array(PaperFillChartMarkerSchema),
    settings: InstrumentChartSettingsSchema,
  })
  .superRefine((projection, context) => {
    const asOfMs = Date.parse(projection.asOf);
    const candleKeys = new Set<string>();
    let previousOpenedAt = Number.NEGATIVE_INFINITY;
    for (const candle of projection.candles) {
      if (
        candle.instrumentId !== projection.instrumentId ||
        candle.interval !== projection.interval
      ) {
        context.addIssue({
          code: "custom",
          path: ["candles"],
          message: "Chart candle identity does not match projection",
        });
      }
      const openedAt = Date.parse(candle.openedAt);
      if (openedAt < previousOpenedAt) {
        context.addIssue({
          code: "custom",
          path: ["candles"],
          message: "Chart candles must be sorted by openedAt",
        });
      }
      previousOpenedAt = openedAt;
      const key = `${candle.instrumentId}:${candle.interval}:${candle.openedAt}`;
      if (candleKeys.has(key)) {
        context.addIssue({
          code: "custom",
          path: ["candles"],
          message: "Duplicate chart candle",
        });
      }
      candleKeys.add(key);
      if (Date.parse(candle.openedAt) > asOfMs) {
        context.addIssue({
          code: "custom",
          path: ["candles"],
          message: "Chart candle starts after projection asOf",
        });
      }
      const closedAt = Date.parse(candle.closedAt);
      if (candle.state === "CLOSED" && closedAt > asOfMs) {
        context.addIssue({
          code: "custom",
          path: ["candles"],
          message: "Closed chart candle ends after projection asOf",
        });
      }
      if (
        candle.state === "FORMING" &&
        !(openedAt <= asOfMs && asOfMs < closedAt)
      ) {
        context.addIssue({
          code: "custom",
          path: ["candles"],
          message: "Forming candle must contain projection asOf",
        });
      }
    }
    const markerIds = new Set<string>();
    const fillIds = new Set<string>();
    for (const marker of projection.paperFillMarkers) {
      if (marker.instrumentId !== projection.instrumentId) {
        context.addIssue({
          code: "custom",
          path: ["paperFillMarkers"],
          message: "Paper fill marker instrument does not match projection",
        });
      }
      if (Date.parse(marker.filledAt) > asOfMs) {
        context.addIssue({
          code: "custom",
          path: ["paperFillMarkers"],
          message: "Paper fill marker occurs after projection asOf",
        });
      }
      if (markerIds.has(marker.markerId) || fillIds.has(marker.localFillId)) {
        context.addIssue({
          code: "custom",
          path: ["paperFillMarkers"],
          message: "Duplicate paper fill marker",
        });
      }
      markerIds.add(marker.markerId);
      fillIds.add(marker.localFillId);
    }
  });

export const InstrumentWorkspaceVisibilitySchema = z.object({
  instrumentId: InstrumentIdSchema,
  chart: z.literal("VISIBLE"),
  orderBook: z.literal("VISIBLE"),
  samePage: z.literal(true),
});

export type InstrumentChartProjection = z.infer<
  typeof InstrumentChartProjectionSchema
>;
export type InstrumentChartSettings = z.infer<
  typeof InstrumentChartSettingsSchema
>;
export type PaperFillChartMarker = z.infer<typeof PaperFillChartMarkerSchema>;
