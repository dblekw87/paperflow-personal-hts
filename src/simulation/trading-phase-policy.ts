import {
  CanonicalTradingPhaseEventSchema,
  DayOrderExpiryCandidateSchema,
  DayOrderExpiryPlanSchema,
  PriceBandGuardInputSchema,
  PriceBandGuardDecisionSchema,
  TradingPhaseGuardDecisionSchema,
  TradingPhaseGuardPolicySchema,
  TradingPhaseGuardStateSchema,
  type CanonicalInstrumentPricePolicy,
  type CanonicalTradingPhaseEvent,
  type DayOrderExpiryCandidate,
  type DayOrderExpiryPlan,
  type PriceBandGuardInput,
  type PriceBandGuardDecision,
  type TradingPhaseCapability,
  type TradingPhaseGuardDecision,
  type TradingPhaseGuardPolicy,
  type TradingPhaseGuardState,
} from "../contracts/trading-phase.js";

function decimalParts(value: string): { coefficient: bigint; scale: number } {
  const negative = value.startsWith("-");
  const unsigned = /^[+-]/.test(value) ? value.slice(1) : value;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const coefficient = BigInt(`${whole}${fraction}`);
  return {
    coefficient: negative ? -coefficient : coefficient,
    scale: fraction.length,
  };
}

function alignDecimal(
  left: string,
  right: string,
): [left: bigint, right: bigint] {
  const leftParts = decimalParts(left);
  const rightParts = decimalParts(right);
  const scale = Math.max(leftParts.scale, rightParts.scale);
  return [
    leftParts.coefficient * 10n ** BigInt(scale - leftParts.scale),
    rightParts.coefficient * 10n ** BigInt(scale - rightParts.scale),
  ];
}

function compareDecimal(left: string, right: string): number {
  const [leftCoefficient, rightCoefficient] = alignDecimal(left, right);
  return leftCoefficient < rightCoefficient
    ? -1
    : leftCoefficient > rightCoefficient
      ? 1
      : 0;
}

function isTickAligned(price: string, tickSize: string): boolean {
  const [priceCoefficient, tickCoefficient] = alignDecimal(price, tickSize);
  return tickCoefficient > 0n && priceCoefficient % tickCoefficient === 0n;
}

function phaseCapability(
  state: TradingPhaseGuardState,
  auctionPrintReady = false,
): TradingPhaseCapability {
  if (state.phase === "CLOSED") {
    return {
      canAcceptLocalOrder: false,
      canFillContinuous: false,
      canProgressQueue: false,
      canAllocateAuctionPrint: false,
      shouldScanDayOrdersForExpiry: true,
      reason: "CLOSED",
    };
  }
  if (state.phase === "VI_PAUSED") {
    return {
      canAcceptLocalOrder: false,
      canFillContinuous: false,
      canProgressQueue: false,
      canAllocateAuctionPrint: false,
      shouldScanDayOrdersForExpiry: false,
      reason: "VI_PAUSED",
    };
  }
  if (state.phase === "REGULAR_CONTINUOUS") {
    const ready = state.continuousReadiness === "READY";
    return {
      canAcceptLocalOrder: ready,
      canFillContinuous: ready,
      canProgressQueue: ready,
      canAllocateAuctionPrint: false,
      shouldScanDayOrdersForExpiry: false,
      reason: ready ? "READY" : "SNAPSHOT_RESYNC_REQUIRED",
    };
  }
  return {
    canAcceptLocalOrder: false,
    canFillContinuous: false,
    canProgressQueue: false,
    canAllocateAuctionPrint: auctionPrintReady,
    shouldScanDayOrdersForExpiry: false,
    reason: auctionPrintReady
      ? "AUCTION_PRINT_READY"
      : "AUCTION_PRINT_REQUIRED",
  };
}

function decision(
  state: TradingPhaseGuardState,
  policy: TradingPhaseGuardPolicy,
  accepted: boolean,
  rejectionCode: TradingPhaseGuardDecision["rejectionCode"],
  plannedActions: TradingPhaseGuardDecision["plannedActions"] = [],
  auctionPrintReady = false,
): TradingPhaseGuardDecision {
  return TradingPhaseGuardDecisionSchema.parse({
    accepted,
    rejectionCode,
    state,
    capability: phaseCapability(state, auctionPrintReady),
    plannedActions,
    policyVersion: policy.version,
  });
}

