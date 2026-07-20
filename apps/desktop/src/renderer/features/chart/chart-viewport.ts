export interface ChartViewport {
  readonly start: number;
  readonly end: number;
}

export const MIN_VISIBLE_CHART_CANDLES = 20;

export function fullChartViewport(length: number): ChartViewport {
  return { start: 0, end: Math.max(0, Math.trunc(length)) };
}

export function normalizeChartViewport(
  viewport: ChartViewport,
  length: number,
): ChartViewport {
  const safeLength = Math.max(0, Math.trunc(length));
  if (safeLength === 0) return fullChartViewport(0);
  const visible = Math.max(
    1,
    Math.min(safeLength, Math.trunc(viewport.end - viewport.start)),
  );
  const start = Math.max(
    0,
    Math.min(safeLength - visible, Math.trunc(viewport.start)),
  );
  return { start, end: start + visible };
}

export function zoomChartViewport(
  viewport: ChartViewport,
  length: number,
  anchorRatio: number,
  direction: "IN" | "OUT",
): ChartViewport {
  const current = normalizeChartViewport(viewport, length);
  const currentCount = current.end - current.start;
  if (currentCount === 0) return current;
  const minimum = Math.min(MIN_VISIBLE_CHART_CANDLES, length);
  const targetCount = Math.max(
    minimum,
    Math.min(
      length,
      Math.round(currentCount * (direction === "IN" ? 0.8 : 1.25)),
    ),
  );
  const anchor = Math.max(0, Math.min(1, anchorRatio));
  const anchorIndex = current.start + currentCount * anchor;
  const targetStart = Math.round(anchorIndex - targetCount * anchor);
  return normalizeChartViewport(
    { start: targetStart, end: targetStart + targetCount },
    length,
  );
}

export function panChartViewport(
  viewport: ChartViewport,
  length: number,
  deltaCandles: number,
): ChartViewport {
  const current = normalizeChartViewport(viewport, length);
  const visible = current.end - current.start;
  return normalizeChartViewport(
    {
      start: current.start + Math.round(deltaCandles),
      end: current.start + Math.round(deltaCandles) + visible,
    },
    length,
  );
}
