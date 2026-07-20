export const MAX_RENDERED_CHART_CANDLES = 360;
export const MAX_RENDERED_ONE_MINUTE_CANDLES = 420;

export interface SampleableChartCandle {
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

export interface ChartViewBucket {
  readonly candle: SampleableChartCandle;
  readonly sourceStartIndex: number;
  readonly sourceEndIndex: number;
}

export function downsampleCandlesForView(
  candles: readonly SampleableChartCandle[],
  maximum = MAX_RENDERED_CHART_CANDLES,
): readonly ChartViewBucket[] {
  if (!Number.isInteger(maximum) || maximum < 1) {
    throw new TypeError("Chart view maximum must be a positive integer");
  }
  if (candles.length <= maximum) {
    return candles.map((candle, index) => ({
      candle,
      sourceStartIndex: index,
      sourceEndIndex: index,
    }));
  }

  return Array.from({ length: maximum }, (_, bucketIndex) => {
    const sourceStartIndex = Math.floor(
      (bucketIndex * candles.length) / maximum,
    );
    const sourceEndExclusive = Math.floor(
      ((bucketIndex + 1) * candles.length) / maximum,
    );
    const sourceEndIndex = Math.max(
      sourceStartIndex,
      sourceEndExclusive - 1,
    );
    const group = candles.slice(sourceStartIndex, sourceEndIndex + 1);
    const first = group[0]!;
    const last = group.at(-1)!;
    return {
      candle: {
        id: `view:${first.id}:${last.id}`,
        openedAt: first.openedAt,
        open: first.open,
        high: extremeDecimal(group.map((candle) => candle.high), "max"),
        low: extremeDecimal(group.map((candle) => candle.low), "min"),
        close: last.close,
        volume: sumMeasure(group.map((candle) => candle.volume)),
        turnover: sumMeasure(group.map((candle) => candle.turnover)),
        forming: group.some((candle) => candle.forming === true),
      },
      sourceStartIndex,
      sourceEndIndex,
    };
  });
}

function extremeDecimal(
  values: readonly string[],
  direction: "min" | "max",
): string {
  return values.reduce((selected, candidate) => {
    const comparison = Number(candidate) - Number(selected);
    return direction === "max"
      ? comparison > 0
        ? candidate
        : selected
      : comparison < 0
        ? candidate
        : selected;
  });
}

function sumMeasure(values: readonly (string | null)[]): string | null {
  if (values.some((value) => value === null)) return null;
  const available = values as readonly string[];
  if (available.every((value) => /^(?:0|[1-9]\d*)$/.test(value))) {
    return available
      .reduce((total, value) => total + BigInt(value), 0n)
      .toString();
  }
  const total = available.reduce((sum, value) => sum + Number(value), 0);
  return Number.isFinite(total) ? String(total) : null;
}
