import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  acceptAdvancedQueueEstimate,
  createOrderBookClickDraft,
  planAdvancedQueueProgress,
  planImmediateBookFills,
  planPassiveTradeThroughFill,
  planVerifiedImmediateBookFills,
  resolvePolicyTickSize,
} from "../src/simulation/orderbook-paper-engine.js";
import {
  OpenPaperOrderSchema,
  PaperExecutionPlanSchema,
  PaperFillPolicySchema,
  PaperOrderCommandSchema,
  PaperPlannerStateSchema,
} from "../src/contracts/paper-order.js";

const now = "2026-07-20T01:00:10.000Z";
const occurredAt = "2026-07-20T01:00:09.000Z";

const policy = {
  maxMarketDataAgeMs: 2_000,
  passiveFillModel: "AT_OR_THROUGH" as const,
  marketRemainder: "CANCEL" as const,
  marketableLimitRemainder: "REST" as const,
  vwapScale: 8,
  version: "INITIAL_CONSERVATIVE_V1",
  tickRule: {
    kind: "FIXED" as const,
    venue: "KRX",
    version: "KRX_TEST_V1",
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    effectiveTo: null,
    tickSize: "1",
  },
  minimumPrice: "1",
  maximumPrice: "1000000",
};

const emptyState = {
  seenClientOrderIds: [],
  lastOrderBookSequence: null,
  lastTradeSequence: null,
  cursorScope: null,
};

function order(
  overrides: Partial<{
    clientOrderId: string;
    side: "BUY" | "SELL";
    orderType: "MARKET" | "LIMIT";
    quantity: string;
    limitPrice: string | null;
  }> = {},
) {
  return {
    clientOrderId: overrides.clientOrderId ?? "order-1",
    accountId: "paper-account",
    instrumentId: "KRX:005930",
    venue: "KRX",
    currency: "KRW",
    side: overrides.side ?? "BUY",
    orderType: overrides.orderType ?? "LIMIT",
    quantity: overrides.quantity ?? "10",
    limitPrice:
      overrides.limitPrice === undefined ? "100" : overrides.limitPrice,
    timeInForce: "DAY" as const,
    session: "REGULAR" as const,
    submittedAt: "2026-07-20T01:00:00.000Z",
    submissionMode: "CONFIRM_TICKET" as const,
    simulationOnly: true as const,
  };
}

function book(
  overrides: Partial<{
    marketEventId: string;
    sequence: string;
    freshness: "LIVE" | "DELAYED" | "STALE";
    instrumentId: string;
    venue: string;
    currency: string;
    tradingPhase:
      | "PREOPEN_AUCTION"
      | "REGULAR_CONTINUOUS"
      | "VI_PAUSED"
      | "CLOSING_AUCTION"
      | "AFTER_HOURS_AUCTION"
      | "CLOSED";
    bids: { price: string; quantity: string }[];
    asks: { price: string; quantity: string }[];
  }> = {},
) {
  return {
    kind: "ORDER_BOOK" as const,
    marketEventId: overrides.marketEventId ?? "book-1",
    sequence: overrides.sequence ?? "1",
    currency: overrides.currency ?? "KRW",
    freshness: overrides.freshness ?? ("LIVE" as const),
    receivedAt: occurredAt,
    tradingPhase: overrides.tradingPhase ?? ("REGULAR_CONTINUOUS" as const),
    sessionKey: "KRX:2026-07-20:REGULAR",
    snapshot: {
      instrumentId: overrides.instrumentId ?? "KRX:005930",
      venue: overrides.venue ?? "KRX",
      bids: overrides.bids ?? [{ price: "99", quantity: "100" }],
      asks: overrides.asks ?? [{ price: "101", quantity: "100" }],
      totalBidQuantity: "100",
      totalAskQuantity: "100",
      occurredAt,
      providerDate: "20260720",
      providerTime: "100009",
      source: "KIS_WS" as const,
    },
  };
}

