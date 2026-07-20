import {
  AdvancedQueueDecisionSchema,
  AdvancedQueueStateSchema,
  CanonicalOrderBookEventSchema,
  CanonicalTradeEventSchema,
  OpenPaperOrderSchema,
  OrderBookRowClickSchema,
  PaperExecutionPlanSchema,
  PaperFillPolicySchema,
  PaperOrderCommandSchema,
  PaperOrderDraftSchema,
  PaperPlannerStateSchema,
  PreTradeAvailabilitySchema,
  PreTradeRiskDecisionSchema,
  type CanonicalOrderBookEvent,
  type CanonicalTradeEvent,
  type AdvancedQueueDecision,
  type AdvancedQueueState,
  type OpenPaperOrder,
  type OrderBookRowClick,
  type PaperExecutionPlan,
  type PaperFill,
  type PaperFillPolicy,
  type PaperOrderCommand,
  type PaperOrderDraft,
  type PaperPlanEvent,
  type PaperPlannerState,
  type PreTradeAvailability,
  type PreTradeRiskDecision,
} from "../contracts/paper-order.js";

export {
  acceptAdvancedQueueEstimate,
  planAdvancedQueueProgress,
  resnapshotAdvancedQueueEstimate,
} from "./advanced-queue-engine.js";
export type {
  AcceptAdvancedQueueInput,
  AdvancedQueueProgressInput,
  ResnapshotAdvancedQueueInput,
} from "./advanced-queue-engine.js";

interface Decimal {
  coefficient: bigint;
  scale: number;
}

export interface ImmediatePlanInput {
  order: PaperOrderCommand;
  market: CanonicalOrderBookEvent;
  state: PaperPlannerState;
  policy: PaperFillPolicy;
  evaluatedAt: string;
}

export interface VerifiedImmediatePlanInput extends ImmediatePlanInput {
  availability: PreTradeAvailability;
}

export interface PassivePlanInput {
  openOrder: OpenPaperOrder;
  trade: CanonicalTradeEvent;
  state: PaperPlannerState;
  policy: PaperFillPolicy;
  evaluatedAt: string;
}

