export type DomesticEquityMarket = "KOSPI" | "KOSDAQ";
export type DomesticSecurityType = "STOCK" | "ETF" | "ETN" | "OTHER";

export interface ReferencePriceLevel {
  readonly price: string;
  readonly quantity: "—";
  readonly changeRate: string;
  readonly direction: "positive" | "negative" | "flat";
  readonly depthBand: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
}

function stockTickSize(price: number, market: DomesticEquityMarket): number {
  if (price < 1_000) return 1;
  if (price < 5_000) return 5;
  if (price < 10_000) return 10;
  if (price < 50_000) return 50;
  if (price < 100_000) return 100;
  if (price < 500_000) return market === "KOSPI" ? 500 : 100;
  return market === "KOSPI" ? 1_000 : 100;
}

function alignedPrice(value: number, market: DomesticEquityMarket): number {
  const tick = stockTickSize(value, market);
  return Math.max(tick, Math.floor(value / tick) * tick);
}

function nextPrice(value: number, market: DomesticEquityMarket): number {
  const candidate = value + 1;
  const nextTick = stockTickSize(candidate, market);
  return Math.ceil(candidate / nextTick) * nextTick;
}

function previousPrice(value: number, market: DomesticEquityMarket): number {
  const candidate = Math.max(1, value - 1);
  const tick = stockTickSize(candidate, market);
  return Math.max(tick, Math.floor(candidate / tick) * tick);
}

function directionFor(price: number, previousClose: number | null) {
  if (previousClose === null || price === previousClose) return "flat" as const;
  return price > previousClose ? ("positive" as const) : ("negative" as const);
}

function changeRateFor(price: number, previousClose: number | null): string {
  if (previousClose === null || previousClose <= 0) return "—";
  return Math.abs(((price - previousClose) / previousClose) * 100).toFixed(2);
}

export function buildReferencePriceLadder(options: {
  readonly anchorPrice: string | null;
  readonly previousClosePrice: string | null;
  readonly market: DomesticEquityMarket | null;
  readonly securityType: DomesticSecurityType | null;
}): {
  readonly asks: readonly ReferencePriceLevel[];
  readonly bids: readonly ReferencePriceLevel[];
} {
  const anchor = Number(options.anchorPrice);
  const previousClose = Number(options.previousClosePrice);
  if (
    options.market === null ||
    options.securityType !== "STOCK" ||
    !Number.isFinite(anchor) ||
    anchor <= 0
  ) {
    return { asks: [], bids: [] };
  }

  const baseline = alignedPrice(anchor, options.market);
  const referenceClose =
    Number.isFinite(previousClose) && previousClose > 0 ? previousClose : null;
  const asks: ReferencePriceLevel[] = [];
  const bids: ReferencePriceLevel[] = [];
  let ask = baseline;
  let bid = baseline;

  for (let index = 0; index < 10; index += 1) {
    ask = nextPrice(ask, options.market);
    bid = previousPrice(bid, options.market);
    const depthBand = (index + 1) as ReferencePriceLevel["depthBand"];
    asks.push({
      price: ask.toLocaleString("ko-KR"),
      quantity: "—",
      changeRate: changeRateFor(ask, referenceClose),
      direction: directionFor(ask, referenceClose),
      depthBand,
    });
    bids.push({
      price: bid.toLocaleString("ko-KR"),
      quantity: "—",
      changeRate: changeRateFor(bid, referenceClose),
      direction: directionFor(bid, referenceClose),
      depthBand,
    });
  }

  return { asks: asks.reverse(), bids };
}
