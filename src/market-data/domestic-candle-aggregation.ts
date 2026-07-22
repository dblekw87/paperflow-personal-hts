import type { z } from "zod";

import type { ChartCandleSchema } from "../contracts/instrument-chart.js";
import {
  AggregatedDomesticCandleHistorySchema,
  type AggregatedDomesticChartInterval,
  type AggregatedDomesticCandleHistory,
  DomesticCandleHistorySchema,
  type DomesticCandleHistory,
} from "../contracts/market-history.js";

type ChartCandle = z.infer<typeof ChartCandleSchema>;
type IntradayTargetInterval = Exclude<
  AggregatedDomesticChartInterval,
  "1w"
>;
type MeasureField = "volume" | "turnover";
type MeasureProvenance =
  | "PROVIDER_REPORTED"
  | "LOCAL_TRADE_AGGREGATE"
  | "UNAVAILABLE";

const KST_OFFSET_MS = 9 * 60 * 60 * 1_000;
const DAY_MS = 24 * 60 * 60 * 1_000;

const INTRADAY_INTERVAL_MINUTES: Record<IntradayTargetInterval, number> = {
  "5m": 5,
  "15m": 15,
  "30m": 30,
  "60m": 60,
  "4h": 4 * 60,
};

const KRX_SESSION_BOUNDS = {
  PRE_MARKET: { anchorMinute: 8 * 60, endMinute: 8 * 60 + 50 },
  REGULAR: { anchorMinute: 9 * 60, endMinute: 15 * 60 + 20 },
  CLOSING_AUCTION: {
    anchorMinute: 15 * 60 + 20,
    endMinute: 15 * 60 + 30,
  },
  AFTER_MARKET: {
    anchorMinute: 15 * 60 + 40,
    endMinute: 20 * 60,
  },
} as const;

type CandleBucket = {
  openedAtMs: number;
  closedAtMs: number;
  session: ChartCandle["session"];
  candles: ChartCandle[];
};

/**
 * Aggregates canonical KIS 1-minute candles to intraday intervals, or canonical
 * KIS daily candles to KRX calendar weeks. It never interpolates missing input
 * candles. The source fetchedAt is the sole point-in-time state boundary.
 */
export function aggregateDomesticCandleHistory(
  input: DomesticCandleHistory,
  targetInterval: AggregatedDomesticChartInterval,
): AggregatedDomesticCandleHistory {
  const history = DomesticCandleHistorySchema.parse(input);
  assertCompatibleIntervals(history.interval, targetInterval);
  assertUniformHistory(history);

  const volumeProvenance = measureProvenance(
    history.candles,
    "volume",
    history.quality.volume,
  );
  const turnoverProvenance = measureProvenance(
    history.candles,
    "turnover",
    history.quality.turnover,
  );
  const fetchedAtMs = Date.parse(history.source.fetchedAt);
  const buckets = new Map<string, CandleBucket>();

  for (const candle of history.candles) {
    const bounds =
      targetInterval === "1w"
        ? weeklyBucketBounds(candle.openedAt)
        : intradayBucketBounds(candle, targetInterval);
    const bucketSession = candle.session;
    const key = `${bucketSession}:${bounds.openedAtMs}`;
    const bucket = buckets.get(key);
    if (bucket === undefined) {
      buckets.set(key, {
        ...bounds,
        session: bucketSession,
        candles: [candle],
      });
    } else {
      bucket.candles.push(candle);
    }
  }

  const candles = [...buckets.values()]
    .sort((left, right) => left.openedAtMs - right.openedAtMs)
    .map((bucket) =>
      aggregateBucket(
        bucket,
        targetInterval,
        fetchedAtMs,
        volumeProvenance,
        turnoverProvenance,
      ),
    );

  return AggregatedDomesticCandleHistorySchema.parse({
    schemaVersion: 1,
    instrumentId: history.instrumentId,
    interval: targetInterval,
    exchangeTimezone: "Asia/Seoul",
    candles,
    source: {
      provider: "KIS",
      transport: "LOCAL_DETERMINISTIC_AGGREGATION",
      dataEnvironment: history.source.dataEnvironment,
      inputInterval: history.interval,
      fetchedAt: history.source.fetchedAt,
      bucketPolicy: "DOMESTIC_INTEGRATED_SESSION_ANCHORED_KST",
      gapPolicy: "OBSERVED_CANDLES_ONLY",
    },
    quality: {
      volume: volumeProvenance,
      turnover: turnoverProvenance,
    },
  });
}