function trade(
  price: string,
  quantity = "10",
  overrides: Partial<{
    marketEventId: string;
    sequence: string;
    freshness: "LIVE" | "DELAYED" | "STALE";
    tradingPhase:
      | "PREOPEN_AUCTION"
      | "REGULAR_CONTINUOUS"
      | "VI_PAUSED"
      | "CLOSING_AUCTION"
      | "AFTER_HOURS_AUCTION"
      | "CLOSED";
    auction: { finalized: boolean; clearingPrice: string } | null;
  }> = {},
) {
  return {
    kind: "TRADE_TICK" as const,
    marketEventId: overrides.marketEventId ?? "trade-1",
    sequence: overrides.sequence ?? "1",
    currency: "KRW",
    freshness: overrides.freshness ?? ("LIVE" as const),
    receivedAt: occurredAt,
    tradingPhase: overrides.tradingPhase ?? ("REGULAR_CONTINUOUS" as const),
    sessionKey: "KRX:2026-07-20:REGULAR",
    auction: overrides.auction ?? null,
    tick: {
      instrumentId: "KRX:005930",
      venue: "KRX",
      session: "REGULAR" as const,
      price,
      quantity,
      change: null,
      changeRate: null,
      cumulativeVolume: null,
      cumulativeTurnover: null,
      occurredAt,
      providerDate: "20260720",
      providerTime: "100009",
      source: "KIS_WS" as const,
    },
  };
}

