import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

import "./MarketChart.css";
import {
  downsampleCandlesForView,
  MAX_RENDERED_ONE_MINUTE_CANDLES,
} from "./chart-view-sampling.js";
import {
  chartTimeAxisTickIndexes,
  formatChartTimeAxisLabel,
} from "./chart-time-axis.js";
import { resolveChartCandleGeometry } from "./chart-candle-geometry.js";
import { truncateUsPrice, truncateUsPriceNumber } from "../../model/price-display.js";
import {
  fullChartViewport,
  normalizeChartViewport,
  panChartViewport,
  zoomChartViewport,
  type ChartViewport,
} from "./chart-viewport.js";

export type ChartInterval =
  | "1m"
  | "5m"
  | "15m"
  | "30m"
  | "60m"
  | "4h"
  | "1d"
  | "1w";
export type ChartRange = "1D" | "6M" | "1Y" | "5Y";

export type IndicatorKind = "SMA" | "EMA";
export type IndicatorSource = "PRICE" | "VOLUME" | "TURNOVER";

export interface MarketCandleViewModel {
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

export interface ChartIndicatorViewModel {
  readonly id: string;
  readonly kind: IndicatorKind;
  readonly source: IndicatorSource;
  readonly period: number;
  readonly visible: boolean;
}

export interface PaperFillMarkerViewModel {
  readonly id: string;
  readonly orderId: string;
  readonly filledAt: string;
  readonly price: string;
  readonly quantity: string;
  readonly side: "BUY" | "SELL";
  readonly completion: "PARTIAL" | "FULL";
  readonly source: "LOCAL_PAPER_FILL";
}

export interface MarketChartProps {
  readonly instrumentId: string;
  readonly instrumentName: string;
  readonly currency: string;
  readonly interval: ChartInterval;
  readonly intervals?: readonly ChartInterval[];
  readonly range: ChartRange;
  readonly ranges?: readonly ChartRange[];
  readonly candles: readonly MarketCandleViewModel[];
  readonly indicators: readonly ChartIndicatorViewModel[];
  readonly fillMarkers: readonly PaperFillMarkerViewModel[];
  readonly currentPrice: string | null;
  readonly previousClosePrice: string | null;
  readonly freshness: "LIVE" | "DELAYED" | "STALE" | "OFFLINE";
  readonly marketDataSource?:
    | "KIS_CANONICAL_MARKET_DATA"
    | "SYNTHETIC_UI_FIXTURE"
    | "UNAVAILABLE";
  readonly turnoverQuality?:
    | "PROVIDER_REPORTED"
    | "LOCAL_TRADE_AGGREGATE"
    | "UNAVAILABLE";
  readonly historyComplete?: boolean;
  readonly onIntervalChange: (interval: ChartInterval) => void;
  readonly onRangeChange: (range: ChartRange) => void;
  readonly onIndicatorToggle: (indicatorId: string, visible: boolean) => void;
  readonly onIndicatorAdd: (
    indicator: Omit<ChartIndicatorViewModel, "id" | "visible">,
  ) => void;
}

const INTERVAL_LABELS: Readonly<Record<ChartInterval, string>> = {
  "1m": "1분",
  "5m": "5분",
  "15m": "15분",
  "30m": "30분",
  "60m": "60분",
  "4h": "4시간",
  "1d": "일봉",
  "1w": "주봉",
};

interface Scale {
  readonly min: number;
  readonly max: number;
}

const VIEW_WIDTH = 1_000;
const VIEW_HEIGHT = 580;
const PLOT_LEFT = 18;
const PLOT_RIGHT = 890;
const PRICE_AXIS_X = PLOT_RIGHT + 8;
const PRICE_TOP = 18;
const PRICE_BOTTOM = 338;
const TIME_AXIS_Y = 348;
const TIME_LABEL_Y = 366;
const VOLUME_TOP = 395;
const VOLUME_BOTTOM = 558;
const TURNOVER_TOP = VOLUME_TOP;
const TURNOVER_BOTTOM = 558;
const DEFAULT_INTERVALS: readonly ChartInterval[] = [
  "1m",
  "5m",
  "15m",
  "30m",
  "60m",
  "4h",
  "1d",
  "1w",
];
const DEFAULT_RANGES: readonly ChartRange[] = ["1D", "6M", "1Y", "5Y"];
const RANGE_LABELS: Readonly<Record<ChartRange, string>> = {
  "1D": "당일",
  "6M": "6개월",
  "1Y": "1년",
  "5Y": "5년",
};

function finiteNumber(value: string | null): number | null {
  if (value === null || value.trim() === "") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function scaleFor(values: readonly number[], includeZero = false): Scale {
  if (values.length === 0) {
    return { min: 0, max: 1 };
  }
  const rawMin = includeZero ? Math.min(0, ...values) : Math.min(...values);
  const rawMax = Math.max(...values);
  if (rawMin === rawMax) {
    if (includeZero && rawMax === 0) {
      return { min: 0, max: 1 };
    }
    const padding = Math.max(Math.abs(rawMin) * 0.01, 1);
    return { min: rawMin - padding, max: rawMax + padding };
  }
  const padding = includeZero ? 0 : (rawMax - rawMin) * 0.04;
  return { min: rawMin - padding, max: rawMax + padding };
}

function yFor(
  value: number,
  scale: Scale,
  top: number,
  bottom: number,
): number {
  const ratio = (value - scale.min) / (scale.max - scale.min);
  return bottom - ratio * (bottom - top);
}

function movingAverage(
  values: readonly (number | null)[],
  kind: IndicatorKind,
  period: number,
): readonly (number | null)[] {
  const result: (number | null)[] = Array.from(
    { length: values.length },
    () => null,
  );
  if (period < 2 || values.length < period) {
    return result;
  }

  if (kind === "SMA") {
    for (let index = period - 1; index < values.length; index += 1) {
      const window = values.slice(index - period + 1, index + 1);
      if (window.some((value) => value === null)) {
        continue;
      }
      result[index] =
        window.reduce<number>((sum, value) => sum + (value ?? 0), 0) / period;
    }
    return result;
  }

  const seed = values.slice(0, period);
  if (seed.some((value) => value === null)) {
    return result;
  }
  let previous =
    seed.reduce<number>((sum, value) => sum + (value ?? 0), 0) / period;
  result[period - 1] = previous;
  const multiplier = 2 / (period + 1);
  for (let index = period; index < values.length; index += 1) {
    const value = values[index];
    if (value === null || value === undefined) {
      previous = Number.NaN;
      continue;
    }
    if (!Number.isFinite(previous)) {
      const reseed = values.slice(index - period + 1, index + 1);
      if (reseed.some((candidate) => candidate === null)) {
        continue;
      }
      previous =
        reseed.reduce<number>((sum, candidate) => sum + (candidate ?? 0), 0) /
        period;
    } else {
      previous = value * multiplier + previous * (1 - multiplier);
    }
    result[index] = previous;
  }
  return result;
}

function indicatorValues(
  candles: readonly MarketCandleViewModel[],
  indicator: ChartIndicatorViewModel,
): readonly (number | null)[] {
  const values = candles.map((candle) => {
    if (indicator.source === "PRICE") {
      return finiteNumber(candle.close);
    }
    if (indicator.source === "VOLUME") {
      return finiteNumber(candle.volume);
    }
    return finiteNumber(candle.turnover);
  });
  return movingAverage(values, indicator.kind, indicator.period);
}

function pathFor(
  values: readonly (number | null)[],
  xAt: (index: number) => number,
  scale: Scale,
  top: number,
  bottom: number,
): string {
  let path = "";
  let drawing = false;
  values.forEach((value, index) => {
    if (value === null) {
      drawing = false;
      return;
    }
    const command = drawing ? "L" : "M";
    path += `${command}${xAt(index).toFixed(2)},${yFor(value, scale, top, bottom).toFixed(2)} `;
    drawing = true;
  });
  return path.trim();
}

function formatCompact(value: string | null): string {
  const number = finiteNumber(value);
  if (number === null) {
    return "N/A";
  }
  return new Intl.NumberFormat("ko-KR", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(number);
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function indicatorClass(index: number): string {
  return `market-chart__indicator market-chart__indicator--${index % 12}`;
}

function aggregateFillsBySide(fills: readonly PaperFillMarkerViewModel[]) {
  return (["BUY", "SELL"] as const).flatMap((side) => {
    const matching = fills.filter((fill) => fill.side === side);
    if (matching.length === 0) return [];
    let quantity = 0n;
    let principal = 0n;
    for (const fill of matching) {
      if (!/^\d+$/.test(fill.quantity) || !/^\d+$/.test(fill.price)) continue;
      const nextQuantity = BigInt(fill.quantity);
      quantity += nextQuantity;
      principal += nextQuantity * BigInt(fill.price);
    }
    if (quantity <= 0n) return [];
    return [{
      id: `${side}:${matching.map((fill) => fill.id).join(":")}`,
      side,
      quantity: quantity.toString(),
      price: (principal / quantity).toString(),
      count: matching.length,
      partial: matching.some((fill) => fill.completion === "PARTIAL"),
    }];
  });
}

export function MarketChart({
  instrumentId,
  instrumentName,
  currency,
  interval,
  intervals = DEFAULT_INTERVALS,
  range,
  ranges = DEFAULT_RANGES,
  candles,
  indicators,
  fillMarkers,
  currentPrice,
  previousClosePrice,
  freshness,
  marketDataSource = "SYNTHETIC_UI_FIXTURE",
  turnoverQuality = "UNAVAILABLE",
  historyComplete = true,
  onIntervalChange,
  onRangeChange,
  onIndicatorToggle,
  onIndicatorAdd,
}: MarketChartProps) {
  const clipId = `market-chart-${useId().replaceAll(":", "")}`;
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [draftKind, setDraftKind] = useState<IndicatorKind>("SMA");
  const [draftSource, setDraftSource] = useState<IndicatorSource>("PRICE");
  const [draftPeriod, setDraftPeriod] = useState(20);
  const [viewport, setViewport] = useState<ChartViewport | null>(null);
  const dragState = useRef<{
    readonly pointerId: number;
    readonly clientX: number;
    readonly viewport: ChartViewport;
  } | null>(null);
  const chartCanvasRef = useRef<SVGSVGElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    setViewport(null);
    dragState.current = null;
    setIsDragging(false);
  }, [instrumentId, interval, range]);

  const sourceCandles = useMemo(
    () =>
      candles.filter(
        (candle) =>
          finiteNumber(candle.open) !== null &&
          finiteNumber(candle.high) !== null &&
          finiteNumber(candle.low) !== null &&
          finiteNumber(candle.close) !== null,
      ),
    [candles],
  );
  const activeViewport = useMemo(
    () =>
      viewport === null
        ? fullChartViewport(sourceCandles.length)
        : normalizeChartViewport(viewport, sourceCandles.length),
    [sourceCandles.length, viewport],
  );
  useEffect(() => {
    setHoveredIndex(null);
  }, [activeViewport.end, activeViewport.start]);
  const viewportCandles = useMemo(
    () => sourceCandles.slice(activeViewport.start, activeViewport.end),
    [activeViewport.end, activeViewport.start, sourceCandles],
  );
  const viewBuckets = useMemo(
    () =>
      downsampleCandlesForView(
        viewportCandles,
        interval === "1m" ? MAX_RENDERED_ONE_MINUTE_CANDLES : undefined,
      ),
    [interval, viewportCandles],
  );
  const usableCandles = useMemo(
    () =>
      viewBuckets.map(
        (bucket) => bucket.candle as MarketCandleViewModel,
      ),
    [viewBuckets],
  );

  const { plotStart, plotEnd, step, candleWidth } = resolveChartCandleGeometry(
    usableCandles.length,
    PLOT_LEFT,
    PLOT_RIGHT,
  );
  const xAt = (index: number) => plotStart + step * (index + 0.5);
  const timeAxisTickIndexes = chartTimeAxisTickIndexes(
    usableCandles.length,
  );
  const currentPriceValue = finiteNumber(currentPrice);
  const previousCloseValue = finiteNumber(previousClosePrice);
  const isViewingLatest =
    activeViewport.end === sourceCandles.length;
  const visibleTimeRange = useMemo<ChartRange>(() => {
    if (interval !== "1d" && interval !== "1w") return range;
    const first = viewportCandles[0];
    const last = viewportCandles.at(-1);
    if (!first || !last) return range;
    const spanDays =
      (Date.parse(last.openedAt) - Date.parse(first.openedAt)) / 86_400_000;
    if (!Number.isFinite(spanDays)) return range;
    if (spanDays <= 220) return "6M";
    if (spanDays <= 550) return "1Y";
    return "5Y";
  }, [interval, range, viewportCandles]);

  const priceScale = useMemo(() => {
    const candleValues = usableCandles.flatMap((candle) => [
      finiteNumber(candle.low) ?? 0,
      finiteNumber(candle.high) ?? 0,
    ]);
    return scaleFor([
      ...candleValues,
      ...(!isViewingLatest || currentPriceValue === null
        ? []
        : [currentPriceValue]),
      ...(!isViewingLatest || previousCloseValue === null
        ? []
        : [previousCloseValue]),
    ]);
  }, [
    currentPriceValue,
    isViewingLatest,
    previousCloseValue,
    usableCandles,
  ]);
  const currentPriceY =
    currentPriceValue === null || !isViewingLatest
      ? null
      : yFor(currentPriceValue, priceScale, PRICE_TOP, PRICE_BOTTOM);
  const previousCloseY =
    previousCloseValue === null || !isViewingLatest
      ? null
      : yFor(previousCloseValue, priceScale, PRICE_TOP, PRICE_BOTTOM);
  const referenceLabelsOverlap =
    currentPriceY !== null &&
    previousCloseY !== null &&
    Math.abs(currentPriceY - previousCloseY) < 20;
  const referenceLabelY = (value: number, offset: number) =>
    Math.max(PRICE_TOP + 10, Math.min(PRICE_BOTTOM - 10, value + offset));
  const volumeScale = useMemo(
    () =>
      scaleFor(
        usableCandles.flatMap((candle) => {
          const value = finiteNumber(candle.volume);
          return value === null ? [] : [value];
        }),
        true,
      ),
    [usableCandles],
  );
  const turnoverScale = useMemo(
    () =>
      scaleFor(
        usableCandles.flatMap((candle) => {
          const value = finiteNumber(candle.turnover);
          return value === null ? [] : [value];
        }),
        true,
      ),
    [usableCandles],
  );

  const indicatorSeries = useMemo(
    () =>
      indicators
        .map((indicator, index) => ({ indicator, index }))
        .filter(({ indicator }) => indicator.visible)
        .map(({ indicator, index }) => ({
          definition: indicator,
          index,
          sourceValues: indicatorValues(sourceCandles, indicator),
        })),
    [indicators, sourceCandles],
  );
  const visibleIndicators = useMemo(
    () =>
      indicatorSeries.map(({ definition, index, sourceValues }) => ({
        definition,
        index,
        values: viewBuckets.map(
          (bucket) =>
            sourceValues[activeViewport.start + bucket.sourceEndIndex] ??
            null,
        ),
      })),
    [activeViewport.start, indicatorSeries, viewBuckets],
  );

  const fillsByCandle = useMemo(() => {
    const buckets = new Map<number, PaperFillMarkerViewModel[]>();
    if (usableCandles.length === 0) {
      return buckets;
    }
    const bucketRanges = viewBuckets.map((bucket) => {
      const sourceStart =
        sourceCandles[activeViewport.start + bucket.sourceStartIndex];
      const sourceAfterEnd =
        sourceCandles[activeViewport.start + bucket.sourceEndIndex + 1];
      return {
        start: sourceStart ? Date.parse(sourceStart.openedAt) : Number.NaN,
        end: sourceAfterEnd
          ? Date.parse(sourceAfterEnd.openedAt)
          : Number.POSITIVE_INFINITY,
      };
    });
    fillMarkers.forEach((fill) => {
      const fillTime = new Date(fill.filledAt).getTime();
      if (!Number.isFinite(fillTime) || finiteNumber(fill.price) === null) {
        return;
      }
      const containingIndex = bucketRanges.findIndex(
        (candidate) =>
          Number.isFinite(candidate.start) &&
          fillTime >= candidate.start &&
          fillTime < candidate.end,
      );
      if (containingIndex < 0) return;
      const bucket = buckets.get(containingIndex) ?? [];
      bucket.push(fill);
      buckets.set(containingIndex, bucket);
    });
    return buckets;
  }, [
    activeViewport.start,
    fillMarkers,
    sourceCandles,
    usableCandles.length,
    viewBuckets,
  ]);

  const selectedCandle =
    hoveredIndex === null ? null : (usableCandles[hoveredIndex] ?? null);
  const selectedViewBucket =
    hoveredIndex === null ? null : (viewBuckets[hoveredIndex] ?? null);
  const selectedFills =
    hoveredIndex === null ? [] : (fillsByCandle.get(hoveredIndex) ?? []);
  const tooltipFills = selectedFills.slice(0, 3);
  const tooltipHeight =
    108 + tooltipFills.length * 18 + (selectedFills.length > 3 ? 18 : 0);

  const handlePointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (usableCandles.length === 0) {
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const drag = dragState.current;
    if (drag !== null && drag.pointerId === event.pointerId) {
      const visible = drag.viewport.end - drag.viewport.start;
      const deltaPixels = event.clientX - drag.clientX;
      const plotPixelWidth =
        bounds.width * ((plotEnd - plotStart) / VIEW_WIDTH);
      const deltaCandles = -(deltaPixels / plotPixelWidth) * visible;
      setViewport(
        panChartViewport(drag.viewport, sourceCandles.length, deltaCandles),
      );
    }
    const svgX = ((event.clientX - bounds.left) / bounds.width) * VIEW_WIDTH;
    if (svgX < plotStart || svgX > plotEnd) {
      setHoveredIndex(null);
      return;
    }
    const index = Math.max(
      0,
      Math.min(usableCandles.length - 1, Math.floor((svgX - plotStart) / step)),
    );
    setHoveredIndex(index);
  };

  const handlePointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (
      event.button !== 0 ||
      !event.isPrimary ||
      sourceCandles.length === 0
    ) {
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const svgX = ((event.clientX - bounds.left) / bounds.width) * VIEW_WIDTH;
    const svgY = ((event.clientY - bounds.top) / bounds.height) * VIEW_HEIGHT;
    if (
      svgX < plotStart ||
      svgX > plotEnd ||
      svgY < PRICE_TOP ||
      svgY > TURNOVER_BOTTOM
    ) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    dragState.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      viewport: activeViewport,
    };
    setIsDragging(true);
  };

  const handlePointerUp = (event: PointerEvent<SVGSVGElement>) => {
    if (dragState.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragState.current = null;
    setIsDragging(false);
  };

  const handleWheel = (event: globalThis.WheelEvent) => {
    if (event.deltaY === 0) return;
    // The complete chart surface owns the wheel gesture.  In particular, a
    // short series is right-aligned, so limiting this to the occupied candle
    // area lets the same gesture scroll the surrounding workspace.
    event.preventDefault();
    event.stopPropagation();
    if (sourceCandles.length === 0) return;
    const bounds = chartCanvasRef.current?.getBoundingClientRect();
    if (!bounds) return;
    if (bounds.width <= 0 || bounds.height <= 0) return;
    const svgX = ((event.clientX - bounds.left) / bounds.width) * VIEW_WIDTH;
    const anchorRatio = Math.max(
      0,
      Math.min(1, (svgX - PLOT_LEFT) / (PLOT_RIGHT - PLOT_LEFT)),
    );
    setViewport((current) =>
      zoomChartViewport(
        current === null
          ? fullChartViewport(sourceCandles.length)
          : normalizeChartViewport(current, sourceCandles.length),
        sourceCandles.length,
        anchorRatio,
        event.deltaY < 0 ? "IN" : "OUT",
      ),
    );
  };

  useEffect(() => {
    const canvas = chartCanvasRef.current;
    if (!canvas) return;
    const listener = (event: globalThis.WheelEvent) => handleWheel(event);
    canvas.addEventListener("wheel", listener, { passive: false });
    return () => canvas.removeEventListener("wheel", listener);
  });

  const handleChartKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (usableCandles.length === 0) {
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      if (event.key === "+" || event.key === "=" || event.key === "-") {
        event.preventDefault();
        setViewport((current) =>
          zoomChartViewport(
            current === null
              ? fullChartViewport(sourceCandles.length)
              : normalizeChartViewport(current, sourceCandles.length),
            sourceCandles.length,
            0.5,
            event.key === "-" ? "OUT" : "IN",
          ),
        );
      }
      return;
    }
    event.preventDefault();
    if (event.shiftKey) {
      const visible = activeViewport.end - activeViewport.start;
      setViewport(
        panChartViewport(
          activeViewport,
          sourceCandles.length,
          (event.key === "ArrowLeft" ? -1 : 1) *
            Math.max(1, Math.round(visible * 0.1)),
        ),
      );
      return;
    }
    const direction = event.key === "ArrowLeft" ? -1 : 1;
    const current = hoveredIndex ?? usableCandles.length - 1;
    setHoveredIndex(
      Math.max(0, Math.min(usableCandles.length - 1, current + direction)),
    );
  };

  const handlePeriodChange = (event: ChangeEvent<HTMLInputElement>) => {
    const period = Number(event.currentTarget.value);
    setDraftPeriod(Number.isFinite(period) ? period : 2);
  };

  const duplicateIndicator = indicators.some(
    (indicator) =>
      indicator.kind === draftKind &&
      indicator.source === draftSource &&
      indicator.period === draftPeriod,
  );
  const canAddIndicator =
    draftPeriod >= 2 &&
    draftPeriod <= 500 &&
    indicators.length < 12 &&
    !duplicateIndicator;

  return (
    <section
      className="market-chart"
      aria-label={`${instrumentName} 종목 차트`}
      data-instrument-id={instrumentId}
    >
      <header className="market-chart__header">
        <div className="market-chart__identity">
          <strong>{instrumentName}</strong>
          <span>{instrumentId}</span>
          <span
            className={`market-chart__freshness market-chart__freshness--${freshness.toLowerCase()}`}
          >
            {freshness}
          </span>
        </div>
        <div className="market-chart__toolbar">
          <div
            className="market-chart__intervals"
            role="group"
            aria-label="차트 봉 주기"
          >
            {intervals.map((candidate) => (
              <button
                key={candidate}
                className="market-chart__control"
                aria-pressed={candidate === interval}
                type="button"
                onClick={() => onIntervalChange(candidate)}
              >
                {INTERVAL_LABELS[candidate]}
              </button>
            ))}
          </div>
          <div
            className="market-chart__ranges"
            role="group"
            aria-label="차트 조회 기간"
          >
            {ranges.map((candidate) => (
              <button
                key={candidate}
                className="market-chart__control"
                aria-pressed={candidate === range}
                type="button"
                onClick={() => onRangeChange(candidate)}
              >
                {RANGE_LABELS[candidate]}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="market-chart__indicator-toolbar">
        <div
          className="market-chart__indicator-list"
          aria-label="이동평균선 표시 설정"
        >
          {indicators.map((indicator, index) => (
            <label
              key={indicator.id}
              className="market-chart__indicator-toggle"
            >
              <input
                type="checkbox"
                checked={indicator.visible}
                onChange={(event) =>
                  onIndicatorToggle(indicator.id, event.currentTarget.checked)
                }
              />
              <span
                className={`market-chart__indicator-key market-chart__indicator-key--${index % 12}`}
                aria-hidden="true"
              />
              {indicator.source} {indicator.kind} {indicator.period}
            </label>
          ))}
        </div>
        <details className="market-chart__indicator-settings">
          <summary>이평선 설정</summary>
          <div className="market-chart__indicator-form">
            <label>
              기준
              <select
                value={draftSource}
                onChange={(event) =>
                  setDraftSource(event.currentTarget.value as IndicatorSource)
                }
              >
                <option value="PRICE">가격</option>
                <option value="VOLUME">거래량</option>
                <option value="TURNOVER">거래대금</option>
              </select>
            </label>
            <label>
              방식
              <select
                value={draftKind}
                onChange={(event) =>
                  setDraftKind(event.currentTarget.value as IndicatorKind)
                }
              >
                <option value="SMA">SMA</option>
                <option value="EMA">EMA</option>
              </select>
            </label>
            <label>
              기간
              <input
                type="number"
                min={2}
                max={500}
                value={draftPeriod}
                onChange={handlePeriodChange}
              />
            </label>
            <button
              className="market-chart__control"
              type="button"
              disabled={!canAddIndicator}
              onClick={() =>
                onIndicatorAdd({
                  kind: draftKind,
                  source: draftSource,
                  period: draftPeriod,
                })
              }
            >
              추가
            </button>
            {duplicateIndicator ? (
              <span className="market-chart__validation">
                동일한 이평선이 이미 있습니다.
              </span>
            ) : null}
          </div>
        </details>
      </div>

      <div
        className="market-chart__source-legend"
        role="status"
        aria-live="polite"
      >
        <span>시장 데이터 · {marketDataSource}</span>
        <span>체결 마커 · LOCAL_PAPER_FILL</span>
        {viewportCandles.length > usableCandles.length ? (
          <span>
            시각 집계 · 보이는 원본{" "}
            {viewportCandles.length.toLocaleString("ko-KR")}봉 / 표시{" "}
            {usableCandles.length.toLocaleString("ko-KR")} 버킷
          </span>
        ) : null}
        {sourceCandles.length > 0 ? (
          <span>
            로드 {sourceCandles.length.toLocaleString("ko-KR")}봉 · 표시{" "}
            {activeViewport.start + 1}–
            {activeViewport.end.toLocaleString("ko-KR")}
          </span>
        ) : null}
        <span>
          과거 경계 · {historyComplete ? "요청 범위 조회 완료" : "부분 조회"}
        </span>
        <span>휠 확대·축소 · 드래그 과거 이동</span>
        {viewport !== null ? (
          <button type="button" onClick={() => setViewport(null)}>
            전체 보기
          </button>
        ) : null}
      </div>

      {usableCandles.length === 0 ? (
        <div className="market-chart__empty" role="status">
          표시할 차트 데이터가 없습니다.
        </div>
      ) : (
        <svg
          ref={chartCanvasRef}
          className="market-chart__canvas"
          data-dragging={isDragging ? "true" : "false"}
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
          role="img"
          aria-label={`${instrumentName} ${interval} OHLC 차트. 원본 ${sourceCandles.length}봉 중 ${usableCandles.length}개 시각 버킷, 거래량${turnoverQuality === "UNAVAILABLE" ? "" : "·거래대금"} 봉 패널, 로컬 모의 체결 마커 포함`}
          tabIndex={0}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onLostPointerCapture={() => {
            dragState.current = null;
            setIsDragging(false);
          }}
          onPointerLeave={() => {
            if (!isDragging) setHoveredIndex(null);
          }}
          onKeyDown={handleChartKeyDown}
        >
          <defs>
            <clipPath id={clipId}>
              <rect
                x={PLOT_LEFT}
                y={PRICE_TOP}
                width={PLOT_RIGHT - PLOT_LEFT}
                height={TURNOVER_BOTTOM - PRICE_TOP}
              />
            </clipPath>
          </defs>

          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const y = PRICE_TOP + (PRICE_BOTTOM - PRICE_TOP) * ratio;
            const value =
              priceScale.max - (priceScale.max - priceScale.min) * ratio;
            return (
              <g key={`price-grid-${ratio}`}>
                <line
                  className="market-chart__grid"
                  x1={PLOT_LEFT}
                  x2={PLOT_RIGHT}
                  y1={y}
                  y2={y}
                />
                <text
                  className="market-chart__axis-label"
                  x={PRICE_AXIS_X}
                  y={y + 3}
                  textAnchor="start"
                >
                  {currency === "USD" ? truncateUsPriceNumber(value) : value.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}
                </text>
              </g>
            );
          })}

          {previousCloseY !== null && previousCloseValue !== null ? (
            <g
              className="market-chart__reference market-chart__reference--close"
              aria-label={`전일 종가 ${currency === "USD" ? truncateUsPrice(previousClosePrice ?? "") : previousCloseValue.toLocaleString("ko-KR")}`}
            >
              <line
                x1={PLOT_LEFT}
                x2={PLOT_RIGHT}
                y1={previousCloseY}
                y2={previousCloseY}
              />
              <rect
                x={PLOT_RIGHT + 3}
                y={
                  referenceLabelY(
                    previousCloseY,
                    referenceLabelsOverlap ? 9 : 0,
                  ) - 9
                }
                width={VIEW_WIDTH - PLOT_RIGHT - 5}
                height={18}
                rx={3}
              />
              <text
                x={PRICE_AXIS_X}
                y={
                  referenceLabelY(
                    previousCloseY,
                    referenceLabelsOverlap ? 9 : 0,
                  ) + 3
                }
              >
                전일 종가 {currency === "USD" ? truncateUsPrice(previousClosePrice ?? "") : previousCloseValue.toLocaleString("ko-KR")}
              </text>
            </g>
          ) : null}

          {currentPriceY !== null && currentPriceValue !== null ? (
            <g
              className="market-chart__reference market-chart__reference--current"
              aria-label={`${freshness === "LIVE" ? "현재가" : "마지막 가격"} ${currency === "USD" ? truncateUsPrice(currentPrice ?? "") : currentPriceValue.toLocaleString("ko-KR")}`}
            >
              <line
                x1={PLOT_LEFT}
                x2={PLOT_RIGHT}
                y1={currentPriceY}
                y2={currentPriceY}
              />
              <rect
                x={PLOT_RIGHT + 3}
                y={
                  referenceLabelY(
                    currentPriceY,
                    referenceLabelsOverlap ? -9 : 0,
                  ) - 9
                }
                width={VIEW_WIDTH - PLOT_RIGHT - 5}
                height={18}
                rx={3}
              />
              <text
                x={PRICE_AXIS_X}
                y={
                  referenceLabelY(
                    currentPriceY,
                    referenceLabelsOverlap ? -9 : 0,
                  ) + 3
                }
              >
                {freshness === "LIVE" ? "현재가" : "마지막"}{" "}
                {currency === "USD" ? truncateUsPrice(currentPrice ?? "") : currentPriceValue.toLocaleString("ko-KR")}
              </text>
            </g>
          ) : null}

          <g
            className="market-chart__time-axis"
            aria-label="봉 시간축"
          >
            <line
              className="market-chart__time-axis-line"
              x1={PLOT_LEFT}
              x2={PLOT_RIGHT}
              y1={TIME_AXIS_Y}
              y2={TIME_AXIS_Y}
            />
            {usableCandles.map((candle, index) => (
              <line
                className="market-chart__time-axis-minor"
                key={`time-minor-${candle.id}`}
                x1={xAt(index)}
                x2={xAt(index)}
                y1={TIME_AXIS_Y}
                y2={TIME_AXIS_Y + 3}
              />
            ))}
            {timeAxisTickIndexes.map((index, tickIndex) => {
              const candle = usableCandles[index]!;
              return (
                <g key={`time-label-${candle.id}`}>
                  <line
                    className="market-chart__time-axis-tick"
                    x1={xAt(index)}
                    x2={xAt(index)}
                    y1={TIME_AXIS_Y}
                    y2={TIME_AXIS_Y + 6}
                  />
                  <text
                    className="market-chart__time-axis-label"
                    x={xAt(index)}
                    y={TIME_LABEL_Y}
                    textAnchor={
                      tickIndex === 0
                        ? "start"
                        : tickIndex === timeAxisTickIndexes.length - 1
                          ? "end"
                          : "middle"
                    }
                  >
                    {formatChartTimeAxisLabel(
                      candle.openedAt,
                      interval,
                      visibleTimeRange,
                    )}
                  </text>
                </g>
              );
            })}
          </g>

          <text
            className="market-chart__panel-label"
            x={PLOT_LEFT}
            y={VOLUME_TOP - 7}
          >
            {turnoverQuality === "UNAVAILABLE"
              ? "거래량(방향색) · 분봉 거래대금 KIS 미제공"
              : "거래량(방향색) · 거래대금(보라) · 독립 정규화"}
          </text>
          <text
            className="market-chart__panel-label"
            x={PLOT_RIGHT}
            y={VOLUME_TOP - 7}
            textAnchor="end"
          >
            봉별 실제값은 툴팁
          </text>
          <line
            className="market-chart__divider"
            x1={PLOT_LEFT}
            x2={PLOT_RIGHT}
            y1={TURNOVER_BOTTOM}
            y2={TURNOVER_BOTTOM}
          />

          <g clipPath={`url(#${clipId})`}>
            {usableCandles.map((candle, index) => {
              const open = finiteNumber(candle.open) ?? 0;
              const high = finiteNumber(candle.high) ?? 0;
              const low = finiteNumber(candle.low) ?? 0;
              const close = finiteNumber(candle.close) ?? 0;
              const volume = finiteNumber(candle.volume);
              const turnover = finiteNumber(candle.turnover);
              const x = xAt(index);
              const top = yFor(
                Math.max(open, close),
                priceScale,
                PRICE_TOP,
                PRICE_BOTTOM,
              );
              const bottom = yFor(
                Math.min(open, close),
                priceScale,
                PRICE_TOP,
                PRICE_BOTTOM,
              );
              const direction =
                close > open ? "positive" : close < open ? "negative" : "flat";
              return (
                <g
                  key={candle.id}
                  className={`market-chart__candle market-chart__candle--${direction}`}
                  aria-label={`${formatTimestamp(candle.openedAt)} 시가 ${candle.open}, 고가 ${candle.high}, 저가 ${candle.low}, 종가 ${candle.close}${candle.forming === true ? ", 진행 중인 봉" : ""}`}
                >
                  <line
                    className="market-chart__wick"
                    x1={x}
                    x2={x}
                    y1={yFor(high, priceScale, PRICE_TOP, PRICE_BOTTOM)}
                    y2={yFor(low, priceScale, PRICE_TOP, PRICE_BOTTOM)}
                  />
                  <rect
                    className="market-chart__body"
                    x={x - candleWidth / 2}
                    y={top}
                    width={candleWidth}
                    height={Math.max(1.5, bottom - top)}
                  />
                  {volume !== null ? (
                    <rect
                      className="market-chart__volume-bar"
                      x={x - candleWidth / 2}
                      y={yFor(volume, volumeScale, VOLUME_TOP, VOLUME_BOTTOM)}
                      width={candleWidth}
                      height={
                        VOLUME_BOTTOM -
                        yFor(volume, volumeScale, VOLUME_TOP, VOLUME_BOTTOM)
                      }
                    />
                  ) : null}
                  {turnover !== null ? (
                    <rect
                      className="market-chart__turnover-bar"
                      x={x - candleWidth * 0.22}
                      y={yFor(
                        turnover,
                        turnoverScale,
                        TURNOVER_TOP,
                        TURNOVER_BOTTOM,
                      )}
                      width={Math.max(1, candleWidth * 0.44)}
                      height={
                        TURNOVER_BOTTOM -
                        yFor(
                          turnover,
                          turnoverScale,
                          TURNOVER_TOP,
                          TURNOVER_BOTTOM,
                        )
                      }
                    />
                  ) : null}
                </g>
              );
            })}

            {visibleIndicators.map(({ definition, index, values }) => {
              const scale =
                definition.source === "PRICE"
                  ? priceScale
                  : definition.source === "VOLUME"
                    ? volumeScale
                    : turnoverScale;
              const top =
                definition.source === "PRICE"
                  ? PRICE_TOP
                  : definition.source === "VOLUME"
                    ? VOLUME_TOP
                    : TURNOVER_TOP;
              const bottom =
                definition.source === "PRICE"
                  ? PRICE_BOTTOM
                  : definition.source === "VOLUME"
                    ? VOLUME_BOTTOM
                    : TURNOVER_BOTTOM;
              return (
                <path
                  key={definition.id}
                  className={indicatorClass(index)}
                  d={pathFor(values, xAt, scale, top, bottom)}
                  aria-label={`${definition.source} ${definition.kind} ${definition.period}`}
                />
              );
            })}

            {Array.from(fillsByCandle.entries()).flatMap(
              ([candleIndex, fills]) =>
                aggregateFillsBySide(fills).map((fill) => {
                  const price = finiteNumber(fill.price);
                  if (price === null) {
                    return null;
                  }
                  const x = xAt(candleIndex) + (fill.side === "BUY" ? -4 : 4);
                  const rawY = yFor(price, priceScale, PRICE_TOP, PRICE_BOTTOM);
                  const isBuy = fill.side === "BUY";
                  const y = Math.max(PRICE_TOP + 10, Math.min(PRICE_BOTTOM - 10, rawY + (isBuy ? 9 : -9)));
                  return (
                    <g
                      key={fill.id}
                      className={`market-chart__fill market-chart__fill--${fill.side.toLowerCase()}${fill.partial ? " market-chart__fill--partial" : ""}`}
                      aria-label={`${isBuy ? "매수" : "매도"} ${fill.count}건, 합계 ${fill.quantity}주, 평균 ${fill.price} ${currency}`}
                    >
                      <title>{`${isBuy ? "매수" : "매도"} ${fill.count}건 · ${fill.quantity}주 · 평균 ${fill.price} ${currency}`}</title>
                      <path
                        className="market-chart__fill-shape"
                        d={
                          isBuy
                            ? `M${x},${y - 7} L${x - 6},${y + 5} L${x + 6},${y + 5} Z`
                            : `M${x},${y + 7} L${x - 6},${y - 5} L${x + 6},${y - 5} Z`
                        }
                      />
                    </g>
                  );
                }),
            )}
          </g>

          {selectedCandle !== null && hoveredIndex !== null ? (
            <g className="market-chart__crosshair" pointerEvents="none">
              <line
                x1={xAt(hoveredIndex)}
                x2={xAt(hoveredIndex)}
                y1={PRICE_TOP}
                y2={TURNOVER_BOTTOM}
              />
              <circle
                cx={xAt(hoveredIndex)}
                cy={yFor(
                  finiteNumber(selectedCandle.close) ?? 0,
                  priceScale,
                  PRICE_TOP,
                  PRICE_BOTTOM,
                )}
                r={3.5}
              />
              <g
                className="market-chart__tooltip"
                transform={`translate(${xAt(hoveredIndex) > VIEW_WIDTH * 0.68 ? xAt(hoveredIndex) - 230 : xAt(hoveredIndex) + 12},${PRICE_TOP + 10})`}
              >
                <rect width={218} height={tooltipHeight} />
                <text x={10} y={18}>
                  {formatTimestamp(selectedCandle.openedAt)}
                  {selectedViewBucket !== null &&
                  selectedViewBucket.sourceEndIndex >
                    selectedViewBucket.sourceStartIndex
                    ? ` · ${selectedViewBucket.sourceEndIndex - selectedViewBucket.sourceStartIndex + 1}봉 집계`
                    : ""}
                </text>
                <text x={10} y={38}>
                  O {currency === "USD" ? truncateUsPrice(selectedCandle.open) : selectedCandle.open} · H {currency === "USD" ? truncateUsPrice(selectedCandle.high) : selectedCandle.high}
                </text>
                <text x={10} y={58}>
                  L {currency === "USD" ? truncateUsPrice(selectedCandle.low) : selectedCandle.low} · C {currency === "USD" ? truncateUsPrice(selectedCandle.close) : selectedCandle.close} {currency}
                </text>
                <text x={10} y={78}>
                  거래량 {formatCompact(selectedCandle.volume)}
                </text>
                <text x={10} y={98}>
                  거래대금 {formatCompact(selectedCandle.turnover)}
                </text>
                {tooltipFills.map((fill, index) => (
                  <text key={fill.id} x={10} y={118 + index * 18}>
                    {fill.side === "BUY" ? "매수" : "매도"}
                    {fill.completion === "PARTIAL" ? "·부분" : "·전량"}{" "}
                    {fill.quantity} @ {fill.price} · {fill.orderId}
                  </text>
                ))}
                {selectedFills.length > 3 ? (
                  <text x={10} y={118 + tooltipFills.length * 18}>
                    외 {selectedFills.length - 3}건
                  </text>
                ) : null}
              </g>
            </g>
          ) : null}
        </svg>
      )}
    </section>
  );
}
