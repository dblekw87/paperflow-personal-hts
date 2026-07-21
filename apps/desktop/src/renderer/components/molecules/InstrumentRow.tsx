import { Badge, PriceText } from "../atoms";
import type { PriceDirection } from "../atoms";

export interface InstrumentRowModel {
  instrumentId: string;
  symbol: string;
  name: string;
  market: string;
  price: string;
  changeRate: string;
  direction: PriceDirection;
  turnover?: string;
  selected?: boolean;
  freshness?: "live" | "delayed" | "stale";
}

export interface InstrumentRowProps {
  item: InstrumentRowModel;
  onSelect: (instrumentId: string) => void;
}

export function InstrumentRow({ item, onSelect }: InstrumentRowProps) {
  return (
    <button
      type="button"
      className={`pt-instrument-row${item.selected ? " pt-instrument-row--selected" : ""}`}
      onClick={() => onSelect(item.instrumentId)}
      aria-current={item.selected ? "true" : undefined}
    >
      <span className="pt-instrument-row__identity">
        <strong>{item.name}</strong>
        <span>
          {item.symbol} · {item.market}
        </span>
      </span>
      <span className="pt-instrument-row__price">
        <PriceText
          value={item.price}
          direction={item.direction}
          hideDirectionIcon
        />
        <PriceText
          value={item.changeRate}
          direction={item.direction}
          suffix="%"
          hideDirectionIcon
        />
      </span>
      {item.turnover ? (
        <span className="pt-instrument-row__turnover">
          거래대금 {item.turnover}
        </span>
      ) : null}
      {item.freshness && item.freshness !== "live" ? (
        <Badge tone="warning">
          {item.freshness === "delayed" ? "지연" : "오래됨"}
        </Badge>
      ) : null}
    </button>
  );
}
