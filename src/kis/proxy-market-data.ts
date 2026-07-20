import {
  buildUsRegularTrKey,
  usProbeSubscriptions,
  type WsSubscription,
} from "./ws/client.js";

export const FREE_MARKET_CONTEXT_PROXIES = {
  nasdaq: {
    purpose: "NASDAQ_FUTURES_DIRECTION",
    provider: "KIS_US_EQUITY",
    quality: "PROXY_LIVE",
    exchange: "NAS",
    listingVenue: "NASDAQ",
    symbol: "QQQ",
    instrumentId: "NASDAQ:QQQ",
    tracks: "Nasdaq-100 ETF; not an NQ/MNQ futures contract",
  },
  russell: {
    purpose: "RUSSELL_2000_DIRECTION",
    provider: "KIS_US_EQUITY",
    quality: "PROXY_LIVE",
    exchange: "AMS",
    listingVenue: "NYSEARCA",
    symbol: "IWM",
    instrumentId: "NYSEARCA:IWM",
    tracks:
      "Russell 2000 ETF; not the RUT index or an RTY/M2K futures contract",
  },
  oil: {
    purpose: "WTI_FUTURES_DIRECTION",
    provider: "KIS_US_EQUITY",
    quality: "PROXY_LIVE",
    exchange: "AMS",
    listingVenue: "NYSEARCA",
    symbol: "USO",
    instrumentId: "NYSEARCA:USO",
    tracks: "WTI futures-based ETF; not a CL/MCL futures contract",
  },
} as const;

export type FreeMarketContextProxyKey =
  keyof typeof FREE_MARKET_CONTEXT_PROXIES;

export interface FreeMarketContextProxySelection {
  exchange: "NAS" | "NYS" | "AMS";
  symbol: string;
}

export interface FreeMarketContextProxyDescriptor extends FreeMarketContextProxySelection {
  purpose: (typeof FREE_MARKET_CONTEXT_PROXIES)[FreeMarketContextProxyKey]["purpose"];
  quality: "PROXY_LIVE";
  provider: "KIS_US_EQUITY";
  listingVenue: "NASDAQ" | "NYSEARCA";
  instrumentId: string;
  trKey: string;
}

export function describeFreeMarketContextProxy(
  key: FreeMarketContextProxyKey,
  selection?: FreeMarketContextProxySelection,
): FreeMarketContextProxyDescriptor {
  const defaults = FREE_MARKET_CONTEXT_PROXIES[key];
  const selected = selection ?? defaults;
  if (
    selected.exchange !== defaults.exchange ||
    selected.symbol !== defaults.symbol
  ) {
    throw new Error(
      `Unsupported ${key} proxy override; verified mapping is ${defaults.exchange}:${defaults.symbol}`,
    );
  }
  return {
    purpose: defaults.purpose,
    quality: "PROXY_LIVE",
    provider: "KIS_US_EQUITY",
    exchange: selected.exchange,
    listingVenue: defaults.listingVenue,
    symbol: selected.symbol,
    instrumentId: defaults.instrumentId,
    trKey: buildUsRegularTrKey(selected.exchange, selected.symbol),
  };
}

export function freeMarketContextProxyProbeSubscriptions(options?: {
  nasdaq?: FreeMarketContextProxySelection;
  russell?: FreeMarketContextProxySelection;
  oil?: FreeMarketContextProxySelection;
}): WsSubscription[] {
  const nasdaq = describeFreeMarketContextProxy("nasdaq", options?.nasdaq);
  const russell = describeFreeMarketContextProxy("russell", options?.russell);
  const oil = describeFreeMarketContextProxy("oil", options?.oil);
  const subscriptions = [
    ...usProbeSubscriptions(
      nasdaq.exchange,
      nasdaq.symbol,
      nasdaq.listingVenue,
    ),
    ...usProbeSubscriptions(
      russell.exchange,
      russell.symbol,
      russell.listingVenue,
    ),
    ...usProbeSubscriptions(oil.exchange, oil.symbol, oil.listingVenue),
  ];

  const identities = new Set(
    subscriptions.map(
      (subscription) => `${subscription.trId}:${subscription.trKey}`,
    ),
  );
  if (identities.size !== subscriptions.length) {
    throw new Error(
      "Free market proxy selections must resolve to distinct subscriptions",
    );
  }
  return subscriptions;
}