export interface CancelPlanInput {
  openOrder: OpenPaperOrder;
  state: PaperPlannerState;
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

function align(left: Decimal, right: Decimal): [bigint, bigint, number] {
  const scale = Math.max(left.scale, right.scale);
  return [
    left.coefficient * power10(scale - left.scale),
    right.coefficient * power10(scale - right.scale),
    scale,
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

function isTickAligned(price: string, tickSize: string): boolean {
  const [priceCoefficient, tickCoefficient] = align(
    parseDecimal(price),
    parseDecimal(tickSize),
  );
  return tickCoefficient > 0n && priceCoefficient % tickCoefficient === 0n;
}

export function resolvePolicyTickSize(
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
  return (
    tickSize !== null &&
    compareDecimal(price, policy.minimumPrice) >= 0 &&
    compareDecimal(price, policy.maximumPrice) <= 0 &&
    isTickAligned(price, tickSize)
  );
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
  const negative = normalized.coefficient < 0n;
  const digits = (
    negative ? -normalized.coefficient : normalized.coefficient
  ).toString();
  if (normalized.scale === 0) {
    return `${negative ? "-" : ""}${digits}`;
  }
  const padded = digits.padStart(normalized.scale + 1, "0");
  const splitAt = padded.length - normalized.scale;
  return `${negative ? "-" : ""}${padded.slice(0, splitAt)}.${padded.slice(splitAt)}`;
}

function multiplyByQuantity(price: string, quantity: bigint): Decimal {
  const decimal = parseDecimal(price);
  return {
    coefficient: decimal.coefficient * quantity,
    scale: decimal.scale,
  };
}

function addDecimal(left: Decimal, right: Decimal): Decimal {
  const [leftCoefficient, rightCoefficient, scale] = align(left, right);
  return normalizeDecimal({
    coefficient: leftCoefficient + rightCoefficient,
    scale,
  });
}

function divideDecimalByInteger(
  value: Decimal,
  divisor: bigint,
  outputScale: number,
): Decimal {
  const scaledNumerator = value.coefficient * power10(outputScale);
  const scaledDivisor = divisor * power10(value.scale);
  let quotient = scaledNumerator / scaledDivisor;
  const remainder = scaledNumerator % scaledDivisor;
  if (remainder * 2n >= scaledDivisor) quotient += 1n;
  return normalizeDecimal({ coefficient: quotient, scale: outputScale });
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

function nextState(
  state: PaperPlannerState,
  orderId: string,
  stream: "ORDER_BOOK" | "TRADE_TICK",
  sequence: string,
  instrumentId: string,
  sessionKey: string,
): PaperPlannerState {
  return PaperPlannerStateSchema.parse({
    seenClientOrderIds: state.seenClientOrderIds.includes(orderId)
      ? state.seenClientOrderIds
      : [...state.seenClientOrderIds, orderId],
    lastOrderBookSequence:
      stream === "ORDER_BOOK" ? sequence : state.lastOrderBookSequence,
    lastTradeSequence:
      stream === "TRADE_TICK" ? sequence : state.lastTradeSequence,
    cursorScope: { instrumentId, sessionKey },
  });
}

function hasStateScopeMismatch(
  state: PaperPlannerState,
  instrumentId: string,
  sessionKey: string,
): boolean {
  return (
    state.cursorScope !== null &&
    (state.cursorScope.instrumentId !== instrumentId ||
      state.cursorScope.sessionKey !== sessionKey)
  );
}

function rejectedPlan(
  order: PaperOrderCommand,
  state: PaperPlannerState,
  code: PaperExecutionPlan["rejectionCode"],
): PaperExecutionPlan {
  return PaperExecutionPlanSchema.parse({
    clientOrderId: order.clientOrderId,
    status: "REJECTED",
    rejectionCode: code,
    fills: [],
    orderQuantity: order.quantity,
    newlyFilledQuantity: "0",
    filledQuantity: "0",
    remainingQuantity: order.quantity,
    cancelledQuantity: "0",
    grossNotional: "0",
    vwap: null,
    plannedEvents: [],
    nextState: state,
    commitOwner: "DB_TRANSACTION_OWNER",
  });
}

function validateCommon(
  order: PaperOrderCommand,
  event: {
    freshness: "LIVE" | "DELAYED" | "STALE";
    currency: string;
    sequence: string;
  },
  eventInstrumentId: string,
  eventVenue: string,
  eventSession: string,
  occurredAt: string | null,
  evaluatedAt: string,
  maximumAgeMs: number,
  lastSequence: string | null,
  tradingPhase: CanonicalOrderBookEvent["tradingPhase"],
): PaperExecutionPlan["rejectionCode"] {
  if (eventInstrumentId !== order.instrumentId) return "INSTRUMENT_MISMATCH";
  if (eventVenue !== order.venue) return "VENUE_MISMATCH";
  if (event.currency !== order.currency) return "CURRENCY_MISMATCH";
  if (tradingPhase === "VI_PAUSED") return "VI_PAUSED";
  if (tradingPhase === "CLOSED" || eventSession === "CLOSED") {
    return "CLOSED_SESSION";
  }
  if (tradingPhase !== "REGULAR_CONTINUOUS") {
    return "SESSION_NOT_FILLABLE";
  }
  if (eventSession !== "REGULAR") return "CLOSED_SESSION";
  if (event.freshness === "STALE") return "STALE_MARKET_DATA";
  if (event.freshness === "DELAYED") return "DELAYED_MARKET_DATA";
  if (occurredAt === null) return "EVENT_TIME_MISSING";
  if (isTooOld(occurredAt, evaluatedAt, maximumAgeMs)) {
    return "STALE_MARKET_DATA";
  }
  if (lastSequence !== null && BigInt(event.sequence) <= BigInt(lastSequence)) {
    return "OUT_OF_ORDER_EVENT";
  }
  return null;
}

export function createOrderBookClickDraft(
  rawClick: OrderBookRowClick,
): PaperOrderDraft {
  const click = OrderBookRowClickSchema.parse(rawClick);
  return PaperOrderDraftSchema.parse({
    order: {
      clientOrderId: click.clientOrderId,
      accountId: click.accountId,
      instrumentId: click.instrumentId,
      venue: click.venue,
      currency: click.currency,
      side: click.rowSide === "ASK" ? "BUY" : "SELL",
      orderType: "LIMIT",
      quantity: click.quantity,
      limitPrice: click.rowPrice,
      timeInForce: "DAY",
      session: "REGULAR",
      submittedAt: click.clickedAt,
      submissionMode: click.oneClickArmed
        ? "ONE_CLICK_ARMED"
        : "CONFIRM_TICKET",
      simulationOnly: true,
    },
    clickedRowSide: click.rowSide,
    confirmationRequired: !click.oneClickArmed,
    localSimulationLabel: "로컬 모의주문",
  });
}

export function planImmediateBookFills(
  rawInput: ImmediatePlanInput,
): PaperExecutionPlan {
  const order = PaperOrderCommandSchema.parse(rawInput.order);
  const market = CanonicalOrderBookEventSchema.parse(rawInput.market);
  const state = PaperPlannerStateSchema.parse(rawInput.state);
  const policy = PaperFillPolicySchema.parse(rawInput.policy);

  if (state.seenClientOrderIds.includes(order.clientOrderId)) {
    return rejectedPlan(order, state, "DUPLICATE_CLIENT_ORDER_ID");
  }
  if (
    hasStateScopeMismatch(
      state,
      market.snapshot.instrumentId,
      market.sessionKey,
    )
  ) {
    return rejectedPlan(order, state, "STATE_SCOPE_MISMATCH");
  }

  const commonRejection = validateCommon(
    order,
    market,
    market.snapshot.instrumentId,
    market.snapshot.venue,
    "REGULAR",
    market.snapshot.occurredAt,
    rawInput.evaluatedAt,
    policy.maxMarketDataAgeMs,
    state.lastOrderBookSequence,
    market.tradingPhase,
  );
  if (commonRejection !== null) {
    return rejectedPlan(order, state, commonRejection);
  }
  if (
    order.limitPrice !== null &&
    (compareDecimal(order.limitPrice, policy.minimumPrice) < 0 ||
      compareDecimal(order.limitPrice, policy.maximumPrice) > 0)
  ) {
    return rejectedPlan(order, state, "PRICE_OUT_OF_RANGE");
  }
  if (
    order.limitPrice !== null &&
    !isValidPolicyPrice(
      order.limitPrice,
      policy,
      order.venue,
      rawInput.evaluatedAt,
    )
  ) {
    return rejectedPlan(order, state, "INVALID_TICK");
  }
  if (
    [...market.snapshot.asks, ...market.snapshot.bids].some(
      (level) =>
        !isValidPolicyPrice(
          level.price,
          policy,
          order.venue,
          rawInput.evaluatedAt,
        ),
    )
  ) {
    return rejectedPlan(order, state, "INVALID_TICK");
  }

  const levels =
    order.side === "BUY"
      ? [...market.snapshot.asks].sort((left, right) =>
          compareDecimal(left.price, right.price),
        )
      : [...market.snapshot.bids].sort((left, right) =>
          compareDecimal(right.price, left.price),
        );
  let remaining = BigInt(order.quantity);
  let totalNotional: Decimal = { coefficient: 0n, scale: 0 };
  const fills: PaperFill[] = [];

  for (const level of levels) {
    if (remaining === 0n) break;
    const withinLimit =
      order.orderType === "MARKET" ||
      (order.side === "BUY"
        ? compareDecimal(level.price, order.limitPrice ?? "0") <= 0
        : compareDecimal(level.price, order.limitPrice ?? "0") >= 0);
    if (!withinLimit) break;
    const available = BigInt(level.quantity);
    if (available === 0n) continue;
    const fillQuantity = available < remaining ? available : remaining;
    const notional = multiplyByQuantity(level.price, fillQuantity);
    const fillIndex = fills.length + 1;
    fills.push({
      fillId: `${order.clientOrderId}:${market.marketEventId}:${fillIndex}`,
      clientOrderId: order.clientOrderId,
      marketEventId: market.marketEventId,
      price: formatDecimal(parseDecimal(level.price)),
      quantity: fillQuantity.toString(),
      grossNotional: formatDecimal(notional),
      liquidity: "BOOK_TAKING",
      fillModelVersion: policy.version,
    });
    totalNotional = addDecimal(totalNotional, notional);
    remaining -= fillQuantity;
  }

  const filled = BigInt(order.quantity) - remaining;
  const plannedEvents: PaperPlanEvent[] = [
    {
      type: "ORDER_ACCEPTED",
      clientOrderId: order.clientOrderId,
      riskReservation: "REVERIFY_AND_RESERVE_AT_DB_COMMIT",
    },
    ...fills.map((fill) => ({
      type: "FILL_AND_LEDGER_COMMIT_REQUESTED" as const,
      transactionGroupId: `${order.clientOrderId}:${market.marketEventId}`,
      fill,
      feeTaxPolicyResolution: "DB_TRANSACTION_OWNER" as const,
      feeLedgerEvent: "PLAN_SEPARATELY" as const,
      taxLedgerEvent: "PLAN_SEPARATELY" as const,
    })),
  ];
  if (remaining > 0n) {
    if (order.orderType === "MARKET") {
      plannedEvents.push({
        type: "ORDER_REMAINDER_CANCELLED",
        clientOrderId: order.clientOrderId,
        cancelledQuantity: remaining.toString(),
        reason: "INSUFFICIENT_VISIBLE_DEPTH",
      });
    } else {
      plannedEvents.push({
        type: "ORDER_RESTING",
        clientOrderId: order.clientOrderId,
        remainingQuantity: remaining.toString(),
        passiveFillModel: policy.passiveFillModel,
      });
    }
  }

  const status =
    remaining === 0n
      ? "FILLED"
      : order.orderType === "MARKET"
        ? filled > 0n
          ? "PARTIALLY_FILLED_CANCELLED"
          : "CANCELLED"
        : filled > 0n
          ? "PARTIALLY_FILLED"
          : "RESTING";

  return PaperExecutionPlanSchema.parse({
    clientOrderId: order.clientOrderId,
    status,
    rejectionCode: null,
    fills,
    orderQuantity: order.quantity,
    newlyFilledQuantity: filled.toString(),
    filledQuantity: filled.toString(),
    remainingQuantity:
      order.orderType === "MARKET" ? "0" : remaining.toString(),
    cancelledQuantity:
      order.orderType === "MARKET" ? remaining.toString() : "0",
    grossNotional: formatDecimal(totalNotional),
    vwap:
      filled === 0n
        ? null
        : formatDecimal(
            divideDecimalByInteger(totalNotional, filled, policy.vwapScale),
          ),
    plannedEvents,
    nextState: nextState(
      state,
      order.clientOrderId,
      "ORDER_BOOK",
      market.sequence,
      market.snapshot.instrumentId,
      market.sessionKey,
    ),
    commitOwner: "DB_TRANSACTION_OWNER",
  });
}

export function planPassiveObservedTradeFill(
  rawInput: PassivePlanInput,
): PaperExecutionPlan {
  const openOrder = OpenPaperOrderSchema.parse(rawInput.openOrder);
  const order = openOrder.order;
  const trade = CanonicalTradeEventSchema.parse(rawInput.trade);
  const state = PaperPlannerStateSchema.parse(rawInput.state);
  const policy = PaperFillPolicySchema.parse(rawInput.policy);
  const remaining = BigInt(order.quantity) - BigInt(openOrder.filledQuantity);

  if (hasStateScopeMismatch(state, trade.tick.instrumentId, trade.sessionKey)) {
    return rejectedPlan(order, state, "STATE_SCOPE_MISMATCH");
  }

  const commonRejection = validateCommon(
    order,
    trade,
    trade.tick.instrumentId,
    trade.tick.venue,
    trade.tick.session,
    trade.tick.occurredAt,
    rawInput.evaluatedAt,
    policy.maxMarketDataAgeMs,
    state.lastTradeSequence,
    trade.tradingPhase,
  );
  if (commonRejection !== null) {
    return rejectedPlan(order, state, commonRejection);
  }
  if (
    trade.tick.occurredAt !== null &&
    Date.parse(trade.tick.occurredAt) <= Date.parse(openOrder.acceptedAt)
  ) {
    return rejectedPlan(order, state, "EVENT_BEFORE_ORDER");
  }

  const limitPrice = order.limitPrice;
  if (order.orderType !== "LIMIT" || limitPrice === null) {
    return rejectedPlan(order, state, "NOT_OPEN");
  }
  if (
    !isValidPolicyPrice(
      limitPrice,
      policy,
      order.venue,
      rawInput.evaluatedAt,
    ) ||
    !isValidPolicyPrice(
      trade.tick.price,
      policy,
      order.venue,
      rawInput.evaluatedAt,
    )
  ) {
    return rejectedPlan(order, state, "INVALID_TICK");
  }
  const reached =
    order.side === "BUY"
      ? compareDecimal(trade.tick.price, limitPrice) <= 0
      : compareDecimal(trade.tick.price, limitPrice) >= 0;
  const strictlyThrough =
    reached && compareDecimal(trade.tick.price, limitPrice ?? "0") !== 0;
  const eligible =
    policy.passiveFillModel === "AT_OR_THROUGH" ? reached : strictlyThrough;
  if (!eligible) {
    return PaperExecutionPlanSchema.parse({
      ...rejectedPlan(
        order,
        state,
        reached ? "NOT_TRADE_THROUGH" : "LIMIT_NOT_REACHED",
      ),
      status: openOrder.status,
      filledQuantity: openOrder.filledQuantity,
      remainingQuantity: remaining.toString(),
      nextState: nextState(
        state,
        order.clientOrderId,
        "TRADE_TICK",
        trade.sequence,
        trade.tick.instrumentId,
        trade.sessionKey,
      ),
    });
  }

  const tickQuantity = BigInt(trade.tick.quantity);
  const fillQuantity = tickQuantity < remaining ? tickQuantity : remaining;
  if (fillQuantity === 0n) {
    return rejectedPlan(order, state, "NOT_OPEN");
  }
  const fillPrice = limitPrice;
  const notional = multiplyByQuantity(fillPrice, fillQuantity);
  const fill: PaperFill = {
    fillId: `${order.clientOrderId}:${trade.marketEventId}:1`,
    clientOrderId: order.clientOrderId,
    marketEventId: trade.marketEventId,
    price: formatDecimal(parseDecimal(fillPrice)),
    quantity: fillQuantity.toString(),
    grossNotional: formatDecimal(notional),
    liquidity:
      policy.passiveFillModel === "AT_OR_THROUGH"
        ? "PASSIVE_AT_OR_THROUGH"
        : "PASSIVE_TRADE_THROUGH",
    fillModelVersion: policy.version,
  };
  const totalFilled = BigInt(openOrder.filledQuantity) + fillQuantity;
  const newRemaining = BigInt(order.quantity) - totalFilled;
  const plannedEvents: PaperPlanEvent[] = [
    {
      type: "FILL_AND_LEDGER_COMMIT_REQUESTED",
      transactionGroupId: `${order.clientOrderId}:${trade.marketEventId}`,
      fill,
      feeTaxPolicyResolution: "DB_TRANSACTION_OWNER",
      feeLedgerEvent: "PLAN_SEPARATELY",
      taxLedgerEvent: "PLAN_SEPARATELY",
    },
  ];
  if (newRemaining > 0n) {
    plannedEvents.push({
      type: "ORDER_RESTING",
      clientOrderId: order.clientOrderId,
      remainingQuantity: newRemaining.toString(),
      passiveFillModel: policy.passiveFillModel,
    });
  }
  return PaperExecutionPlanSchema.parse({
    clientOrderId: order.clientOrderId,
    status: newRemaining === 0n ? "FILLED" : "PARTIALLY_FILLED",
    rejectionCode: null,
    fills: [fill],
    orderQuantity: order.quantity,
    newlyFilledQuantity: fillQuantity.toString(),
    filledQuantity: totalFilled.toString(),
    remainingQuantity: newRemaining.toString(),
    cancelledQuantity: "0",
    grossNotional: formatDecimal(notional),
    vwap: fill.price,
    plannedEvents,
    nextState: nextState(
      state,
      order.clientOrderId,
      "TRADE_TICK",
      trade.sequence,
      trade.tick.instrumentId,
      trade.sessionKey,
    ),
    commitOwner: "DB_TRANSACTION_OWNER",
  });
}

export const planPassiveTradeThroughFill = planPassiveObservedTradeFill;

export function planLocalCancel(rawInput: CancelPlanInput): PaperExecutionPlan {
  const openOrder = OpenPaperOrderSchema.parse(rawInput.openOrder);
  const state = PaperPlannerStateSchema.parse(rawInput.state);
  const remaining =
    BigInt(openOrder.order.quantity) - BigInt(openOrder.filledQuantity);
  if (remaining <= 0n) {
    return rejectedPlan(openOrder.order, state, "NOT_OPEN");
  }
  return PaperExecutionPlanSchema.parse({
    clientOrderId: openOrder.order.clientOrderId,
    status:
      BigInt(openOrder.filledQuantity) > 0n
        ? "PARTIALLY_FILLED_CANCELLED"
        : "CANCELLED",
    rejectionCode: null,
    fills: [],
    orderQuantity: openOrder.order.quantity,
    newlyFilledQuantity: "0",
    filledQuantity: openOrder.filledQuantity,
    remainingQuantity: "0",
    cancelledQuantity: remaining.toString(),
    grossNotional: "0",
    vwap: null,
    plannedEvents: [
      {
        type: "ORDER_CANCEL_REQUESTED",
        clientOrderId: openOrder.order.clientOrderId,
        cancelledQuantity: remaining.toString(),
        owner: "DB_TRANSACTION_OWNER",
      },
    ],
    nextState: state,
    commitOwner: "DB_TRANSACTION_OWNER",
  });
}

interface LegacyAcceptAdvancedQueueInput {
  order: PaperOrderCommand;
  market: CanonicalOrderBookEvent;
  policy: PaperFillPolicy;
  safetyFactor: string;
  evaluatedAt: string;
}

interface LegacyAdvancedQueueProgressInput {
  queue: AdvancedQueueState;
  trade: CanonicalTradeEvent;
  book: CanonicalOrderBookEvent | null;
  policy: PaperFillPolicy;
  evaluatedAt: string;
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

/** @deprecated Use acceptAdvancedQueueEstimate from advanced-queue-engine. */
export function legacyAcceptAdvancedQueueEstimate(
  rawInput: LegacyAcceptAdvancedQueueInput,
): AdvancedQueueState {
  const order = PaperOrderCommandSchema.parse(rawInput.order);
  const market = CanonicalOrderBookEventSchema.parse(rawInput.market);
  const policy = PaperFillPolicySchema.parse(rawInput.policy);
  if (order.orderType !== "LIMIT" || order.limitPrice === null) {
    throw new Error("ADVANCED_QUEUE_V1 requires a LIMIT order");
  }
  const rejection = validateCommon(
    order,
    market,
    market.snapshot.instrumentId,
    market.snapshot.venue,
    "REGULAR",
    market.snapshot.occurredAt,
    rawInput.evaluatedAt,
    policy.maxMarketDataAgeMs,
    null,
    market.tradingPhase,
  );
  if (rejection !== null) {
    throw new Error(`Cannot snapshot queue: ${rejection}`);
  }
  if (
    !isValidPolicyPrice(
      order.limitPrice,
      policy,
      order.venue,
      rawInput.evaluatedAt,
    )
  ) {
    throw new Error("Cannot snapshot queue: invalid limit price");
  }
  const sameSideLevels =
    order.side === "BUY" ? market.snapshot.bids : market.snapshot.asks;
  const displayed =
    sameSideLevels.find(
      (level) => compareDecimal(level.price, order.limitPrice ?? "0") === 0,
    )?.quantity ?? "0";
  const ahead = multiplyIntegerByDecimalCeil(
    BigInt(displayed),
    rawInput.safetyFactor,
  );
  return AdvancedQueueStateSchema.parse({
    clientOrderId: order.clientOrderId,
    instrumentId: order.instrumentId,
    venue: order.venue,
    currency: order.currency,
    side: order.side,
    limitPrice: order.limitPrice,
    remainingQuantity: order.quantity,
    aheadQuantityEstimate: ahead.toString(),
    lastDisplayedQuantityAtPrice: displayed,
    safetyFactor: rawInput.safetyFactor,
    queuePositionQuality: "QUEUE_ESTIMATED",
    sessionKey: market.sessionKey,
    lastOrderBookSequence: market.sequence,
    lastTradeSequence: null,
    seenMarketEventIds: [market.marketEventId],
    viPaused: false,
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

/** @deprecated Use planAdvancedQueueProgress from advanced-queue-engine. */
export function legacyPlanAdvancedQueueProgress(
  rawInput: LegacyAdvancedQueueProgressInput,
): AdvancedQueueDecision {
  const queue = AdvancedQueueStateSchema.parse(rawInput.queue);
  const trade = CanonicalTradeEventSchema.parse(rawInput.trade);
  const book =
    rawInput.book === null
      ? null
      : CanonicalOrderBookEventSchema.parse(rawInput.book);
  const policy = PaperFillPolicySchema.parse(rawInput.policy);

  if (
    queue.seenMarketEventIds.includes(trade.marketEventId) ||
    (book !== null && queue.seenMarketEventIds.includes(book.marketEventId))
  ) {
    return queueDecision(queue, "OUT_OF_ORDER_EVENT");
  }
  if (
    trade.sessionKey !== queue.sessionKey ||
    (book !== null && book.sessionKey !== queue.sessionKey)
  ) {
    return queueDecision(queue, "SESSION_NOT_FILLABLE", true);
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
    BigInt(trade.sequence) <= BigInt(queue.lastTradeSequence ?? "-1") ||
    (book !== null &&
      BigInt(book.sequence) <= BigInt(queue.lastOrderBookSequence))
  ) {
    return queueDecision(queue, "OUT_OF_ORDER_EVENT");
  }
  if (
    trade.tick.instrumentId !== queue.instrumentId ||
    (book !== null && book.snapshot.instrumentId !== queue.instrumentId)
  ) {
    return queueDecision(queue, "INSTRUMENT_MISMATCH");
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
  if (book !== null) {
    if (book.freshness === "DELAYED") {
      return queueDecision(queue, "DELAYED_MARKET_DATA");
    }
    if (
      book.freshness === "STALE" ||
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

  const eligible =
    queue.side === "BUY"
      ? compareDecimal(trade.tick.price, queue.limitPrice) <= 0
      : compareDecimal(trade.tick.price, queue.limitPrice) >= 0;
  const sameSideLevels =
    book === null
      ? []
      : queue.side === "BUY"
        ? book.snapshot.bids
        : book.snapshot.asks;
  const displayedNow =
    book === null
      ? queue.lastDisplayedQuantityAtPrice
      : (sameSideLevels.find(
          (level) => compareDecimal(level.price, queue.limitPrice) === 0,
        )?.quantity ?? "0");
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
  const availableForOrder = strictThrough
    ? tradeQuantity
    : eligible
      ? tradeQuantity < observedProgress - progressAgainstAhead
        ? tradeQuantity
        : observedProgress - progressAgainstAhead
      : 0n;
  const remaining = BigInt(queue.remainingQuantity);
  const fillQuantity =
    availableForOrder < remaining ? availableForOrder : remaining;
  const seenIds = [
    ...queue.seenMarketEventIds,
    trade.marketEventId,
    ...(book === null ? [] : [book.marketEventId]),
  ];
  const nextQueue = AdvancedQueueStateSchema.parse({
    ...queue,
    remainingQuantity: (remaining - fillQuantity).toString(),
    aheadQuantityEstimate: aheadAfter.toString(),
    lastDisplayedQuantityAtPrice: displayedNow,
    lastOrderBookSequence: book?.sequence ?? queue.lastOrderBookSequence,
    lastTradeSequence: trade.sequence,
    seenMarketEventIds: seenIds,
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
  const notional = multiplyByQuantity(queue.limitPrice, fillQuantity);
  const fill: PaperFill = {
    fillId: `${queue.clientOrderId}:${trade.marketEventId}:queue`,
    clientOrderId: queue.clientOrderId,
    marketEventId: trade.marketEventId,
    price: queue.limitPrice,
    quantity: fillQuantity.toString(),
    grossNotional: formatDecimal(notional),
    liquidity: "PASSIVE_TRADE_THROUGH",
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

function assessPreTradeAvailability(
  rawOrder: PaperOrderCommand,
  rawAvailability: PreTradeAvailability,
  verifiedGrossNotional: string,
): PreTradeRiskDecision {
  const order = PaperOrderCommandSchema.parse(rawOrder);
  const availability = PreTradeAvailabilitySchema.parse(rawAvailability);
  if (
    order.side === "SELL" &&
    BigInt(order.quantity) > BigInt(availability.availablePositionQuantity)
  ) {
    return PreTradeRiskDecisionSchema.parse({
      accepted: false,
      rejectionCode: "INSUFFICIENT_AVAILABLE_POSITION",
    });
  }
  if (order.side === "BUY") {
    const required = addDecimal(
      parseDecimal(verifiedGrossNotional),
      parseDecimal(availability.estimatedFeeTaxReserve),
    );
    if (
      compareDecimal(formatDecimal(required), availability.availableCash) > 0
    ) {
      return PreTradeRiskDecisionSchema.parse({
        accepted: false,
        rejectionCode: "INSUFFICIENT_AVAILABLE_CASH",
      });
    }
  }
  return PreTradeRiskDecisionSchema.parse({
    accepted: true,
    rejectionCode: null,
  });
}

export function planVerifiedImmediateBookFills(
  rawInput: VerifiedImmediatePlanInput,
): PaperExecutionPlan {
  const order = PaperOrderCommandSchema.parse(rawInput.order);
  const availability = PreTradeAvailabilitySchema.parse(rawInput.availability);
  const candidate = planImmediateBookFills(rawInput);
  if (candidate.rejectionCode !== null) return candidate;

  const verifiedGrossNotional =
    order.side === "BUY" &&
    order.orderType === "LIMIT" &&
    order.limitPrice !== null
      ? formatDecimal(
          multiplyByQuantity(order.limitPrice, BigInt(order.quantity)),
        )
      : candidate.grossNotional;
  const risk = assessPreTradeAvailability(
    order,
    availability,
    verifiedGrossNotional,
  );
  if (!risk.accepted) {
    return rejectedPlan(order, rawInput.state, risk.rejectionCode);
  }
  return candidate;
}

export const KIS_ORDER_BOOK_CAPABILITIES = {
  KRX_DOMESTIC: {
    venueFamily: "KRX",
    bidDepth: 10,
    askDepth: 10,
    capabilityEvidence: "KR_DOMESTIC_TEN_LEVEL",
  },
  US_EQUITY_CURRENT: {
    venueFamily: "US",
    bidDepth: 1,
    askDepth: 1,
    capabilityEvidence: "US_CURRENT_CONTRACT_ONE_LEVEL",
  },
} as const;
