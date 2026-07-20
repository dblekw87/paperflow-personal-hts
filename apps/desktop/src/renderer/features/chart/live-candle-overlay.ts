export type LiveOverlayChartInterval =
  | "1m"
  | "5m"
  | "15m"
  | "30m"
  | "60m"
  | "4h"
  | "1d"
  | "1w";

export interface LiveOverlayCandle {
  readonly id: string;
  readonly openedAt: string;
  readonly open: string;
  readonly high: string;
  readonly low: string;
  readonly close: string;
  readonly volume: string | null;
  readonly turnover: string | null;
  readonly forming?: boolean;
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1_000;

const intervalMinutes: Readonly<
  Record<Exclude<LiveOverlayChartInterval, "1d" | "1w">, number>
> = {
  "1m": 1,
  "5m": 5,
  "15m": 15,
  "30m": 30,
  "60m": 60,
  "4h": 240,
};

export interface LiveCandleTrade {
  readonly interval: LiveOverlayChartInterval;
  readonly occurredAt: string;
  readonly price: string;
  readonly cumulativeVolume: string | null;
  readonly completeSessionHistory: boolean;
}

export function applyLiveTradeToCandles(
  candles: readonly LiveOverlayCandle[],
  trade: LiveCandleTrade,
): readonly LiveOverlayCandle[] {
  if (trade.interval === "1d" || trade.interval === "1w") return candles;
  const price = finitePositiveInteger(trade.price);
  const occurredAt = Date.parse(trade.occurredAt);
  if (price === null || !Number.isFinite(occurredAt)) return candles;
  const bounds = intradayBucketBounds(occurredAt, trade.interval);
  if (bounds === null) return candles;

  const last = candles.at(-1);
  if (last === undefined) return candles;
  const lastOpenedAt = Date.parse(last.openedAt);
  if (!Number.isFinite(lastOpenedAt) || bounds.openedAtMs < lastOpenedAt) {
    return candles;
  }
  if (!isSameKrxDate(lastOpenedAt, bounds.openedAtMs)) {
    return [
      {
        id: `${last.id}:live:${new Date(bounds.openedAtMs).toISOString()}`,
        openedAt: new Date(bounds.openedAtMs).toISOString(),
        open: trade.price,
        high: trade.price,
        low: trade.price,
        close: trade.price,
        volume: null,
        turnover: null,
        forming: true,
      },
    ];
  }

  if (bounds.openedAtMs === lastOpenedAt) {
    const volume =
      last.volume === null
        ? null
        : currentBucketVolume(
            candles.slice(0, -1),
            trade.cumulativeVolume,
            trade.completeSessionHistory,
          );
    return [
      ...candles.slice(0, -1),
      {
        ...last,
        high: maximumInteger(last.high, trade.price),
        low: minimumInteger(last.low, trade.price),
        close: trade.price,
        volume: volume ?? last.volume,
        forming: true,
      },
    ];
  }

  const volume = currentBucketVolume(
    candles,
    trade.cumulativeVolume,
    trade.completeSessionHistory,
  );
  return [
    ...candles.slice(0, -1),
    { ...last, forming: false },
    {
      id: `${last.id}:live:${new Date(bounds.openedAtMs).toISOString()}`,
      openedAt: new Date(bounds.openedAtMs).toISOString(),
      open: trade.price,
      high: trade.price,
      low: trade.price,
      close: trade.price,
      volume,
      turnover: null,
      forming: true,
    },
  ];
}

function isSameKrxDate(leftMs: number, rightMs: number): boolean {
  const dateKey = (value: number) =>
    new Date(value + KST_OFFSET_MS).toISOString().slice(0, 10);
  return dateKey(leftMs) === dateKey(rightMs);
}

function intradayBucketBounds(
  occurredAtMs: number,
  interval: Exclude<LiveOverlayChartInterval, "1d" | "1w">,
): { openedAtMs: number; closedAtMs: number } | null {
  const local = new Date(occurredAtMs + KST_OFFSET_MS);
  let minuteOfDay = local.getUTCHours() * 60 + local.getUTCMinutes();
  const seconds = local.getUTCSeconds();
  if (minuteOfDay === 15 * 60 + 30 && seconds === 0) {
    minuteOfDay = 15 * 60 + 29;
  }
  const regularStart = 9 * 60;
  const regularEnd = 15 * 60 + 20;
  const closingEnd = 15 * 60 + 30;
  const session =
    minuteOfDay >= regularStart && minuteOfDay < regularEnd
      ? { start: regularStart, end: regularEnd }
      : minuteOfDay >= regularEnd && minuteOfDay < closingEnd
        ? { start: regularEnd, end: closingEnd }
        : null;
  if (session === null) return null;

  const duration = intervalMinutes[interval] ?? 1;
  const bucketMinute =
    session.start +
    Math.floor((minuteOfDay - session.start) / duration) * duration;
  const localMidnightMs = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
  );
  return {
    openedAtMs: localMidnightMs + bucketMinute * 60_000 - KST_OFFSET_MS,
    closedAtMs:
      localMidnightMs +
      Math.min(bucketMinute + duration, session.end) * 60_000 -
      KST_OFFSET_MS,
  };
}

function currentBucketVolume(
  previousCandles: readonly LiveOverlayCandle[],
  cumulativeVolume: string | null,
  completeSessionHistory: boolean,
): string | null {
  if (
    !completeSessionHistory ||
    cumulativeVolume === null ||
    !/^\d+$/.test(cumulativeVolume) ||
    previousCandles.some(
      (candle) => candle.volume === null || !/^\d+$/.test(candle.volume),
    )
  ) {
    return null;
  }
  const previousVolume = previousCandles.reduce(
    (total, candle) => total + BigInt(candle.volume ?? "0"),
    0n,
  );
  const observed = BigInt(cumulativeVolume);
  return observed >= previousVolume
    ? (observed - previousVolume).toString()
    : null;
}

function finitePositiveInteger(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function maximumInteger(left: string, right: string): string {
  return BigInt(left) >= BigInt(right) ? left : right;
}

function minimumInteger(left: string, right: string): string {
  return BigInt(left) <= BigInt(right) ? left : right;
}
