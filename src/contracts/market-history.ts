import { z } from "zod";

import { ChartCandleSchema } from "./instrument-chart.js";
import { InstrumentIdSchema, UtcInstantSchema } from "./scalars.js";

export const DomesticCandleHistorySchema = z
  .object({
    schemaVersion: z.literal(1),
    instrumentId: InstrumentIdSchema,
    interval: z.enum(["1m", "1d"]),
    exchangeTimezone: z.literal("Asia/Seoul"),
    candles: z.array(ChartCandleSchema),
    source: z.object({
      provider: z.literal("KIS"),
      transport: z.literal("REST"),
      dataEnvironment: z.enum(["paper", "prod"]),
      path: z.enum([
        "/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice",
        "/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice",
      ]),
      trId: z.enum(["FHKST03010200", "FHKST03010100"]),
      fetchedAt: UtcInstantSchema,
      officialSampleCommit: z.literal(
        "885dd4e2f5c37e4f7e23dd63c15555a9967bc7bc",
      ),
    }),
    pagination: z.object({
      strategy: z.enum([
        "TIME_CURSOR_BACKWARD_WITH_DEDUPLICATION",
        "DATE_WINDOW_BACKWARD_WITH_DEDUPLICATION",
      ]),
      pageSizeLimit: z.union([z.literal(30), z.literal(100)]),
      pagesFetched: z.number().int().min(1),
      maxPages: z.number().int().min(1),
      complete: z.boolean(),
      nextCursor: z.string().nullable(),
    }),
    quality: z.object({
      coverage: z.enum(["CURRENT_KRX_BUSINESS_DAY_ONLY", "REQUESTED_DATE_RANGE"]),
      priceAdjustment: z.enum([
        "CURRENT_SESSION_ORIGINAL",
        "ADJUSTED",
        "ORIGINAL",
      ]),
      volume: z.literal("PROVIDER_REPORTED"),
      turnover: z.enum(["PROVIDER_REPORTED", "UNAVAILABLE"]),
      caveats: z.array(
        z.enum([
          "LATEST_MINUTE_VOLUME_MAY_CARRY_PREVIOUS_MINUTE_UNTIL_FIRST_TRADE",
          "MINUTE_TURNOVER_IS_UNAVAILABLE_BECAUSE_KIS_REPORTS_CUMULATIVE_TURNOVER",
          "MINUTE_ENDPOINT_DOES_NOT_PROVIDE_PRIOR_BUSINESS_DAYS",
          "CLOSING_AUCTION_INDICATIVE_ROWS_EXCLUDED",
        ]),
      ),
    }),
  })
  .superRefine((history, context) => {
    const fetchedAt = Date.parse(history.source.fetchedAt);
    let previousOpenedAt = Number.NEGATIVE_INFINITY;
    let formingCount = 0;
    const identities = new Set<string>();
    for (const candle of history.candles) {
      if (
        candle.instrumentId !== history.instrumentId ||
        candle.interval !== history.interval
      ) {
        context.addIssue({
          code: "custom",
          path: ["candles"],
          message: "History candle identity does not match its projection",
        });
      }
      const openedAt = Date.parse(candle.openedAt);
      if (openedAt < previousOpenedAt) {
        context.addIssue({
          code: "custom",
          path: ["candles"],
          message: "History candles must be sorted by openedAt",
        });
      }
      previousOpenedAt = openedAt;
      const identity = `${candle.instrumentId}:${candle.interval}:${candle.openedAt}`;
      if (identities.has(identity)) {
        context.addIssue({
          code: "custom",
          path: ["candles"],
          message: "History candles must be unique",
        });
      }
      identities.add(identity);
      const closedAt = Date.parse(candle.closedAt);
      if (candle.state === "CLOSED" && closedAt > fetchedAt) {
        context.addIssue({
          code: "custom",
          path: ["candles"],
          message: "Closed history candle ends after source fetchedAt",
        });
      }
      if (candle.state === "FORMING") {
        formingCount += 1;
        if (!(openedAt <= fetchedAt && fetchedAt < closedAt)) {
          context.addIssue({
            code: "custom",
            path: ["candles"],
            message: "Forming history candle must contain source fetchedAt",
          });
        }
      }
    }
    if (formingCount > 1) {
      context.addIssue({
        code: "custom",
        path: ["candles"],
        message: "History contains more than one forming candle",
      });
    }
    if (history.pagination.pagesFetched > history.pagination.maxPages) {
      context.addIssue({
        code: "custom",
        path: ["pagination", "pagesFetched"],
        message: "History fetched more pages than its configured maximum",
      });
    }
    if (
      history.pagination.complete !==
      (history.pagination.nextCursor === null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["pagination", "nextCursor"],
        message: "Complete history must not expose a next cursor",
      });
    }

    const isMinute = history.interval === "1m";
    const expectedPath = isMinute
      ? "/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice"
      : "/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice";
    const expectedTrId = isMinute ? "FHKST03010200" : "FHKST03010100";
    if (
      history.source.path !== expectedPath ||
      history.source.trId !== expectedTrId
    ) {
      context.addIssue({
        code: "custom",
        path: ["source"],
        message: "History source does not match its interval",
      });
    }
    const expectedStrategy = isMinute
      ? "TIME_CURSOR_BACKWARD_WITH_DEDUPLICATION"
      : "DATE_WINDOW_BACKWARD_WITH_DEDUPLICATION";
    const expectedPageSize = isMinute ? 30 : 100;
    if (
      history.pagination.strategy !== expectedStrategy ||
      history.pagination.pageSizeLimit !== expectedPageSize
    ) {
      context.addIssue({
        code: "custom",
        path: ["pagination"],
        message: "History pagination does not match its interval",
      });
    }
    if (
      isMinute &&
      (history.quality.turnover !== "UNAVAILABLE" ||
        history.candles.some((candle) => candle.turnover !== null))
    ) {
      context.addIssue({
        code: "custom",
        path: ["quality", "turnover"],
        message: "KIS minute turnover must remain unavailable",
      });
    }
    if (
      !isMinute &&
      (history.quality.turnover !== "PROVIDER_REPORTED" ||
        history.candles.some((candle) => candle.turnover === null))
    ) {
      context.addIssue({
        code: "custom",
        path: ["quality", "turnover"],
        message: "KIS daily turnover must preserve provider values",
      });
    }
  });

