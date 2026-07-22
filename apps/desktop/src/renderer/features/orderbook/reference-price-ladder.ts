export type DomesticEquityMarket = "KOSPI" | "KOSDAQ";
export type DomesticSecurityType = "STOCK" | "ETF" | "ETN" | "OTHER";

export interface ReferencePriceLevel {
  readonly price: string;
  readonly quantity: string;
  readonly changeRate: string;
  readonly direction: "positive" | "negative" | "flat";
  readonly depthBand: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
  readonly referenceOnly?: boolean;
}

function usdCents(value: string): bigint | null {
  const match = /^(\d+)(?:\.(\d{1,4}))?$/.exec(value.trim());
  if (!match) return null;
  const fraction = (match[2] ?? "").padEnd(4, "0").slice(0, 4);
  const tenThousandths = BigInt(match[1] ?? "0") * 10_000n + BigInt(fraction || "0");
  // US NMS stocks at or above $1 normally quote in $0.01 increments.
  return (tenThousandths + 99n) / 100n;
}

function formatUsdCents(value: bigint): string {
  return `${value / 100n}.${String(value % 100n).padStart(2, "0")}`;
}

export function buildUsOneLevelPriceLadder(options: {
  readonly bestAskPrice: string | null;
  readonly bestAskQuantity: string | null;
  readonly bestBidPrice: string | null;
  readonly bestBidQuantity: string | null;
  readonly previousClosePrice: string | null;
}): { readonly asks: readonly ReferencePriceLevel[]; readonly bids: readonly ReferencePriceLevel[] } {
  const ask = options.bestAskPrice === null ? null : usdCents(options.bestAskPrice);
  const bid = options.bestBidPrice === null ? null : usdCents(options.bestBidPrice);
  const previousClose = Number(options.previousClosePrice);
  const close = Number.isFinite(previousClose) && previousClose > 0 ? previousClose : null;
  if (ask === null || bid === null || ask <= 0n || bid <= 0n) return { asks: [], bids: [] };
  const asks = Array.from({ length: 10 }, (_, index) => {
    const cents = ask + BigInt(index);
    const price = formatUsdCents(cents);
    return { price, quantity: index === 0 ? (options.bestAskQuantity ?? "—") : "—",
      changeRate: changeRateFor(Number(price), close), direction: directionFor(Number(price), close),
      depthBand: (index + 1) as ReferencePriceLevel["depthBand"], referenceOnly: index !== 0 };
  }).reverse();
  const bids = Array.from({ length: 10 }, (_, index) => {
    const cents = bid - BigInt(index);
    const price = formatUsdCents(cents > 0n ? cents : 1n);
    return { price, quantity: index === 0 ? (options.bestBidQuantity ?? "—") : "—",
      changeRate: changeRateFor(Number(price), close), direction: directionFor(Number(price), close),
      depthBand: (index + 1) as ReferencePriceLevel["depthBand"], referenceOnly: index !== 0 };
  });
  return { asks, bids };
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

export function buildDomesticPriceLimits(options: {
  readonly previousClosePrice: string | null;
  readonly market: DomesticEquityMarket | null;
  readonly securityType: DomesticSecurityType | null;
}): { readonly upperLimitPrice: string | null; readonly lowerLimitPrice: string | null } {
  const previousClose = Number(options.previousClosePrice);
  if (
    options.market === null ||
    options.securityType !== "STOCK" ||
    !Number.isFinite(previousClose) ||
    previousClose <= 0
  ) {
    return { upperLimitPrice: null, lowerLimitPrice: null };
  }

  const upper = alignedPrice(previousClose * 1.3, options.market);
  const lower = alignedPrice(previousClose * 0.7, options.market);
  return {
    upperLimitPrice: upper.toLocaleString("ko-KR"),
    lowerLimitPrice: lower.toLocaleString("ko-KR"),
  };
}
