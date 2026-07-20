export interface ChartCandleGeometry {
  readonly plotStart: number;
  readonly plotEnd: number;
  readonly step: number;
  readonly candleWidth: number;
}

const MAX_DENSE_CANDLE_STEP = 22;

export function resolveChartCandleGeometry(
  candleCount: number,
  plotLeft: number,
  plotRight: number,
): ChartCandleGeometry {
  const count = Math.max(0, Math.trunc(candleCount));
  const plotWidth = Math.max(0, plotRight - plotLeft);
  if (count === 0 || plotWidth === 0) {
    return {
      plotStart: plotLeft,
      plotEnd: plotRight,
      step: plotWidth,
      candleWidth: 1.5,
    };
  }
  const step = Math.min(MAX_DENSE_CANDLE_STEP, plotWidth / count);
  return {
    // Keep a short/zoomed series attached to the latest (right) edge without
    // stretching a few candles across the entire chart.
    plotStart: plotRight - step * count,
    plotEnd: plotRight,
    step,
    candleWidth: Math.max(1.5, step * 0.9),
  };
}