function assertCompatibleIntervals(
  sourceInterval: DomesticCandleHistory["interval"],
  targetInterval: AggregatedDomesticChartInterval,
): void {
  const expectedSource = targetInterval === "1w" ? "1d" : "1m";
  if (sourceInterval !== expectedSource) {
    throw new TypeError(
      `${targetInterval} aggregation requires canonical ${expectedSource} input`,
    );
  }
}

function assertUniformHistory(history: DomesticCandleHistory): void {
  if (
    history.interval === "1d" &&
    history.candles.some((candle) => candle.session !== "REGULAR")
  ) {
    throw new TypeError("Canonical KRX daily candles must use REGULAR session");
  }
  const currencies = new Set(
    history.candles.map((candle) => candle.currency),
  );
  const adjustmentStates = new Set(
    history.candles.map((candle) => candle.isAdjusted),
  );
  if (currencies.size > 1) {
    throw new TypeError("Cannot aggregate candles with mixed currencies");
  }
  if (adjustmentStates.size > 1) {
    throw new TypeError(
      "Cannot aggregate adjusted and original candles together",
    );
  }
}

function measureProvenance(
  candles: ChartCandle[],
  field: MeasureField,
  emptyHistoryProvenance: MeasureProvenance,
): MeasureProvenance {
  if (candles.length === 0) {
    return emptyHistoryProvenance;
  }
  const provenanceField =
    field === "volume" ? "volumeProvenance" : "turnoverProvenance";
  const provenances = new Set(
    candles.map((candle) => candle[provenanceField]),
  );
  if (provenances.size !== 1) {
    throw new TypeError(
      `Cannot aggregate candles with mixed ${field} provenance`,
    );
  }
  return candles[0]?.[provenanceField] ?? "UNAVAILABLE";
}

function intradayBucketBounds(
  candle: ChartCandle,
  targetInterval: IntradayTargetInterval,
): { openedAtMs: number; closedAtMs: number } {
  const local = new Date(Date.parse(candle.openedAt) + KST_OFFSET_MS);
  const minuteOfDay = local.getUTCHours() * 60 + local.getUTCMinutes();
  const sessionBounds = KRX_SESSION_BOUNDS[candle.session];
  if (
    minuteOfDay < sessionBounds.anchorMinute ||
    minuteOfDay >= sessionBounds.endMinute
  ) {
    throw new TypeError(
      `Candle time does not belong to its declared ${candle.session} session`,
    );
  }
  const intervalMinutes = INTRADAY_INTERVAL_MINUTES[targetInterval];
  const bucketIndex = Math.floor(
    (minuteOfDay - sessionBounds.anchorMinute) / intervalMinutes,
  );
  const bucketMinute =
    sessionBounds.anchorMinute + Math.max(0, bucketIndex) * intervalMinutes;
  const bucketEndMinute = Math.min(
    bucketMinute + intervalMinutes,
    sessionBounds.endMinute,
  );
  const localMidnightMs = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
  );
  return {
    openedAtMs: localMidnightMs + bucketMinute * 60_000 - KST_OFFSET_MS,
    closedAtMs: localMidnightMs + bucketEndMinute * 60_000 - KST_OFFSET_MS,
  };
}

function weeklyBucketBounds(openedAt: string): {
  openedAtMs: number;
  closedAtMs: number;
} {
  const local = new Date(Date.parse(openedAt) + KST_OFFSET_MS);
  const daysSinceMonday = (local.getUTCDay() + 6) % 7;
  const mondayLocalMidnightMs =
    Date.UTC(
      local.getUTCFullYear(),
      local.getUTCMonth(),
      local.getUTCDate(),
    ) -
    daysSinceMonday * DAY_MS;
  return {
    openedAtMs:
      mondayLocalMidnightMs + 9 * 60 * 60 * 1_000 - KST_OFFSET_MS,
    closedAtMs:
      mondayLocalMidnightMs +
      4 * DAY_MS +
      (15 * 60 + 30) * 60_000 -
      KST_OFFSET_MS,
  };
}

