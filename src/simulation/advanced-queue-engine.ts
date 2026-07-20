import {
  AdvancedQueueDecisionSchema,
  AdvancedQueueStateSchema,
  CanonicalOrderBookEventSchema,
  CanonicalTradeEventSchema,
  PaperFillPolicySchema,
  PaperOrderCommandSchema,
  type AdvancedQueueDecision,
  type AdvancedQueueState,
  type CanonicalOrderBookEvent,
  type CanonicalTradeEvent,
  type PaperFill,
  type PaperFillPolicy,
  type PaperOrderCommand,
} from "../contracts/paper-order.js";

interface Decimal {
  coefficient: bigint;
  scale: number;
}

export const ADVANCED_QUEUE_RECENT_EVENT_LIMIT = 128;

export interface AcceptAdvancedQueueInput {
  order: PaperOrderCommand;
  market: CanonicalOrderBookEvent;
  policy: PaperFillPolicy;
  safetyFactor: string;
  evaluatedAt: string;
}

export interface AdvancedQueueProgressInput {
  queue: AdvancedQueueState;
  trade: CanonicalTradeEvent;
  book: CanonicalOrderBookEvent | null;
  policy: PaperFillPolicy;
  evaluatedAt: string;
}

export interface ResnapshotAdvancedQueueInput {
  queue: AdvancedQueueState;
  market: CanonicalOrderBookEvent;
  policy: PaperFillPolicy;
  safetyFactor: string;
  evaluatedAt: string;
  reason: "VI_RESUME" | "SESSION_SCOPE_CHANGE" | "MANUAL_RESYNC";
}

function parseDecimal(value: string): Decimal {
  const negative = value.startsWith("-");
  const unsigned = negative || value.startsWith("+") ? value.slice(1) : value;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const coefficient = BigInt(`${whole}${fraction}`);
  return {
    coefficient: negative ? -coefficient : coefficient,
    scale: fraction.length,
  };
}

function power10(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}

function align(left: Decimal, right: Decimal): [bigint, bigint] {
  const scale = Math.max(left.scale, right.scale);
  return [
    left.coefficient * power10(scale - left.scale),
    right.coefficient * power10(scale - right.scale),
  ];
}

function compareDecimal(left: string, right: string): number {
  const [leftCoefficient, rightCoefficient] = align(
    parseDecimal(left),
    parseDecimal(right),
  );
  if (leftCoefficient < rightCoefficient) return -1;
  if (leftCoefficient > rightCoefficient) return 1;
  return 0;
}

function normalizeDecimal(decimal: Decimal): Decimal {
  let { coefficient, scale } = decimal;
  while (scale > 0 && coefficient % 10n === 0n) {
    coefficient /= 10n;
    scale -= 1;
  }
  return { coefficient, scale };
}

function formatDecimal(decimal: Decimal): string {
  const normalized = normalizeDecimal(decimal);
  const digits = normalized.coefficient.toString().padStart(
    normalized.scale + 1,
    "0",
  );
  if (normalized.scale === 0) return digits;
  const splitAt = digits.length - normalized.scale;
  return `${digits.slice(0, splitAt)}.${digits.slice(splitAt)}`;
}

function multiplyByQuantity(price: string, quantity: bigint): Decimal {
  const decimal = parseDecimal(price);
  return {
    coefficient: decimal.coefficient * quantity,
    scale: decimal.scale,
  };
}

function multiplyIntegerByDecimalCeil(
  quantity: bigint,
  factorText: string,
): bigint {
  const factor = parseDecimal(factorText);
  const divisor = power10(factor.scale);
  const numerator = quantity * factor.coefficient;
  return (numerator + divisor - 1n) / divisor;
}

function isTooOld(
  occurredAt: string | null,
  evaluatedAt: string,
  maximumAgeMs: number,
): boolean {
  if (occurredAt === null) return true;
  const age = Date.parse(evaluatedAt) - Date.parse(occurredAt);
  return age < 0 || age > maximumAgeMs;
}