function isEventTooOld(
  occurredAt: string,
  evaluatedAt: string,
  maximumAgeMs: number,
): boolean {
  const eventTime = Date.parse(occurredAt);
  const evaluationTime = Date.parse(evaluatedAt);
  return (
    !Number.isFinite(eventTime) ||
    !Number.isFinite(evaluationTime) ||
    eventTime > evaluationTime ||
    evaluationTime - eventTime > maximumAgeMs
  );
}

export function createTradingPhaseGuardState(input: {
  instrumentId: string;
  venue: string;
  tradingDayId: string;
  sessionKey: string;
  phase: TradingPhaseGuardState["phase"];
}): TradingPhaseGuardState {
  return TradingPhaseGuardStateSchema.parse({
    ...input,
    lastSequence: null,
    lastMarketEventId: null,
    continuousReadiness: "READY",
    resyncAfterSequence: null,
    resyncAfterOccurredAt: null,
    lastFreshSnapshotEventId: null,
    finalizedAuctionPrintEventId: null,
  });
}

export function advanceTradingPhaseGuard(input: {
  state: TradingPhaseGuardState;
  event: CanonicalTradingPhaseEvent;
  policy: TradingPhaseGuardPolicy;
  evaluatedAt: string;
}): TradingPhaseGuardDecision {
  const state = TradingPhaseGuardStateSchema.parse(input.state);
  const event = CanonicalTradingPhaseEventSchema.parse(input.event);
  const policy = TradingPhaseGuardPolicySchema.parse(input.policy);

  if (event.instrumentId !== state.instrumentId) {
    return decision(state, policy, false, "INSTRUMENT_MISMATCH");
  }
  if (event.venue !== state.venue) {
    return decision(state, policy, false, "VENUE_MISMATCH");
  }
  if (event.freshness === "DELAYED") {
    return decision(state, policy, false, "DELAYED_MARKET_DATA");
  }
  if (
    event.freshness === "STALE" ||
    isEventTooOld(event.occurredAt, input.evaluatedAt, policy.maxEventAgeMs)
  ) {
    return decision(state, policy, false, "STALE_MARKET_DATA");
  }

  const sessionBoundary =
    event.kind === "PHASE_TRANSITION" &&
    event.reason === "SESSION_BOUNDARY";
  if (
    sessionBoundary &&
    event.tradingDayId === state.tradingDayId &&
    event.sessionKey === state.sessionKey
  ) {
    return decision(state, policy, false, "INVALID_PHASE_TRANSITION");
  }
  if (event.tradingDayId !== state.tradingDayId && !sessionBoundary) {
    return decision(state, policy, false, "TRADING_DAY_MISMATCH");
  }
  if (event.sessionKey !== state.sessionKey && !sessionBoundary) {
    return decision(state, policy, false, "SESSION_MISMATCH");
  }
  if (
    !sessionBoundary &&
    state.lastSequence !== null &&
    BigInt(event.sequence) <= BigInt(state.lastSequence)
  ) {
    return decision(state, policy, false, "OUT_OF_ORDER_EVENT");
  }

  if (sessionBoundary) {
    const requiresSnapshot = event.phase === "REGULAR_CONTINUOUS";
    const nextState = TradingPhaseGuardStateSchema.parse({
      ...state,
      tradingDayId: event.tradingDayId,
      sessionKey: event.sessionKey,
      phase: event.phase,
      lastSequence: event.sequence,
      lastMarketEventId: event.marketEventId,
      continuousReadiness: requiresSnapshot
        ? "REQUIRED_AFTER_SESSION_BOUNDARY"
        : "READY",
      resyncAfterSequence: requiresSnapshot ? event.sequence : null,
      resyncAfterOccurredAt: requiresSnapshot ? event.occurredAt : null,
      lastFreshSnapshotEventId: null,
      finalizedAuctionPrintEventId: null,
    });
    return decision(
      nextState,
      policy,
      true,
      null,
      requiresSnapshot ? ["REQUIRE_FRESH_SNAPSHOT_RESYNC"] : [],
    );
  }

  if (event.kind === "PHASE_TRANSITION") {
    if (
      event.reason === "VI_TRIGGERED" &&
      state.phase !== "REGULAR_CONTINUOUS"
    ) {
      return decision(state, policy, false, "INVALID_PHASE_TRANSITION");
    }
    if (
      event.reason === "VI_RELEASED" &&
      state.phase !== "VI_PAUSED"
    ) {
      return decision(state, policy, false, "INVALID_PHASE_TRANSITION");
    }
    const leavingViForContinuous =
      state.phase === "VI_PAUSED" &&
      event.phase === "REGULAR_CONTINUOUS";
    const enteredVi = event.phase === "VI_PAUSED";
    const requireResync = enteredVi || leavingViForContinuous;
    const nextState = TradingPhaseGuardStateSchema.parse({
      ...state,
      phase: event.phase,
      lastSequence: event.sequence,
      lastMarketEventId: event.marketEventId,
      continuousReadiness: requireResync
        ? "REQUIRED_AFTER_VI"
        : state.continuousReadiness,
      resyncAfterSequence: requireResync
        ? event.sequence
        : state.resyncAfterSequence,
      resyncAfterOccurredAt: requireResync
        ? event.occurredAt
        : state.resyncAfterOccurredAt,
      finalizedAuctionPrintEventId: null,
    });
    const actions: TradingPhaseGuardDecision["plannedActions"] = [];
    if (enteredVi) actions.push("PAUSE_CONTINUOUS_FILL");
    if (requireResync) actions.push("REQUIRE_FRESH_SNAPSHOT_RESYNC");
    if (event.phase === "CLOSED") {
      actions.push("SCAN_DAY_ORDERS_FOR_EXPIRY");
    }
    return decision(nextState, policy, true, null, actions);
  }

  if (event.phase !== state.phase) {
    return decision(state, policy, false, "PHASE_MISMATCH");
  }

  if (event.kind === "ORDER_BOOK_SNAPSHOT") {
    const resyncRequired = state.continuousReadiness !== "READY";
    const afterRequiredBoundary =
      state.resyncAfterSequence !== null &&
      state.resyncAfterOccurredAt !== null &&
      BigInt(event.sequence) > BigInt(state.resyncAfterSequence) &&
      Date.parse(event.occurredAt) > Date.parse(state.resyncAfterOccurredAt);
    if (
      resyncRequired &&
      (event.phase !== "REGULAR_CONTINUOUS" ||
        !event.complete ||
        !afterRequiredBoundary)
    ) {
      return decision(state, policy, false, "FRESH_SNAPSHOT_REQUIRED");
    }
    const nextState = TradingPhaseGuardStateSchema.parse({
      ...state,
      lastSequence: event.sequence,
      lastMarketEventId: event.marketEventId,
      continuousReadiness: resyncRequired
        ? "READY"
        : state.continuousReadiness,
      resyncAfterSequence: resyncRequired ? null : state.resyncAfterSequence,
      resyncAfterOccurredAt: resyncRequired
        ? null
        : state.resyncAfterOccurredAt,
      lastFreshSnapshotEventId: event.complete
        ? event.marketEventId
        : state.lastFreshSnapshotEventId,
    });
    return decision(
      nextState,
      policy,
      true,
      null,
      resyncRequired ? ["CONTINUOUS_FILL_RESYNCED"] : [],
    );
  }

  if (!event.finalized) {
    return decision(state, policy, false, "AUCTION_PRINT_REQUIRED");
  }
  const nextState = TradingPhaseGuardStateSchema.parse({
    ...state,
    lastSequence: event.sequence,
    lastMarketEventId: event.marketEventId,
    finalizedAuctionPrintEventId: event.marketEventId,
  });
  return decision(
    nextState,
    policy,
    true,
    null,
    ["AUCTION_PRINT_READY"],
    true,
  );
}

