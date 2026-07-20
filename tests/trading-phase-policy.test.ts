import { describe, expect, it } from "vitest";

import {
  CanonicalInstrumentPricePolicySchema,
  CanonicalTradingPhaseSchema,
  type CanonicalInstrumentPricePolicy,
  type CanonicalTradingPhaseEvent,
} from "../src/contracts/trading-phase.js";
import {
  advanceTradingPhaseGuard,
  createTradingPhaseGuardState,
  guardPriceAgainstInjectedPolicy,
  planDayOrderExpiry,
} from "../src/simulation/trading-phase-policy.js";

const now = "2026-07-20T01:00:10.000Z";
const policy = { version: "phase-fixture-v1", maxEventAgeMs: 30_000 };

function phaseEvent(
  overrides: Partial<CanonicalTradingPhaseEvent> = {},
): CanonicalTradingPhaseEvent {
  return {
    kind: "PHASE_TRANSITION",
    instrumentId: "XTEST:ABC",
    venue: "XTEST",
    tradingDayId: "XTEST:2026-07-20",
    sessionKey: "XTEST:2026-07-20:REGULAR",
    marketEventId: "phase-1",
    sequence: "1",
    occurredAt: "2026-07-20T01:00:00.000Z",
    receivedAt: "2026-07-20T01:00:00.100Z",
    freshness: "LIVE",
    source: "CANONICAL_MARKET_DATA",
    phase: "REGULAR_CONTINUOUS",
    reason: "CALENDAR",
    ...overrides,
  } as CanonicalTradingPhaseEvent;
}

