export const HYPERLIQUID_PUBLIC_INFO_URL = "https://api.hyperliquid.xyz/info";
export const HYPERLIQUID_PUBLIC_WS_URL = "wss://api.hyperliquid.xyz/ws";

export const HYPERLIQUID_READ_ONLY_INFO_TYPES = [
  "perpDexs",
  "metaAndAssetCtxs",
  "perpAnnotation",
  "l2Book",
  "perpsAtOpenInterestCap",
  "fundingHistory",
  "candleSnapshot",
] as const;

export const HYPERLIQUID_READ_ONLY_SUBSCRIPTIONS = [
  "allMids",
  "allDexsAssetCtxs",
  "activeAssetCtx",
  "bbo",
  "l2Book",
  "trades",
  "candle",
] as const;

const EXPECTED_INFO_URL = "https://api.hyperliquid.xyz/info";
const EXPECTED_WS_URL = "wss://api.hyperliquid.xyz/ws";
const EXPECTED_INFO_TYPES = [
  "perpDexs",
  "metaAndAssetCtxs",
  "perpAnnotation",
  "l2Book",
  "perpsAtOpenInterestCap",
  "fundingHistory",
  "candleSnapshot",
] as const;
const EXPECTED_SUBSCRIPTIONS = [
  "allMids",
  "allDexsAssetCtxs",
  "activeAssetCtx",
  "bbo",
  "l2Book",
  "trades",
  "candle",
] as const;

type ReadOnlyInfoType = (typeof HYPERLIQUID_READ_ONLY_INFO_TYPES)[number];
type ReadOnlySubscriptionType =
  (typeof HYPERLIQUID_READ_ONLY_SUBSCRIPTIONS)[number];

const infoTypeAllowlist = new Set<string>(HYPERLIQUID_READ_ONLY_INFO_TYPES);
const subscriptionAllowlist = new Set<string>(
  HYPERLIQUID_READ_ONLY_SUBSCRIPTIONS,
);

export function isReadOnlyHyperliquidInfoType(
  value: string,
): value is ReadOnlyInfoType {
  return infoTypeAllowlist.has(value);
}

export function isReadOnlyHyperliquidSubscription(
  value: string,
): value is ReadOnlySubscriptionType {
  return subscriptionAllowlist.has(value);
}

function sameValues(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  return (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

export function inspectReadOnlyHyperliquidRegistry(): {
  valid: boolean;
  violations: string[];
} {
  const violations: string[] = [];
  if (HYPERLIQUID_PUBLIC_INFO_URL !== EXPECTED_INFO_URL) {
    violations.push("unexpected-info-url");
  }
  if (HYPERLIQUID_PUBLIC_WS_URL !== EXPECTED_WS_URL) {
    violations.push("unexpected-websocket-url");
  }
  if (!sameValues(HYPERLIQUID_READ_ONLY_INFO_TYPES, EXPECTED_INFO_TYPES)) {
    violations.push("unexpected-info-type");
  }
  if (
    !sameValues(HYPERLIQUID_READ_ONLY_SUBSCRIPTIONS, EXPECTED_SUBSCRIPTIONS)
  ) {
    violations.push("unexpected-subscription-type");
  }
  return { valid: violations.length === 0, violations };
}