function resolveTickSize(
  policy: CanonicalInstrumentPricePolicy,
  price: string,
): string | null {
  if (policy.tickRule.kind === "FIXED") return policy.tickRule.tickSize;
  return (
    policy.tickRule.bands.find(
      (band) =>
        compareDecimal(price, band.minimumInclusive) >= 0 &&
        (band.maximumExclusive === null ||
          compareDecimal(price, band.maximumExclusive) < 0),
    )?.tickSize ?? null
  );
}

export function guardPriceAgainstInjectedPolicy(input: {
  instrumentId: string;
  venue: string;
  price: string;
  policy: CanonicalInstrumentPricePolicy;
  evaluatedAt: string;
}): PriceBandGuardDecision {
  const parsedInput: PriceBandGuardInput =
    PriceBandGuardInputSchema.parse(input);
  const policy = parsedInput.policy;
  const common = {
    normalizedPrice: parsedInput.price,
    policyVersion: policy.version,
    evidenceIds: policy.evidenceIds,
  };
  if (parsedInput.instrumentId !== policy.instrumentId) {
    return PriceBandGuardDecisionSchema.parse({
      ...common,
      accepted: false,
      rejectionCode: "INSTRUMENT_MISMATCH",
      resolvedTickSize: null,
    });
  }
  if (parsedInput.venue !== policy.venue) {
    return PriceBandGuardDecisionSchema.parse({
      ...common,
      accepted: false,
      rejectionCode: "VENUE_MISMATCH",
      resolvedTickSize: null,
    });
  }
  const evaluated = Date.parse(parsedInput.evaluatedAt);
  if (
    !Number.isFinite(evaluated) ||
    evaluated < Date.parse(policy.effectiveFrom) ||
    (policy.effectiveTo !== null &&
      evaluated >= Date.parse(policy.effectiveTo))
  ) {
    return PriceBandGuardDecisionSchema.parse({
      ...common,
      accepted: false,
      rejectionCode: "POLICY_NOT_EFFECTIVE",
      resolvedTickSize: null,
    });
  }
  if (compareDecimal(parsedInput.price, policy.lowerLimitPrice) < 0) {
    return PriceBandGuardDecisionSchema.parse({
      ...common,
      accepted: false,
      rejectionCode: "PRICE_BELOW_LOWER_LIMIT",
      resolvedTickSize: null,
    });
  }
  if (compareDecimal(parsedInput.price, policy.upperLimitPrice) > 0) {
    return PriceBandGuardDecisionSchema.parse({
      ...common,
      accepted: false,
      rejectionCode: "PRICE_ABOVE_UPPER_LIMIT",
      resolvedTickSize: null,
    });
  }
  const tickSize = resolveTickSize(policy, parsedInput.price);
  if (tickSize === null || !isTickAligned(parsedInput.price, tickSize)) {
    return PriceBandGuardDecisionSchema.parse({
      ...common,
      accepted: false,
      rejectionCode: "INVALID_TICK",
      resolvedTickSize: tickSize,
    });
  }
  return PriceBandGuardDecisionSchema.parse({
    ...common,
    accepted: true,
    rejectionCode: null,
    resolvedTickSize: tickSize,
  });
}