function resolvePolicyTickSize(
  policy: PaperFillPolicy,
  price: string,
  venue: string,
  evaluatedAt: string,
): string | null {
  const rule = policy.tickRule;
  if (
    rule.venue !== venue ||
    Date.parse(evaluatedAt) < Date.parse(rule.effectiveFrom) ||
    (rule.effectiveTo !== null &&
      Date.parse(evaluatedAt) >= Date.parse(rule.effectiveTo))
  ) {
    return null;
  }
  if (rule.kind === "FIXED") return rule.tickSize;
  return (
    rule.bands.find(
      (band) =>
        compareDecimal(price, band.minimumInclusive) >= 0 &&
        (band.maximumExclusive === null ||
          compareDecimal(price, band.maximumExclusive) < 0),
    )?.tickSize ?? null
  );
}

function isValidPolicyPrice(
  price: string,
  policy: PaperFillPolicy,
  venue: string,
  evaluatedAt: string,
): boolean {
  const tickSize = resolvePolicyTickSize(policy, price, venue, evaluatedAt);
  if (
    tickSize === null ||
    compareDecimal(price, policy.minimumPrice) < 0 ||
    compareDecimal(price, policy.maximumPrice) > 0
  ) {
    return false;
  }
  const [priceCoefficient, tickCoefficient] = align(
    parseDecimal(price),
    parseDecimal(tickSize),
  );
  return tickCoefficient > 0n && priceCoefficient % tickCoefficient === 0n;
}

function displayedQuantityAtLimit(
  side: AdvancedQueueState["side"],
  limitPrice: string,
  market: CanonicalOrderBookEvent,
): string {
  const levels = side === "BUY" ? market.snapshot.bids : market.snapshot.asks;
  return (
    levels.find((level) => compareDecimal(level.price, limitPrice) === 0)
      ?.quantity ?? "0"
  );
}

function assertSnapshotUsable(
  order: Pick<
    PaperOrderCommand,
    | "instrumentId"
    | "venue"
    | "currency"
    | "session"
    | "submittedAt"
    | "limitPrice"
  >,
  market: CanonicalOrderBookEvent,
  policy: PaperFillPolicy,
  evaluatedAt: string,
): void {
  if (order.instrumentId !== market.snapshot.instrumentId) {
    throw new Error("Cannot snapshot queue: INSTRUMENT_MISMATCH");
  }
  if (order.venue !== market.snapshot.venue) {
    throw new Error("Cannot snapshot queue: VENUE_MISMATCH");
  }
  if (order.currency !== market.currency) {
    throw new Error("Cannot snapshot queue: CURRENCY_MISMATCH");
  }
  if (
    order.session !== "REGULAR" ||
    market.tradingPhase !== "REGULAR_CONTINUOUS"
  ) {
    throw new Error("Cannot snapshot queue: SESSION_NOT_FILLABLE");
  }
  if (market.freshness === "DELAYED") {
    throw new Error("Cannot snapshot queue: DELAYED_MARKET_DATA");
  }
  if (
    market.freshness !== "LIVE" ||
    isTooOld(
      market.snapshot.occurredAt,
      evaluatedAt,
      policy.maxMarketDataAgeMs,
    )
  ) {
    throw new Error("Cannot snapshot queue: STALE_MARKET_DATA");
  }
  if (
    market.snapshot.occurredAt === null ||
    Date.parse(market.snapshot.occurredAt) < Date.parse(order.submittedAt)
  ) {
    throw new Error("Cannot snapshot queue: EVENT_BEFORE_ORDER");
  }
  if (
    order.limitPrice === null ||
    !isValidPolicyPrice(order.limitPrice, policy, order.venue, evaluatedAt)
  ) {
    throw new Error("Cannot snapshot queue: INVALID_TICK");
  }
}

function makeQueueState(input: {
  order: PaperOrderCommand;
  remainingQuantity: string;
  market: CanonicalOrderBookEvent;
  safetyFactor: string;
}): AdvancedQueueState {
  const displayed = displayedQuantityAtLimit(
    input.order.side,
    input.order.limitPrice ?? "0",
    input.market,
  );
  const ahead = multiplyIntegerByDecimalCeil(
    BigInt(displayed),
    input.safetyFactor,
  );
  return AdvancedQueueStateSchema.parse({
    clientOrderId: input.order.clientOrderId,
    instrumentId: input.order.instrumentId,
    venue: input.order.venue,
    currency: input.order.currency,
    side: input.order.side,
    limitPrice: input.order.limitPrice,
    remainingQuantity: input.remainingQuantity,
    aheadQuantityEstimate: ahead.toString(),
    lastDisplayedQuantityAtPrice: displayed,
    safetyFactor: input.safetyFactor,
    queuePositionQuality: "QUEUE_ESTIMATED",
    sessionKey: input.market.sessionKey,
    lastOrderBookSequence: input.market.sequence,
    lastTradeSequence: null,
    seenMarketEventIds: [input.market.marketEventId],
    viPaused: false,
  });
}

