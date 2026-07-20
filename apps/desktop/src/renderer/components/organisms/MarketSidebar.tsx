import { Button } from "../atoms";
import { InstrumentRow } from "../molecules";
import type { InstrumentRowModel } from "../molecules";

export interface MarketSidebarProps {
  markets: readonly string[];
  selectedMarket: string;
  instruments: readonly InstrumentRowModel[];
  onMarketChange: (market: string) => void;
  onInstrumentSelect: (instrumentId: string) => void;
}

export function MarketSidebar({
  markets,
  selectedMarket,
  instruments,
  onMarketChange,
  onInstrumentSelect,
}: MarketSidebarProps) {
  return (
    <aside className="pt-market-sidebar" aria-label="시장 종목 탐색">
      <div className="pt-market-sidebar__heading">
        <div>
          <p className="pt-eyebrow">MARKET PULSE</p>
          <h2>관심 종목</h2>
        </div>
        <span className="pt-market-sidebar__count">{instruments.length}</span>
      </div>

      <div
        className="pt-market-sidebar__markets"
        role="group"
        aria-label="시장 선택"
      >
        {markets.map((market) => (
          <Button
            key={market}
            size="compact"
            tone={market === selectedMarket ? "primary" : "ghost"}
            onClick={() => onMarketChange(market)}
            aria-pressed={market === selectedMarket}
          >
            {market}
          </Button>
        ))}
      </div>

      <div className="pt-market-sidebar__list" role="list">
        {instruments.map((item) => (
          <div role="listitem" key={item.instrumentId}>
            <InstrumentRow item={item} onSelect={onInstrumentSelect} />
          </div>
        ))}
      </div>
      {instruments.length === 0 ? (
        <p className="pt-panel__empty" role="status">
          실제 관심종목 데이터 연결 대기
        </p>
      ) : null}
    </aside>
  );
}