describe("orderbook paper trading", () => {
  it("maps ask clicks to BUY and bid clicks to SELL limit drafts", () => {
    const base = {
      rowPrice: "100",
      quantity: "2",
      clientOrderId: "click-1",
      accountId: "paper-account",
      instrumentId: "KRX:005930",
      venue: "KRX",
      currency: "KRW",
      clickedAt: now,
      oneClickArmed: false,
    };
    const buy = createOrderBookClickDraft({ ...base, rowSide: "ASK" });
    const sell = createOrderBookClickDraft({
      ...base,
      clientOrderId: "click-2",
      rowSide: "BID",
      oneClickArmed: true,
    });

    expect(buy.order.side).toBe("BUY");
    expect(buy.confirmationRequired).toBe(true);
    expect(buy.localSimulationLabel).toBe("로컬 모의주문");
    expect(sell.order.side).toBe("SELL");
    expect(sell.confirmationRequired).toBe(false);
    expect(sell.order.submissionMode).toBe("ONE_CLICK_ARMED");
  });

  it("walks book depth price-first and reports VWAP and partial remainder", () => {
    const plan = planImmediateBookFills({
      order: order({
        orderType: "MARKET",
        limitPrice: null,
        quantity: "15",
      }),
      market: book({
        asks: [
          { price: "102", quantity: "3" },
          { price: "100", quantity: "10" },
        ],
      }),
      state: emptyState,
      policy,
      evaluatedAt: now,
    });

    expect(plan.fills.map((fill) => [fill.price, fill.quantity])).toEqual([
      ["100", "10"],
      ["102", "3"],
    ]);
    expect(plan.filledQuantity).toBe("13");
    expect(plan.remainingQuantity).toBe("0");
    expect(plan.cancelledQuantity).toBe("2");
    expect(plan.grossNotional).toBe("1306");
    expect(plan.vwap).toBe("100.46153846");
    expect(plan.status).toBe("PARTIALLY_FILLED_CANCELLED");
    expect(plan.plannedEvents.at(-1)?.type).toBe("ORDER_REMAINDER_CANCELLED");
  });

  it("fills a passive limit when an actual trade reaches or crosses it", () => {
    const openOrder = {
      order: order(),
      status: "RESTING" as const,
      filledQuantity: "0",
      acceptedAt: "2026-07-20T01:00:01.000Z",
    };
    const touch = planPassiveTradeThroughFill({
      openOrder,
      trade: trade("100"),
      state: emptyState,
      policy,
      evaluatedAt: now,
    });
    expect(touch.fills[0]?.quantity).toBe("10");
    expect(touch.fills[0]?.price).toBe("100");
    expect(touch.rejectionCode).toBeNull();

    const through = planPassiveTradeThroughFill({
      openOrder,
      trade: trade("99", "4", { marketEventId: "trade-2", sequence: "2" }),
      state: emptyState,
      policy,
      evaluatedAt: now,
    });
    expect(through.fills[0]?.quantity).toBe("4");
    expect(through.fills[0]?.price).toBe("100");
    expect(through.remainingQuantity).toBe("6");
  });

  it("rejects stale, mismatched, duplicate, and out-of-order input", () => {
    const stale = planImmediateBookFills({
      order: order(),
      market: book({ freshness: "STALE" }),
      state: emptyState,
      policy,
      evaluatedAt: now,
    });
    expect(stale.rejectionCode).toBe("STALE_MARKET_DATA");

    const mismatch = planImmediateBookFills({
      order: order(),
      market: book({ currency: "USD" }),
      state: emptyState,
      policy,
      evaluatedAt: now,
    });
    expect(mismatch.rejectionCode).toBe("CURRENCY_MISMATCH");

    const duplicate = planImmediateBookFills({
      order: order(),
      market: book(),
      state: { ...emptyState, seenClientOrderIds: ["order-1"] },
      policy,
      evaluatedAt: now,
    });
    expect(duplicate.rejectionCode).toBe("DUPLICATE_CLIENT_ORDER_ID");
    expect(duplicate.nextState).toEqual({
      ...emptyState,
      seenClientOrderIds: ["order-1"],
    });

    const outOfOrder = planImmediateBookFills({
      order: order(),
      market: book({ sequence: "4" }),
      state: {
        ...emptyState,
        lastOrderBookSequence: "4",
        cursorScope: {
          instrumentId: "KRX:005930",
          sessionKey: "KRX:2026-07-20:REGULAR",
        },
      },
      policy,
      evaluatedAt: now,
    });
    expect(outOfOrder.rejectionCode).toBe("OUT_OF_ORDER_EVENT");
  });

  it("decrements an estimated advanced queue without double-counting book decrease", () => {
    const queue = acceptAdvancedQueueEstimate({
      order: order({ quantity: "30" }),
      market: book({
        sequence: "10",
        bids: [{ price: "100", quantity: "100" }],
      }),
      policy,
      safetyFactor: "1",
      evaluatedAt: now,
    });
    const first = planAdvancedQueueProgress({
      queue,
      trade: trade("100", "60", {
        marketEventId: "trade-q1",
        sequence: "11",
      }),
      book: book({
        marketEventId: "book-q1",
        sequence: "11",
        bids: [{ price: "100", quantity: "40" }],
      }),
      policy,
      evaluatedAt: now,
    });
    expect(first.state.aheadQuantityEstimate).toBe("40");
    expect(first.fill).toBeNull();
    expect(first.queueProgressQuantity).toBe("60");

    const second = planAdvancedQueueProgress({
      queue: first.state,
      trade: trade("100", "60", {
        marketEventId: "trade-q2",
        sequence: "12",
      }),
      book: book({
        marketEventId: "book-q2",
        sequence: "12",
        bids: [{ price: "100", quantity: "0" }],
      }),
      policy,
      evaluatedAt: now,
    });
    expect(second.state.aheadQuantityEstimate).toBe("0");
    expect(second.fill?.quantity).toBe("20");
    expect(second.state.remainingQuantity).toBe("10");
  });

  it("pauses advanced fills during VI and requires a finalized auction print", () => {
    const queue = acceptAdvancedQueueEstimate({
      order: order(),
      market: book({
        sequence: "10",
        bids: [{ price: "100", quantity: "100" }],
      }),
      policy,
      safetyFactor: "1.25",
      evaluatedAt: now,
    });
    const vi = planAdvancedQueueProgress({
      queue,
      trade: trade("99", "100", {
        marketEventId: "trade-vi",
        sequence: "11",
        tradingPhase: "VI_PAUSED",
      }),
      book: null,
      policy,
      evaluatedAt: now,
    });
    expect(vi.rejectionCode).toBe("VI_PAUSED");
    expect(vi.fill).toBeNull();

    const auctionQueue = { ...queue, sessionKey: "KRX:2026-07-20:AUCTION" };
    const auction = planAdvancedQueueProgress({
      queue: auctionQueue,
      trade: {
        ...trade("99", "100", {
          marketEventId: "trade-auction",
          sequence: "11",
          tradingPhase: "CLOSING_AUCTION",
          auction: { finalized: false, clearingPrice: "99" },
        }),
        sessionKey: "KRX:2026-07-20:AUCTION",
      },
      book: null,
      policy,
      evaluatedAt: now,
    });
    expect(auction.rejectionCode).toBe("AUCTION_PRINT_REQUIRED");
    expect(auction.fill).toBeNull();
  });

  it("never turns book-only queue decrease or stale book data into a fill", () => {
    const queue = acceptAdvancedQueueEstimate({
      order: order(),
      market: book({
        sequence: "10",
        bids: [{ price: "100", quantity: "100" }],
      }),
      policy,
      safetyFactor: "1",
      evaluatedAt: now,
    });
    const bookOnly = planAdvancedQueueProgress({
      queue: { ...queue, aheadQuantityEstimate: "0" },
      trade: trade("101", "10", {
        marketEventId: "trade-ineligible",
        sequence: "11",
      }),
      book: book({
        marketEventId: "book-decrease",
        sequence: "11",
        bids: [{ price: "100", quantity: "0" }],
      }),
      policy,
      evaluatedAt: now,
    });
    expect(bookOnly.fill).toBeNull();
    expect(bookOnly.state.remainingQuantity).toBe("10");

    const staleBook = planAdvancedQueueProgress({
      queue,
      trade: trade("100", "10", {
        marketEventId: "trade-with-stale-book",
        sequence: "11",
      }),
      book: book({
        marketEventId: "stale-book",
        sequence: "11",
        freshness: "STALE",
      }),
      policy,
      evaluatedAt: now,
    });
    expect(staleBook.rejectionCode).toBe("STALE_MARKET_DATA");
    expect(staleBook.fill).toBeNull();
  });

  it("requires planner sequence cursors to be reset at instrument/session boundaries", () => {
    const scoped = planImmediateBookFills({
      order: order(),
      market: book(),
      state: {
        ...emptyState,
        lastOrderBookSequence: "1",
        cursorScope: {
          instrumentId: "KRX:000660",
          sessionKey: "KRX:2026-07-19:REGULAR",
        },
      },
      policy,
      evaluatedAt: now,
    });
    expect(scoped.rejectionCode).toBe("STATE_SCOPE_MISMATCH");
    expect(scoped.fills).toHaveLength(0);
  });

  it("contains no broker-order endpoint or transaction identifier", () => {
    const source = readFileSync(
      new URL("../src/simulation/orderbook-paper-engine.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/\/trading\/|order-cash|order-rvsecncl/i);
    expect(source).not.toMatch(/\b(?:TTTC|VTTC)\d{4}[A-Z]\b/);
  });

  it("blocks cash and position over-commit before local acceptance", () => {
    const buy = planVerifiedImmediateBookFills({
      order: order(),
      market: book({ asks: [{ price: "100", quantity: "10" }] }),
      state: emptyState,
      policy,
      evaluatedAt: now,
      availability: {
        availableCash: "1000",
        availablePositionQuantity: "0",
        estimatedFeeTaxReserve: "2",
      },
    });
    expect(buy.rejectionCode).toBe("INSUFFICIENT_AVAILABLE_CASH");
    expect(buy.fills).toHaveLength(0);

    const sell = planVerifiedImmediateBookFills({
      order: order({
        side: "SELL",
        orderType: "MARKET",
        limitPrice: null,
        quantity: "11",
      }),
      market: book({ bids: [{ price: "100", quantity: "11" }] }),
      state: emptyState,
      policy,
      evaluatedAt: now,
      availability: {
        availableCash: "0",
        availablePositionQuantity: "10",
        estimatedFeeTaxReserve: "1",
      },
    });
    expect(sell.rejectionCode).toBe("INSUFFICIENT_AVAILABLE_POSITION");
    expect(sell.fills).toHaveLength(0);
  });

  it("rejects overfilled open orders, +0 prices, and inverted policy bounds", () => {
    expect(() =>
      OpenPaperOrderSchema.parse({
        order: order(),
        status: "PARTIALLY_FILLED",
        filledQuantity: "11",
        acceptedAt: occurredAt,
      }),
    ).toThrow(/less than order quantity/);
    expect(() =>
      PaperOrderCommandSchema.parse({
        ...order(),
        limitPrice: "+0",
      }),
    ).toThrow(/positive exact decimal/);
    expect(() =>
      PaperFillPolicySchema.parse({
        ...policy,
        minimumPrice: "100",
        maximumPrice: "99",
      }),
    ).toThrow(/maximumPrice/);
  });

  it("cross-validates fill sums and terminal plan quantities", () => {
    const valid = planImmediateBookFills({
      order: order({ orderType: "MARKET", limitPrice: null, quantity: "2" }),
      market: book({ asks: [{ price: "100", quantity: "1" }] }),
      state: emptyState,
      policy,
      evaluatedAt: now,
    });
    expect(() =>
      PaperExecutionPlanSchema.parse({
        ...valid,
        newlyFilledQuantity: "2",
      }),
    ).toThrow(/newlyFilledQuantity/);
    expect(() =>
      PaperExecutionPlanSchema.parse({
        ...valid,
        remainingQuantity: "1",
      }),
    ).toThrow(/account for orderQuantity|terminal plans/);
  });

  it("resolves injected venue/versioned price-band ticks at boundaries", () => {
    const bandedPolicy = {
      ...policy,
      tickRule: {
        kind: "BANDED" as const,
        venue: "KRX",
        version: "KRX_INJECTED_TEST_V1",
        effectiveFrom: "2026-01-01T00:00:00.000Z",
        effectiveTo: null,
        bands: [
          {
            minimumInclusive: "0",
            maximumExclusive: "100",
            tickSize: "1",
          },
          {
            minimumInclusive: "100",
            maximumExclusive: "500",
            tickSize: "5",
          },
          {
            minimumInclusive: "500",
            maximumExclusive: null,
            tickSize: "10",
          },
        ],
      },
    };
    const parsed = PaperFillPolicySchema.parse(bandedPolicy);
    expect(resolvePolicyTickSize(parsed, "99", "KRX", now)).toBe("1");
    expect(resolvePolicyTickSize(parsed, "100", "KRX", now)).toBe("5");
    expect(resolvePolicyTickSize(parsed, "500", "KRX", now)).toBe("10");
    expect(resolvePolicyTickSize(parsed, "100", "NASDAQ", now)).toBeNull();

    const invalidTick = planImmediateBookFills({
      order: order({ limitPrice: "101" }),
      market: book({
        bids: [{ price: "100", quantity: "10" }],
        asks: [{ price: "105", quantity: "10" }],
      }),
      state: emptyState,
      policy: parsed,
      evaluatedAt: now,
    });
    expect(invalidTick.rejectionCode).toBe("INVALID_TICK");

    expect(() =>
      PaperFillPolicySchema.parse({
        ...bandedPolicy,
        tickRule: {
          ...bandedPolicy.tickRule,
          bands: [
            {
              minimumInclusive: "0",
              maximumExclusive: "100",
              tickSize: "1",
            },
            {
              minimumInclusive: "101",
              maximumExclusive: null,
              tickSize: "5",
            },
          ],
        },
      }),
    ).toThrow(/ordered and contiguous/);
  });

  it("cross-validates rejection and planned fill identities", () => {
    const valid = planImmediateBookFills({
      order: order({ orderType: "MARKET", limitPrice: null, quantity: "1" }),
      market: book({ asks: [{ price: "100", quantity: "1" }] }),
      state: emptyState,
      policy,
      evaluatedAt: now,
    });
    expect(() =>
      PaperExecutionPlanSchema.parse({
        ...valid,
        rejectionCode: "STALE_MARKET_DATA",
      }),
    ).toThrow(/only REJECTED/);

    const wrongTransactionEvents = valid.plannedEvents.map((event) =>
      event.type === "FILL_AND_LEDGER_COMMIT_REQUESTED"
        ? { ...event, transactionGroupId: "wrong-identity" }
        : event,
    );
    expect(() =>
      PaperExecutionPlanSchema.parse({
        ...valid,
        plannedEvents: wrongTransactionEvents,
      }),
    ).toThrow(/transaction identity/);

    const firstFill = valid.fills[0];
    if (firstFill === undefined) throw new Error("expected fill fixture");
    expect(() =>
      PaperExecutionPlanSchema.parse({
        ...valid,
        fills: [{ ...firstFill, clientOrderId: "another-order" }],
      }),
    ).toThrow(/clientOrderId must match/);
  });

  it("requires cursor scope and sequence cursors to exist together", () => {
    expect(() =>
      PaperPlannerStateSchema.parse({
        ...emptyState,
        lastTradeSequence: "1",
      }),
    ).toThrow(/exactly when a sequence cursor/);
    expect(() =>
      PaperPlannerStateSchema.parse({
        ...emptyState,
        cursorScope: {
          instrumentId: "KRX:005930",
          sessionKey: "KRX:2026-07-20:REGULAR",
        },
      }),
    ).toThrow(/exactly when a sequence cursor/);
  });
});