export function acceptAdvancedQueueEstimate(
  rawInput: AcceptAdvancedQueueInput,
): AdvancedQueueState {
  const order = PaperOrderCommandSchema.parse(rawInput.order);
  const market = CanonicalOrderBookEventSchema.parse(rawInput.market);
  const policy = PaperFillPolicySchema.parse(rawInput.policy);
  if (order.orderType !== "LIMIT" || order.limitPrice === null) {
    throw new Error("ADVANCED_QUEUE_V1 requires a LIMIT order");
  }
  assertSnapshotUsable(order, market, policy, rawInput.evaluatedAt);
  return makeQueueState({
    order,
    remainingQuantity: order.quantity,
    market,
    safetyFactor: rawInput.safetyFactor,
  });
}

export function resnapshotAdvancedQueueEstimate(
  rawInput: ResnapshotAdvancedQueueInput,
): AdvancedQueueState {
  const queue = AdvancedQueueStateSchema.parse(rawInput.queue);
  const market = CanonicalOrderBookEventSchema.parse(rawInput.market);
  const policy = PaperFillPolicySchema.parse(rawInput.policy);
  if (queue.remainingQuantity === "0") {
    throw new Error("Cannot resnapshot a completed queue");
  }
  if (
    rawInput.reason === "VI_RESUME" &&
    (!queue.viPaused || market.sessionKey !== queue.sessionKey)
  ) {
    throw new Error("VI_RESUME requires a paused queue in the same scope");
  }
  if (
    rawInput.reason === "SESSION_SCOPE_CHANGE" &&
    market.sessionKey === queue.sessionKey
  ) {
    throw new Error("SESSION_SCOPE_CHANGE requires a new session scope");
  }
  const syntheticOrder = PaperOrderCommandSchema.parse({
    clientOrderId: queue.clientOrderId,
    accountId: "LOCAL_QUEUE_RESNAPSHOT",
    instrumentId: queue.instrumentId,
    venue: queue.venue,
    currency: queue.currency,
    side: queue.side,
    orderType: "LIMIT",
    quantity: queue.remainingQuantity,
    limitPrice: queue.limitPrice,
    timeInForce: "DAY",
    session: "REGULAR",
    submittedAt: market.snapshot.occurredAt ?? rawInput.evaluatedAt,
    submissionMode: "CONFIRM_TICKET",
    simulationOnly: true,
  });
  assertSnapshotUsable(
    syntheticOrder,
    market,
    policy,
    rawInput.evaluatedAt,
  );
  return makeQueueState({
    order: syntheticOrder,
    remainingQuantity: queue.remainingQuantity,
    market,
    safetyFactor: rawInput.safetyFactor,
  });
}

function queueDecision(
  state: AdvancedQueueState,
  rejectionCode: AdvancedQueueDecision["rejectionCode"],
  resetRequired = false,
): AdvancedQueueDecision {
  return AdvancedQueueDecisionSchema.parse({
    state,
    fill: null,
    rejectionCode,
    queueProgressQuantity: "0",
    resetRequired,
    plannedEvents: [],
  });
}

function boundedRecentEventIds(ids: readonly string[]): string[] {
  const unique = [...new Set(ids)];
  return unique.slice(-ADVANCED_QUEUE_RECENT_EVENT_LIMIT);
}