export function planDayOrderExpiry(input: {
  order: DayOrderExpiryCandidate;
  market: TradingPhaseGuardState;
}): DayOrderExpiryPlan {
  const order = DayOrderExpiryCandidateSchema.parse(input.order);
  const market = TradingPhaseGuardStateSchema.parse(input.market);
  const noAction = (
    reason: Exclude<
      DayOrderExpiryPlan["reason"],
      "CLOSED_DAY_ORDER"
    >,
  ): DayOrderExpiryPlan =>
    DayOrderExpiryPlanSchema.parse({
      shouldExpire: false,
      reason,
      event: null,
    });

  if (order.instrumentId !== market.instrumentId) {
    return noAction("INSTRUMENT_MISMATCH");
  }
  if (order.venue !== market.venue) return noAction("VENUE_MISMATCH");
  if (order.tradingDayId !== market.tradingDayId) {
    return noAction("TRADING_DAY_MISMATCH");
  }
  if (market.phase !== "CLOSED") return noAction("MARKET_NOT_CLOSED");
  const open =
    ["ACCEPTED", "RESTING", "PARTIALLY_FILLED"].includes(order.status) &&
    BigInt(order.remainingQuantity) > 0n;
  if (!open) return noAction("ORDER_NOT_OPEN");
  return DayOrderExpiryPlanSchema.parse({
    shouldExpire: true,
    reason: "CLOSED_DAY_ORDER",
    event: {
      type: "ORDER_DAY_EXPIRY_REQUESTED",
      clientOrderId: order.clientOrderId,
      remainingQuantity: order.remainingQuantity,
      terminalStatus: "EXPIRED",
      owner: "DB_TRANSACTION_OWNER",
      idempotencyKey: `${order.clientOrderId}:${order.tradingDayId}:DAY_EXPIRE`,
      tradingDayId: order.tradingDayId,
    },
  });
}