describe("canonical trading phase and market guards", () => {
  it("exposes every explicit continuous, VI, auction and closed phase", () => {
    for (const phase of [
      "PREOPEN_AUCTION",
      "REGULAR_CONTINUOUS",
      "VI_PAUSED",
      "CLOSING_AUCTION",
      "AFTER_HOURS_AUCTION",
      "CLOSED",
    ]) {
      expect(CanonicalTradingPhaseSchema.parse(phase)).toBe(phase);
    }
  });

  it("pauses at VI and requires a newer complete live snapshot after release", () => {
    const initial = createTradingPhaseGuardState({
      instrumentId: "XTEST:ABC",
      venue: "XTEST",
      tradingDayId: "XTEST:2026-07-20",
      sessionKey: "XTEST:2026-07-20:REGULAR",
      phase: "REGULAR_CONTINUOUS",
    });
    const paused = advanceTradingPhaseGuard({
      state: initial,
      event: phaseEvent({
        phase: "VI_PAUSED",
        reason: "VI_TRIGGERED",
      }),
      policy,
      evaluatedAt: now,
    });
    expect(paused.accepted).toBe(true);
    expect(paused.capability.canFillContinuous).toBe(false);
    expect(paused.plannedActions).toContain("PAUSE_CONTINUOUS_FILL");

    const released = advanceTradingPhaseGuard({
      state: paused.state,
      event: phaseEvent({
        marketEventId: "vi-release",
        sequence: "2",
        occurredAt: "2026-07-20T01:00:02.000Z",
        phase: "REGULAR_CONTINUOUS",
        reason: "VI_RELEASED",
      }),
      policy,
      evaluatedAt: now,
    });
    expect(released.state.continuousReadiness).toBe("REQUIRED_AFTER_VI");
    expect(released.capability.canProgressQueue).toBe(false);

    const sameBoundarySnapshot = advanceTradingPhaseGuard({
      state: released.state,
      event: phaseEvent({
        kind: "ORDER_BOOK_SNAPSHOT",
        marketEventId: "book-old",
        sequence: "2",
        occurredAt: "2026-07-20T01:00:02.000Z",
        phase: "REGULAR_CONTINUOUS",
        complete: true,
      }),
      policy,
      evaluatedAt: now,
    });
    expect(sameBoundarySnapshot.rejectionCode).toBe("OUT_OF_ORDER_EVENT");
    expect(sameBoundarySnapshot.capability.canFillContinuous).toBe(false);

    const freshSnapshot = advanceTradingPhaseGuard({
      state: released.state,
      event: phaseEvent({
        kind: "ORDER_BOOK_SNAPSHOT",
        marketEventId: "book-fresh",
        sequence: "3",
        occurredAt: "2026-07-20T01:00:03.000Z",
        phase: "REGULAR_CONTINUOUS",
        complete: true,
      }),
      policy,
      evaluatedAt: now,
    });
    expect(freshSnapshot.accepted).toBe(true);
    expect(freshSnapshot.state.continuousReadiness).toBe("READY");
    expect(freshSnapshot.capability.canFillContinuous).toBe(true);
    expect(freshSnapshot.plannedActions).toEqual([
      "CONTINUOUS_FILL_RESYNCED",
    ]);
  });

  it("does not let incomplete, stale or pre-release snapshots clear VI resync", () => {
    const state = createTradingPhaseGuardState({
      instrumentId: "XTEST:ABC",
      venue: "XTEST",
      tradingDayId: "XTEST:2026-07-20",
      sessionKey: "XTEST:2026-07-20:REGULAR",
      phase: "REGULAR_CONTINUOUS",
    });
    const releasedState = {
      ...state,
      lastSequence: "10",
      lastMarketEventId: "vi-release",
      continuousReadiness: "REQUIRED_AFTER_VI" as const,
      resyncAfterSequence: "10",
      resyncAfterOccurredAt: "2026-07-20T01:00:00.000Z",
    };
    const incomplete = advanceTradingPhaseGuard({
      state: releasedState,
      event: phaseEvent({
        kind: "ORDER_BOOK_SNAPSHOT",
        marketEventId: "book-incomplete",
        sequence: "11",
        occurredAt: "2026-07-20T01:00:01.000Z",
        complete: false,
      }),
      policy,
      evaluatedAt: now,
    });
    expect(incomplete.rejectionCode).toBe("FRESH_SNAPSHOT_REQUIRED");

    const stale = advanceTradingPhaseGuard({
      state: releasedState,
      event: phaseEvent({
        kind: "ORDER_BOOK_SNAPSHOT",
        marketEventId: "book-stale",
        sequence: "11",
        occurredAt: "2026-07-20T01:00:01.000Z",
        complete: true,
        freshness: "STALE",
      }),
      policy,
      evaluatedAt: now,
    });
    expect(stale.rejectionCode).toBe("STALE_MARKET_DATA");
    expect(stale.state.continuousReadiness).toBe("REQUIRED_AFTER_VI");
  });

  it("requires a finalized auction print and exposes allocation only for that event", () => {
    const auctionState = createTradingPhaseGuardState({
      instrumentId: "XTEST:ABC",
      venue: "XTEST",
      tradingDayId: "XTEST:2026-07-20",
      sessionKey: "XTEST:2026-07-20:CLOSE_AUCTION",
      phase: "CLOSING_AUCTION",
    });
    const unfinalized = advanceTradingPhaseGuard({
      state: auctionState,
      event: phaseEvent({
        kind: "AUCTION_PRINT",
        phase: "CLOSING_AUCTION",
        sessionKey: auctionState.sessionKey,
        finalized: false,
        clearingPrice: "107.5",
        matchedQuantity: "40",
      }),
      policy,
      evaluatedAt: now,
    });
    expect(unfinalized.rejectionCode).toBe("AUCTION_PRINT_REQUIRED");
    expect(unfinalized.capability.canAllocateAuctionPrint).toBe(false);

    const finalized = advanceTradingPhaseGuard({
      state: auctionState,
      event: phaseEvent({
        kind: "AUCTION_PRINT",
        phase: "CLOSING_AUCTION",
        sessionKey: auctionState.sessionKey,
        finalized: true,
        clearingPrice: "107.5",
        matchedQuantity: "40",
      }),
      policy,
      evaluatedAt: now,
    });
    expect(finalized.accepted).toBe(true);
    expect(finalized.capability.canAllocateAuctionPrint).toBe(true);
    expect(finalized.state.finalizedAuctionPrintEventId).toBe("phase-1");
  });

  it("resets sequence scope at a declared session boundary and gates regular fill", () => {
    const prior = {
      ...createTradingPhaseGuardState({
        instrumentId: "XTEST:ABC",
        venue: "XTEST",
        tradingDayId: "XTEST:2026-07-19",
        sessionKey: "XTEST:2026-07-19:REGULAR",
        phase: "CLOSED" as const,
      }),
      lastSequence: "999",
      lastMarketEventId: "prior-close",
    };
    const boundary = advanceTradingPhaseGuard({
      state: prior,
      event: phaseEvent({
        tradingDayId: "XTEST:2026-07-20",
        sessionKey: "XTEST:2026-07-20:REGULAR",
        sequence: "1",
        reason: "SESSION_BOUNDARY",
      }),
      policy,
      evaluatedAt: now,
    });
    expect(boundary.accepted).toBe(true);
    expect(boundary.state.lastSequence).toBe("1");
    expect(boundary.state.continuousReadiness).toBe(
      "REQUIRED_AFTER_SESSION_BOUNDARY",
    );
    expect(boundary.capability.canAcceptLocalOrder).toBe(false);
  });

  it("rejects a fake boundary and a VI release outside a VI pause", () => {
    const regular = createTradingPhaseGuardState({
      instrumentId: "XTEST:ABC",
      venue: "XTEST",
      tradingDayId: "XTEST:2026-07-20",
      sessionKey: "XTEST:2026-07-20:REGULAR",
      phase: "REGULAR_CONTINUOUS",
    });
    expect(
      advanceTradingPhaseGuard({
        state: regular,
        event: phaseEvent({ reason: "SESSION_BOUNDARY" }),
        policy,
        evaluatedAt: now,
      }).rejectionCode,
    ).toBe("INVALID_PHASE_TRANSITION");
    expect(
      advanceTradingPhaseGuard({
        state: regular,
        event: phaseEvent({ reason: "VI_RELEASED" }),
        policy,
        evaluatedAt: now,
      }).rejectionCode,
    ).toBe("INVALID_PHASE_TRANSITION");
  });

  it("plans idempotent DAY expiry only for an open order on its closed day", () => {
    const closed = createTradingPhaseGuardState({
      instrumentId: "XTEST:ABC",
      venue: "XTEST",
      tradingDayId: "XTEST:2026-07-20",
      sessionKey: "XTEST:2026-07-20:CLOSED",
      phase: "CLOSED",
    });
    const openOrder = {
      clientOrderId: "paper-1",
      instrumentId: "XTEST:ABC",
      venue: "XTEST",
      tradingDayId: "XTEST:2026-07-20",
      timeInForce: "DAY" as const,
      status: "PARTIALLY_FILLED" as const,
      remainingQuantity: "7",
    };
    const plan = planDayOrderExpiry({ order: openOrder, market: closed });
    expect(plan.shouldExpire).toBe(true);
    expect(plan.event).toEqual(
      expect.objectContaining({
        terminalStatus: "EXPIRED",
        remainingQuantity: "7",
        owner: "DB_TRANSACTION_OWNER",
        idempotencyKey: "paper-1:XTEST:2026-07-20:DAY_EXPIRE",
      }),
    );
    expect(
      planDayOrderExpiry({
        order: { ...openOrder, status: "FILLED", remainingQuantity: "0" },
        market: closed,
      }).reason,
    ).toBe("ORDER_NOT_OPEN");
    expect(
      planDayOrderExpiry({
        order: { ...openOrder, tradingDayId: "XTEST:2026-07-19" },
        market: closed,
      }).reason,
    ).toBe("TRADING_DAY_MISMATCH");
  });
});

