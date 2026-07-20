export type ChartTimeAxisInterval =
  | "1m"
  | "5m"
  | "15m"
  | "30m"
  | "60m"
  | "4h"
  | "1d"
  | "1w";

export type ChartTimeAxisRange = "1D" | "6M" | "1Y" | "5Y";

export function chartTimeAxisTickIndexes(
  candleCount: number,
  maxLabels = 8,
): readonly number[] {
  if (candleCount <= 0 || maxLabels <= 0) return [];
  if (candleCount <= maxLabels) {
    return Array.from({ length: candleCount }, (_, index) => index);
  }
  const indexes = new Set<number>();
  for (let tick = 0; tick < maxLabels; tick += 1) {
    indexes.add(
      Math.round((tick * (candleCount - 1)) / (maxLabels - 1)),
    );
  }
  return [...indexes].sort((left, right) => left - right);
}

export function formatChartTimeAxisLabel(
  value: string,
  interval: ChartTimeAxisInterval,
  range: ChartTimeAxisRange,
): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const options: Intl.DateTimeFormatOptions =
    interval !== "1d" && interval !== "1w"
      ? {
          timeZone: "Asia/Seoul",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }
      : range === "6M"
        ? {
            timeZone: "Asia/Seoul",
            month: "2-digit",
            day: "2-digit",
          }
        : range === "1Y"
          ? {
              timeZone: "Asia/Seoul",
              year: "2-digit",
              month: "2-digit",
            }
          : {
              timeZone: "Asia/Seoul",
              year: "numeric",
            };
  return new Intl.DateTimeFormat("ko-KR", options).format(date);
}