export function planAdvancedQueueProgress(
  rawInput: AdvancedQueueProgressInput,
): AdvancedQueueDecision {
  const queue = AdvancedQueueStateSchema.parse(rawInput.queue);
  const trade = CanonicalTradeEventSchema.parse(rawInput.trade);
  const book =
    rawInput.book === null
      ? null
      : CanonicalOrderBookEventSchema.parse(rawInput.book);
  const policy = PaperFillPolicySchema.parse(rawInput.policy);

  if (trade.tick.instrumentId !== queue.instrumentId) {
    return queueDecision(queue, "INSTRUMENT_MISMATCH", true);
  }
  if (
    book !== null &&
    book.snapshot.instrumentId !== queue.instrumentId
  ) {
    return queueDecision(queue, "INSTRUMENT_MISMATCH", true);
  }
  if (
    trade.sessionKey !== queue.sessionKey ||
    (book !== null && book.sessionKey !== queue.sessionKey)
  ) {
    return queueDecision(queue, "SESSION_NOT_FILLABLE", true);
  }
  if (
    trade.tick.venue !== queue.venue ||
    (book !== null && book.snapshot.venue !== queue.venue)
  ) {
    return queueDecision(queue, "VENUE_MISMATCH");
  }
  if (
    trade.currency !== queue.currency ||
    (book !== null && book.currency !== queue.currency)
  ) {
    return queueDecision(queue, "CURRENCY_MISMATCH");
  }
  if (queue.remainingQuantity === "0") {
    return queueDecision(queue, "NOT_OPEN");
  }
  if (trade.tradingPhase === "VI_PAUSED") {
    return queueDecision(
      AdvancedQueueStateSchema.parse({ ...queue, viPaused: true }),
      "VI_PAUSED",
    );
  }
  if (queue.viPaused && trade.tradingPhase === "REGULAR_CONTINUOUS") {
    return queueDecision(queue, "SESSION_NOT_FILLABLE", true);
  }
  const auctionPhase = [
    "PREOPEN_AUCTION",
    "CLOSING_AUCTION",
    "AFTER_HOURS_AUCTION",
  ].includes(trade.tradingPhase);
  if (auctionPhase && trade.auction?.finalized !== true) {
    return queueDecision(queue, "AUCTION_PRINT_REQUIRED");
  }
  if (trade.tradingPhase !== "REGULAR_CONTINUOUS" && !auctionPhase) {
    return queueDecision(queue, "SESSION_NOT_FILLABLE");
  }
  if (
    queue.seenMarketEventIds.includes(trade.marketEventId) ||
    BigInt(trade.sequence) <= BigInt(queue.lastTradeSequence ?? "-1")
  ) {
    return queueDecision(queue, "OUT_OF_ORDER_EVENT");
  }
  if (book !== null) {
    if (book.freshness === "DELAYED") {
      return queueDecision(queue, "DELAYED_MARKET_DATA");
    }
    if (
      book.freshness !== "LIVE" ||
      isTooOld(
        book.snapshot.occurredAt,
        rawInput.evaluatedAt,
        policy.maxMarketDataAgeMs,
      )
    ) {
      return queueDecision(queue, "STALE_MARKET_DATA");
    }
    if (book.tradingPhase !== trade.tradingPhase) {
      return queueDecision(queue, "SESSION_NOT_FILLABLE");
    }
  }
  if (
    trade.freshness !== "LIVE" ||
    isTooOld(
      trade.tick.occurredAt,
      rawInput.evaluatedAt,
      policy.maxMarketDataAgeMs,
    )
  ) {
    return queueDecision(queue, "STALE_MARKET_DATA");
  }
  if (
    !isValidPolicyPrice(
      queue.limitPrice,
      policy,
      queue.venue,
      rawInput.evaluatedAt,
    ) ||
    !isValidPolicyPrice(
      trade.tick.price,
      policy,
      queue.venue,
      rawInput.evaluatedAt,
    ) ||
    (trade.auction !== null &&
      !isValidPolicyPrice(
        trade.auction.clearingPrice,
        policy,
        queue.venue,
        rawInput.evaluatedAt,
      ))
  ) {
    return queueDecision(queue, "INVALID_TICK");
  }

  let effectiveBook = book;
  if (
    book !== null &&
    queue.seenMarketEventIds.includes(book.marketEventId)
  ) {
    if (book.sequence !== queue.lastOrderBookSequence) {
      return queueDecision(queue, "OUT_OF_ORDER_EVENT");
    }
    effectiveBook = null;
  } else if (
    book !== null &&
    BigInt(book.sequence) <= BigInt(queue.lastOrderBookSequence)
  ) {
    return queueDecision(queue, "OUT_OF_ORDER_EVENT");
  }

  const eligible =
    queue.side === "BUY"
      ? compareDecimal(trade.tick.price, queue.limitPrice) <= 0
      : compareDecimal(trade.tick.price, queue.limitPrice) >= 0;
  const displayedNow =
    effectiveBook === null
      ? queue.lastDisplayedQuantityAtPrice
      : displayedQuantityAtLimit(queue.side, queue.limitPrice, effectiveBook);
  const displayedDecrease =
    BigInt(queue.lastDisplayedQuantityAtPrice) > BigInt(displayedNow)
      ? BigInt(queue.lastDisplayedQuantityAtPrice) - BigInt(displayedNow)
      : 0n;
  const tradeQuantity = eligible ? BigInt(trade.tick.quantity) : 0n;
  const strictThrough =
    eligible && compareDecimal(trade.tick.price, queue.limitPrice) !== 0;
  const observedProgress =
    tradeQuantity > displayedDecrease ? tradeQuantity : displayedDecrease;
  const ahead = BigInt(queue.aheadQuantityEstimate);
  const progressAgainstAhead =
    observedProgress < ahead ? observedProgress : ahead;
  const aheadAfter = strictThrough ? 0n : ahead - progressAgainstAhead;
  const progressBeyondAhead = observedProgress - progressAgainstAhead;
  const availableForOrder = strictThrough
    ? tradeQuantity
    : eligible
      ? tradeQuantity < progressBeyondAhead
        ? tradeQuantity
        : progressBeyondAhead
      : 0n;
  const remaining = BigInt(queue.remainingQuantity);
  const fillQuantity =
    availableForOrder < remaining ? availableForOrder : remaining;
  const nextQueue = AdvancedQueueStateSchema.parse({
    ...queue,
    remainingQuantity: (remaining - fillQuantity).toString(),
    aheadQuantityEstimate: aheadAfter.toString(),
    lastDisplayedQuantityAtPrice: displayedNow,
    lastOrderBookSequence:
      effectiveBook?.sequence ?? queue.lastOrderBookSequence,
    lastTradeSequence: trade.sequence,
    seenMarketEventIds: boundedRecentEventIds([
      ...queue.seenMarketEventIds,
      trade.marketEventId,
      ...(effectiveBook === null ||
      effectiveBook.marketEventId === trade.marketEventId
        ? []
        : [effectiveBook.marketEventId]),
    ]),
  });
  if (fillQuantity === 0n) {
    return AdvancedQueueDecisionSchema.parse({
      state: nextQueue,
      fill: null,
      rejectionCode: eligible ? null : "NOT_TRADE_THROUGH",
      queueProgressQuantity: observedProgress.toString(),
      resetRequired: false,
      plannedEvents: [],
    });
  }
  const fill: PaperFill = {
    fillId: `${queue.clientOrderId}:${trade.marketEventId}:queue`,
    clientOrderId: queue.clientOrderId,
    marketEventId: trade.marketEventId,
    price: queue.limitPrice,
    quantity: fillQuantity.toString(),
    grossNotional: formatDecimal(
      multiplyByQuantity(queue.limitPrice, fillQuantity),
    ),
    liquidity: strictThrough
      ? "PASSIVE_TRADE_THROUGH"
      : "PASSIVE_AT_OR_THROUGH",
    fillModelVersion: `ADVANCED_QUEUE_V1:${policy.version}`,
  };
  return AdvancedQueueDecisionSchema.parse({
    state: nextQueue,
    fill,
    rejectionCode: null,
    queueProgressQuantity: observedProgress.toString(),
    resetRequired: false,
    plannedEvents: [
      {
        type: "FILL_AND_LEDGER_COMMIT_REQUESTED",
        transactionGroupId: `${queue.clientOrderId}:${trade.marketEventId}`,
        fill,
        feeTaxPolicyResolution: "DB_TRANSACTION_OWNER",
        feeLedgerEvent: "PLAN_SEPARATELY",
        taxLedgerEvent: "PLAN_SEPARATELY",
      },
    ],
  });
}