describe("injected exact price-band and tick policy", () => {
  const bandedPolicy: CanonicalInstrumentPricePolicy = {
    instrumentId: "XTEST:ABC",
    venue: "XTEST",
    version: "x-test-band-v1",
    effectiveFrom: "2026-07-20T00:00:00.000Z",
    effectiveTo: "2026-07-21T00:00:00.000Z",
    lowerLimitPrice: "80",
    upperLimitPrice: "140",
    tickRule: {
      kind: "BANDED",
      bands: [
        {
          minimumInclusive: "0",
          maximumExclusive: "100",
          tickSize: "0.1",
        },
        {
          minimumInclusive: "100",
          maximumExclusive: null,
          tickSize: "0.5",
        },
      ],
    },
    evidenceIds: ["official-fixture-policy"],
  };

  it("resolves injected band boundaries without hard-coded venue values", () => {
    expect(
      guardPriceAgainstInjectedPolicy({
        instrumentId: "XTEST:ABC",
        venue: "XTEST",
        price: "99.9",
        policy: bandedPolicy,
        evaluatedAt: now,
      }),
    ).toMatchObject({
      accepted: true,
      resolvedTickSize: "0.1",
      policyVersion: "x-test-band-v1",
    });
    expect(
      guardPriceAgainstInjectedPolicy({
        instrumentId: "XTEST:ABC",
        venue: "XTEST",
        price: "100.5",
        policy: bandedPolicy,
        evaluatedAt: now,
      }),
    ).toMatchObject({ accepted: true, resolvedTickSize: "0.5" });
    expect(
      guardPriceAgainstInjectedPolicy({
        instrumentId: "XTEST:ABC",
        venue: "XTEST",
        price: "100.1",
        policy: bandedPolicy,
        evaluatedAt: now,
      }).rejectionCode,
    ).toBe("INVALID_TICK");
  });

  it("rejects prices outside the injected daily range and inactive policies", () => {
    expect(
      guardPriceAgainstInjectedPolicy({
        instrumentId: "XTEST:ABC",
        venue: "XTEST",
        price: "79.9",
        policy: bandedPolicy,
        evaluatedAt: now,
      }).rejectionCode,
    ).toBe("PRICE_BELOW_LOWER_LIMIT");
    expect(
      guardPriceAgainstInjectedPolicy({
        instrumentId: "XTEST:ABC",
        venue: "XTEST",
        price: "140.5",
        policy: bandedPolicy,
        evaluatedAt: now,
      }).rejectionCode,
    ).toBe("PRICE_ABOVE_UPPER_LIMIT");
    expect(
      guardPriceAgainstInjectedPolicy({
        instrumentId: "XTEST:ABC",
        venue: "XTEST",
        price: "100.5",
        policy: bandedPolicy,
        evaluatedAt: "2026-07-21T00:00:00.000Z",
      }).rejectionCode,
    ).toBe("POLICY_NOT_EFFECTIVE");
  });

  it("rejects malformed band gaps at the contract boundary", () => {
    expect(() =>
      CanonicalInstrumentPricePolicySchema.parse({
        ...bandedPolicy,
        tickRule: {
          kind: "BANDED",
          bands: [
            {
              minimumInclusive: "0",
              maximumExclusive: "100",
              tickSize: "0.1",
            },
            {
              minimumInclusive: "101",
              maximumExclusive: null,
              tickSize: "0.5",
            },
          ],
        },
      }),
    ).toThrow();
    expect(() =>
      CanonicalInstrumentPricePolicySchema.parse({
        ...bandedPolicy,
        upperLimitPrice: "140.1",
      }),
    ).toThrow();
  });

  it("supports an injected fixed tick policy with exact decimal arithmetic", () => {
    const fixedPolicy: CanonicalInstrumentPricePolicy = {
      ...bandedPolicy,
      version: "x-test-fixed-v1",
      tickRule: { kind: "FIXED", tickSize: "0.25" },
    };
    expect(
      guardPriceAgainstInjectedPolicy({
        instrumentId: "XTEST:ABC",
        venue: "XTEST",
        price: "100.50",
        policy: fixedPolicy,
        evaluatedAt: now,
      }).accepted,
    ).toBe(true);
    expect(
      guardPriceAgainstInjectedPolicy({
        instrumentId: "XTEST:ABC",
        venue: "XTEST",
        price: "100.40",
        policy: fixedPolicy,
        evaluatedAt: now,
      }).rejectionCode,
    ).toBe("INVALID_TICK");
  });
});