export type DomesticCandleHistory = z.infer<
  typeof DomesticCandleHistorySchema
>;

export const AggregatedDomesticChartIntervalSchema = z.enum([
  "5m",
  "15m",
  "30m",
  "60m",
  "4h",
  "1w",
]);

export const AggregatedDomesticCandleHistorySchema = z
  .object({
    schemaVersion: z.literal(1),
    instrumentId: InstrumentIdSchema,
    interval: AggregatedDomesticChartIntervalSchema,
    exchangeTimezone: z.literal("Asia/Seoul"),
    candles: z.array(ChartCandleSchema),
    source: z.object({
      provider: z.literal("KIS"),
      transport: z.literal("LOCAL_DETERMINISTIC_AGGREGATION"),
      dataEnvironment: z.enum(["paper", "prod"]),
      inputInterval: z.enum(["1m", "1d"]),
      fetchedAt: UtcInstantSchema,
      bucketPolicy: z.literal("KRX_SESSION_ANCHORED_KST"),
      gapPolicy: z.literal("OBSERVED_CANDLES_ONLY"),
    }),
    quality: z.object({
      volume: z.enum([
        "PROVIDER_REPORTED",
        "LOCAL_TRADE_AGGREGATE",
        "UNAVAILABLE",
      ]),
      turnover: z.enum([
        "PROVIDER_REPORTED",
        "LOCAL_TRADE_AGGREGATE",
        "UNAVAILABLE",
      ]),
    }),
  })
  .superRefine((history, context) => {
    const expectedInput = history.interval === "1w" ? "1d" : "1m";
    if (history.source.inputInterval !== expectedInput) {
      context.addIssue({
        code: "custom",
        path: ["source", "inputInterval"],
        message: "Aggregated interval does not match its canonical input",
      });
    }

    const fetchedAt = Date.parse(history.source.fetchedAt);
    const identities = new Set<string>();
    let previousOpenedAt = Number.NEGATIVE_INFINITY;
    let formingCount = 0;
    for (const candle of history.candles) {
      if (
        candle.instrumentId !== history.instrumentId ||
        candle.interval !== history.interval
      ) {
        context.addIssue({
          code: "custom",
          path: ["candles"],
          message: "Aggregated candle identity does not match its projection",
        });
      }
      const openedAt = Date.parse(candle.openedAt);
      if (openedAt < previousOpenedAt) {
        context.addIssue({
          code: "custom",
          path: ["candles"],
          message: "Aggregated candles must be sorted by openedAt",
        });
      }
      previousOpenedAt = openedAt;
      const identity = `${candle.instrumentId}:${candle.interval}:${candle.openedAt}`;
      if (identities.has(identity)) {
        context.addIssue({
          code: "custom",
          path: ["candles"],
          message: "Aggregated candles must be unique",
        });
      }
      identities.add(identity);

      const closedAt = Date.parse(candle.closedAt);
      if (candle.state === "CLOSED" && closedAt > fetchedAt) {
        context.addIssue({
          code: "custom",
          path: ["candles"],
          message: "Closed aggregated candle ends after source fetchedAt",
        });
      }
      if (candle.state === "FORMING") {
        formingCount += 1;
        if (!(openedAt <= fetchedAt && fetchedAt < closedAt)) {
          context.addIssue({
            code: "custom",
            path: ["candles"],
            message: "Forming aggregated candle must contain source fetchedAt",
          });
        }
      }
    }
    if (formingCount > 1) {
      context.addIssue({
        code: "custom",
        path: ["candles"],
        message: "Aggregated history contains more than one forming candle",
      });
    }

    const volumeProvenances = new Set(
      history.candles.map((candle) => candle.volumeProvenance),
    );
    if (
      history.candles.length > 0 &&
      (volumeProvenances.size !== 1 ||
        !volumeProvenances.has(history.quality.volume))
    ) {
      context.addIssue({
        code: "custom",
        path: ["quality", "volume"],
        message: "Aggregated volume quality must match every candle",
      });
    }
    const turnoverProvenances = new Set(
      history.candles.map((candle) => candle.turnoverProvenance),
    );
    if (
      history.candles.length > 0 &&
      (turnoverProvenances.size !== 1 ||
        !turnoverProvenances.has(history.quality.turnover))
    ) {
      context.addIssue({
        code: "custom",
        path: ["quality", "turnover"],
        message: "Aggregated turnover quality must match every candle",
      });
    }
  });

export type AggregatedDomesticChartInterval = z.infer<
  typeof AggregatedDomesticChartIntervalSchema
>;
export type AggregatedDomesticCandleHistory = z.infer<
  typeof AggregatedDomesticCandleHistorySchema
>;
