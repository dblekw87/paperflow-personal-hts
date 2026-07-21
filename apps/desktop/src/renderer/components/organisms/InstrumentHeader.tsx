import { Badge, IconButton, PriceText } from "../atoms";
import type { PriceDirection } from "../atoms";
import { Metric, Status } from "../molecules";
import type { StatusProps } from "../molecules";

export interface HeaderMetric {
  label: string;
  value: string;
  subValue?: string;
  direction?: PriceDirection;
}

export interface InstrumentHeaderProps {
  name: string;
  symbol: string;
  market: string;
  currency: string;
  price: string;
  change: string;
  changeRate: string;
  direction: PriceDirection;
  sessionLabel: string;
  asOfLabel: string;
  status: StatusProps["state"];
  metrics: readonly HeaderMetric[];
  watched: boolean;
  onToggleWatch: () => void;
}

export function InstrumentHeader({
  name,
  symbol,
  market,
  currency,
  price,
  change,
  changeRate,
  direction,
  sessionLabel,
  asOfLabel,
  status,
  metrics,
  watched,
  onToggleWatch,
}: InstrumentHeaderProps) {
  const visibleMetrics = metrics.filter(
    (metric) => metric.value.trim() !== "" && metric.value !== "—",
  );
  return (
    <header className="pt-instrument-header">
      <div className="pt-instrument-header__identity">
        <IconButton
          icon={watched ? "★" : "☆"}
          label={watched ? "관심 종목에서 제거" : "관심 종목에 추가"}
          pressed={watched}
          onClick={onToggleWatch}
        />
        <div>
          <div className="pt-instrument-header__title">
            <h1>{name}</h1>
            <Badge>{market}</Badge>
          </div>
          <p>
            {symbol} · {currency}
          </p>
        </div>
      </div>

      <div
        className="pt-instrument-header__quote"
        aria-live="polite"
        aria-atomic="true"
      >
        <PriceText
          value={price}
          direction={direction}
          emphasis="strong"
          hideDirectionIcon
        />
        <PriceText
          value={`${change} (${changeRate}%)`}
          direction={direction}
          accessibleLabel={`${change} ${changeRate} 퍼센트`}
        />
      </div>

      <div className="pt-instrument-header__metrics">
        {visibleMetrics.map((metric) => (
          <Metric
            key={metric.label}
            label={metric.label}
            value={metric.value}
            compact
            {...(metric.subValue === undefined
              ? {}
              : { subValue: metric.subValue })}
            {...(metric.direction === undefined
              ? {}
              : { direction: metric.direction })}
          />
        ))}
      </div>

      <div className="pt-instrument-header__session">
        <Status
          label={sessionLabel}
          state={status}
          detail={`기준 ${asOfLabel}`}
        />
        <span>{asOfLabel}</span>
      </div>
    </header>
  );
}