function aggregateBucket(
  bucket: CandleBucket,
  targetInterval: AggregatedDomesticChartInterval,
  fetchedAtMs: number,
  volumeProvenance: MeasureProvenance,
  turnoverProvenance: MeasureProvenance,
): ChartCandle {
  const candles = bucket.candles.sort(
    (left, right) => Date.parse(left.openedAt) - Date.parse(right.openedAt),
  );
  const first = candles[0];
  const last = candles.at(-1);
  if (first === undefined || last === undefined) {
    throw new TypeError("Cannot aggregate an empty candle bucket");
  }
  const forming =
    bucket.openedAtMs <= fetchedAtMs && fetchedAtMs < bucket.closedAtMs;
  const formingInput = candles.find((candle) => candle.state === "FORMING");

  return {
    instrumentId: first.instrumentId,
    interval: targetInterval,
    session: targetInterval === "1w" ? "REGULAR" : bucket.session,
    openedAt: new Date(bucket.openedAtMs).toISOString(),
    closedAt: new Date(bucket.closedAtMs).toISOString(),
    state: forming ? "FORMING" : "CLOSED",
    open: first.open,
    high: candles.reduce(
      (highest, candle) =>
        compareDecimal(candle.high, highest) > 0 ? candle.high : highest,
      first.high,
    ),
    low: candles.reduce(
      (lowest, candle) =>
        compareDecimal(candle.low, lowest) < 0 ? candle.low : lowest,
      first.low,
    ),
    close: last.close,
    volume:
      volumeProvenance === "UNAVAILABLE"
        ? null
        : sumDecimal(candles.map((candle) => requiredMeasure(candle, "volume"))),
    volumeProvenance,
    turnover:
      turnoverProvenance === "UNAVAILABLE"
        ? null
        : sumDecimal(
            candles.map((candle) => requiredMeasure(candle, "turnover")),
          ),
    turnoverProvenance,
    turnoverCalculation:
      turnoverProvenance === "LOCAL_TRADE_AGGREGATE"
        ? first.turnoverCalculation
        : null,
    currency: first.currency,
    source: "KIS_CANONICAL_MARKET_DATA",
    freshness: forming
      ? (formingInput?.freshness ?? "STALE")
      : "CLOSED",
    isAdjusted: first.isAdjusted,
  };
}

function requiredMeasure(
  candle: ChartCandle,
  field: MeasureField,
): string {
  const value = candle[field];
  if (value === null) {
    throw new TypeError(`Available ${field} provenance requires a value`);
  }
  return value;
}

function compareDecimal(left: string, right: string): number {
  const a = decimalParts(left);
  const b = decimalParts(right);
  const difference =
    a.numerator * 10n ** BigInt(b.scale) -
    b.numerator * 10n ** BigInt(a.scale);
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

function sumDecimal(values: string[]): string {
  const parts = values.map(decimalParts);
  const scale = parts.reduce(
    (maximum, part) => Math.max(maximum, part.scale),
    0,
  );
  const sum = parts.reduce(
    (total, part) =>
      total + part.numerator * 10n ** BigInt(scale - part.scale),
    0n,
  );
  return formatDecimal(sum, scale);
}

function decimalParts(value: string): { numerator: bigint; scale: number } {
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) {
    throw new TypeError("Expected an exact decimal string");
  }
  const decimals = match[3] ?? "";
  return {
    numerator:
      (match[1] === "-" ? -1n : 1n) *
      BigInt(`${match[2] ?? "0"}${decimals}`),
    scale: decimals.length,
  };
}

function formatDecimal(value: bigint, scale: number): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const padded = absolute.toString().padStart(scale + 1, "0");
  const whole =
    scale === 0 ? padded : padded.slice(0, Math.max(1, padded.length - scale));
  const decimals = scale === 0 ? "" : padded.slice(-scale).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${decimals.length > 0 ? `.${decimals}` : ""}`;
}
