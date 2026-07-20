import type {
  DomesticEquityMarket,
  DomesticSecurityType,
} from "../orderbook/reference-price-ladder.js";

export interface LocalWatchlistItem {
  readonly instrumentId: string;
  readonly symbol: string;
  readonly name: string;
  readonly market: DomesticEquityMarket | null;
  readonly securityType: DomesticSecurityType | null;
}

export const LOCAL_WATCHLIST_KEY = "papertrading:watchlist:v2";

function isLocalWatchlistItem(value: unknown): value is LocalWatchlistItem {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item["instrumentId"] === "string" &&
    /^KRX:[0-9A-Z]{6,7}$/.test(item["instrumentId"]) &&
    typeof item["symbol"] === "string" &&
    item["instrumentId"] === `KRX:${item["symbol"]}` &&
    typeof item["name"] === "string" &&
    item["name"].length > 0 &&
    item["name"].length <= 120 &&
    (item["market"] === null ||
      item["market"] === "KOSPI" ||
      item["market"] === "KOSDAQ") &&
    (item["securityType"] === null ||
      ["STOCK", "ETF", "ETN", "OTHER"].includes(
        String(item["securityType"]),
      ))
  );
}

export function readLocalWatchlist(raw: string | null): readonly LocalWatchlistItem[] {
  if (raw === null) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    const deduplicated = new Map<string, LocalWatchlistItem>();
    for (const item of value.slice(0, 100)) {
      if (isLocalWatchlistItem(item)) deduplicated.set(item.instrumentId, item);
    }
    return [...deduplicated.values()];
  } catch {
    return [];
  }
}
