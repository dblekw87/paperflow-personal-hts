import type { PriceDirection } from "../atoms";
import { Badge, PriceText } from "../atoms";

export interface MetricProps {
  label: string;
  value: string;
  direction?: PriceDirection;
  subValue?: string;
  quality?: "live" | "delayed" | "stale" | "closed";
  compact?: boolean;
  hideDirectionIcon?: boolean;
}

const qualityLabel = {
  live: "실시간",
  delayed: "지연",
  stale: "오래됨",
  closed: "장 마감",
} as const;

export function Metric({
  label,
  value,
  direction = "flat",
  subValue,
  quality,
  compact = false,
  hideDirectionIcon = true,
}: MetricProps) {
  return (
    <dl className={`pt-metric${compact ? " pt-metric--compact" : ""}`}>
      <dt>{label}</dt>
      <dd>
        <PriceText
          value={value}
          direction={direction}
          emphasis="strong"
          hideDirectionIcon={hideDirectionIcon}
        />
        {subValue ? <small>{subValue}</small> : null}
        {quality ? (
          <Badge
            tone={
              quality === "live"
                ? "success"
                : quality === "stale"
                  ? "warning"
                  : "neutral"
            }
          >
            {qualityLabel[quality]}
          </Badge>
        ) : null}
      </dd>
    </dl>
  );
}
