import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  ADVANCED_QUEUE_RECENT_EVENT_LIMIT,
  acceptAdvancedQueueEstimate,
  planAdvancedQueueProgress,
  resnapshotAdvancedQueueEstimate,
} from "../src/simulation/advanced-queue-engine.js";
import type {
  CanonicalOrderBookEvent,
  CanonicalTradeEvent,
  PaperFillPolicy,
  PaperOrderCommand,
} from "../src/contracts/paper-order.js";

const evaluatedAt = "2026-07-20T01:00:10.000Z";
const occurredAt = "2026-07-20T01:00:09.000Z";

const policy: PaperFillPolicy = {
  maxMarketDataAgeMs: 2_000,
  passiveFillModel: "AT_OR_THROUGH",
  marketRemainder: "CANCEL",
  marketableLimitRemainder: "REST",
  vwapScale: 8,
  version: "QUEUE_GOLDEN_POLICY_V1",
  tickRule: {
    kind: "FIXED",
    venue: "KRX",
    version: "KRX_TEST_V1",
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    effectiveTo: null,
    tickSize: "1",
  },
  minimumPrice: "1",
  maximumPrice: "1000000",
};

function order(quantity = "30"): PaperOrderCommand {
  return {
    clientOrderId: "queue-order-1",
    accountId: "paper-account",
    instrumentId: "KRX:005930",
    venue: "KRX",
    currency: "KRW",
    side: "BUY",
    orderType: "LIMIT",
    quantity,
    limitPrice: "100",
    timeInForce: "DAY",
    session: "REGULAR",
    submittedAt: "2026-07-20T01:00:00.000Z",
    submissionMode: "CONFIRM_TICKET",
    simulationOnly: true,
  };
}

function book(input: {
  id: string;
  sequence: string;
  displayed: string;
  sessionKey?: string;
}): CanonicalOrderBookEvent {
  return {
    kind: "ORDER_BOOK",
    marketEventId: input.id,
    sequence: input.sequence,
    currency: "KRW",
    freshness: "LIVE",
    receivedAt: occurredAt,
    tradingPhase: "REGULAR_CONTINUOUS",
    sessionKey: input.sessionKey ?? "KRX:2026-07-20:REGULAR",
    snapshot: {
      instrumentId: "KRX:005930",
      venue: "KRX",
      bids: [{ price: "100", quantity: input.displayed }],
      asks: [{ price: "101", quantity: "100" }],
      totalBidQuantity: input.displayed,
      totalAskQuantity: "100",
      occurredAt,
      providerDate: "20260720",
      providerTime: "100009",
      source: "KIS_WS",
    },
  };
}

function trade(input: {
  id: string;
  sequence: string;
  price?: string;
  quantity: string;
  sessionKey?: string;
}): CanonicalTradeEvent {
  return {
    kind: "TRADE_TICK",
    marketEventId: input.id,
    sequence: input.sequence,
    currency: "KRW",
    freshness: "LIVE",
    receivedAt: occurredAt,
    tradingPhase: "REGULAR_CONTINUOUS",
    sessionKey: input.sessionKey ?? "KRX:2026-07-20:REGULAR",
    auction: null,
    tick: {
      instrumentId: "KRX:005930",
      venue: "KRX",
      session: "REGULAR",
      price: input.price ?? "100",
      quantity: input.quantity,
      change: null,
      changeRate: null,
      cumulativeVolume: null,
      cumulativeTurnover: null,
      occurredAt,
      providerDate: "20260720",
      providerTime: "100009",
      source: "KIS_WS",
    },
  };
}

describe("ADVANCED_QUEUE_V1 golden replay", () => {
  it("uses exact-decimal ceiling for the displayed queue safety factor", () => {
    const state = acceptAdvancedQueueEstimate({
      order: order(),
      market: book({ id: "book-0", sequence: "10", displayed: "3" }),
      policy,
      safetyFactor: "1.000000000000000001",
      evaluatedAt,
    });

    expect(state).toMatchObject({
      remainingQuantity: "30",
      aheadQuantityEstimate: "4",
      lastDisplayedQuantityAtPrice: "3",
      safetyFactor: "1.000000000000000001",
      queuePositionQuality: "QUEUE_ESTIMATED",
      lastOrderBookSequence: "10",
      lastTradeSequence: null,
      seenMarketEventIds: ["book-0"],
    });
  });

  it("bounds persisted event identities while sequence high-watermarks advance", () => {
    let state = acceptAdvancedQueueEstimate({
      order: order(),
      market: book({ id: "book-0", sequence: "10", displayed: "100" }),
      policy,
      safetyFactor: "1.25",
      evaluatedAt,
    });

    for (let index = 0; index < 140; index += 1) {
      state = planAdvancedQueueProgress({
        queue: state,
        trade: trade({
          id: `trade-${index}`,
          sequence: String(11 + index),
          price: "101",
          quantity: "1",
        }),
        book: null,
        policy,
        evaluatedAt,
      }).state;
    }

    expect(state.seenMarketEventIds).toHaveLength(
      ADVANCED_QUEUE_RECENT_EVENT_LIMIT,
    );
    expect(state.seenMarketEventIds[0]).toBe("trade-12");
    expect(state.seenMarketEventIds.at(-1)).toBe("trade-139");
    expect(state.lastTradeSequence).toBe("150");
  });

  it("replays queue decrement, repeated-book dedupe, and partial fill deterministically", () => {
    const initial = acceptAdvancedQueueEstimate({
      order: order(),
      market: book({ id: "book-0", sequence: "10", displayed: "100" }),
      policy,
      safetyFactor: "1.25",
      evaluatedAt,
    });
    const book1 = book({ id: "book-1", sequence: "11", displayed: "40" });
    const first = planAdvancedQueueProgress({
      queue: initial,
      trade: trade({ id: "trade-1", sequence: "11", quantity: "60" }),
      book: book1,
      policy,
      evaluatedAt,
    });
    const second = planAdvancedQueueProgress({
      queue: first.state,
      trade: trade({ id: "trade-2", sequence: "12", quantity: "40" }),
      book: book1,
      policy,
      evaluatedAt,
    });
    const third = planAdvancedQueueProgress({
      queue: second.state,
      trade: trade({ id: "trade-3", sequence: "13", quantity: "30" }),
      book: book({ id: "book-3", sequence: "13", displayed: "10" }),
      policy,
      evaluatedAt,
    });

    expect(first.queueProgressQuantity).toBe("60");
    expect(first.state.aheadQuantityEstimate).toBe("65");
    expect(first.fill).toBeNull();
    expect(second.queueProgressQuantity).toBe("40");
    expect(second.state.aheadQuantityEstimate).toBe("25");
    expect(second.state.lastOrderBookSequence).toBe("11");
    expect(second.state.seenMarketEventIds).toEqual([
      "book-0",
      "trade-1",
      "book-1",
      "trade-2",
    ]);
    expect(third).toEqual({
      state: {
        clientOrderId: "queue-order-1",
        instrumentId: "KRX:005930",
        venue: "KRX",
        currency: "KRW",
        side: "BUY",
        limitPrice: "100",
        remainingQuantity: "25",
        aheadQuantityEstimate: "0",
        lastDisplayedQuantityAtPrice: "10",
        safetyFactor: "1.25",
        queuePositionQuality: "QUEUE_ESTIMATED",
        sessionKey: "KRX:2026-07-20:REGULAR",
        lastOrderBookSequence: "13",
        lastTradeSequence: "13",
        seenMarketEventIds: [
          "book-0",
          "trade-1",
          "book-1",
          "trade-2",
          "trade-3",
          "book-3",
        ],
        viPaused: false,
      },
      fill: {
        fillId: "queue-order-1:trade-3:queue",
        clientOrderId: "queue-order-1",
        marketEventId: "trade-3",
        price: "100",
        quantity: "5",
        grossNotional: "500",
        liquidity: "PASSIVE_AT_OR_THROUGH",
        fillModelVersion:
          "ADVANCED_QUEUE_V1:QUEUE_GOLDEN_POLICY_V1",
      },
      rejectionCode: null,
      queueProgressQuantity: "30",
      resetRequired: false,
      plannedEvents: [
        {
          type: "FILL_AND_LEDGER_COMMIT_REQUESTED",
          transactionGroupId: "queue-order-1:trade-3",
          fill: {
            fillId: "queue-order-1:trade-3:queue",
            clientOrderId: "queue-order-1",
            marketEventId: "trade-3",
            price: "100",
            quantity: "5",
            grossNotional: "500",
            liquidity: "PASSIVE_AT_OR_THROUGH",
            fillModelVersion:
              "ADVANCED_QUEUE_V1:QUEUE_GOLDEN_POLICY_V1",
          },
          feeTaxPolicyResolution: "DB_TRANSACTION_OWNER",
          feeLedgerEvent: "PLAN_SEPARATELY",
          taxLedgerEvent: "PLAN_SEPARATELY",
        },
      ],
    });
  });

  it("gives strict trade-through only the observed tick quantity", () => {
    const initial = acceptAdvancedQueueEstimate({
      order: order(),
      market: book({ id: "book-0", sequence: "10", displayed: "100" }),
      policy,
      safetyFactor: "2",
      evaluatedAt,
    });
    const result = planAdvancedQueueProgress({
      queue: initial,
      trade: trade({
        id: "trade-through",
        sequence: "11",
        price: "99",
        quantity: "7",
      }),
      book: null,
      policy,
      evaluatedAt,
    });

    expect(result.state.aheadQuantityEstimate).toBe("0");
    expect(result.fill?.quantity).toBe("7");
    expect(result.fill?.liquidity).toBe("PASSIVE_TRADE_THROUGH");
    expect(result.state.remainingQuantity).toBe("23");
  });

  it("does not turn a book-only decrease into a fill", () => {
    const initial = acceptAdvancedQueueEstimate({
      order: order(),
      market: book({ id: "book-0", sequence: "10", displayed: "100" }),
      policy,
      safetyFactor: "1",
      evaluatedAt,
    });
    const result = planAdvancedQueueProgress({
      queue: initial,
      trade: trade({
        id: "ineligible-trade",
        sequence: "11",
        price: "101",
        quantity: "1",
      }),
      book: book({ id: "book-1", sequence: "11", displayed: "0" }),
      policy,
      evaluatedAt,
    });

    expect(result.queueProgressQuantity).toBe("100");
    expect(result.state.aheadQuantityEstimate).toBe("0");
    expect(result.fill).toBeNull();
    expect(result.state.remainingQuantity).toBe("30");
  });

  it("rejects duplicate and out-of-order trade events with zero state change", () => {
    const initial = acceptAdvancedQueueEstimate({
      order: order(),
      market: book({ id: "book-0", sequence: "10", displayed: "0" }),
      policy,
      safetyFactor: "1",
      evaluatedAt,
    });
    const first = planAdvancedQueueProgress({
      queue: initial,
      trade: trade({ id: "trade-1", sequence: "11", quantity: "1" }),
      book: null,
      policy,
      evaluatedAt,
    });
    const duplicate = planAdvancedQueueProgress({
      queue: first.state,
      trade: trade({ id: "trade-1", sequence: "11", quantity: "1" }),
      book: null,
      policy,
      evaluatedAt,
    });
    const rewind = planAdvancedQueueProgress({
      queue: first.state,
      trade: trade({ id: "trade-rewind", sequence: "10", quantity: "1" }),
      book: null,
      policy,
      evaluatedAt,
    });

    expect(duplicate.rejectionCode).toBe("OUT_OF_ORDER_EVENT");
    expect(duplicate.state).toEqual(first.state);
    expect(rewind.rejectionCode).toBe("OUT_OF_ORDER_EVENT");
    expect(rewind.state).toEqual(first.state);
  });

  it("requires reset on a new scope and resnapshots without restoring fills", () => {
    const initial = acceptAdvancedQueueEstimate({
      order: order(),
      market: book({ id: "book-0", sequence: "10", displayed: "0" }),
      policy,
      safetyFactor: "1",
      evaluatedAt,
    });
    const partial = planAdvancedQueueProgress({
      queue: initial,
      trade: trade({ id: "trade-1", sequence: "11", quantity: "5" }),
      book: null,
      policy,
      evaluatedAt,
    });
    const nextSessionKey = "KRX:2026-07-21:REGULAR";
    const mismatch = planAdvancedQueueProgress({
      queue: partial.state,
      trade: trade({
        id: "trade-next-session",
        sequence: "1",
        quantity: "1",
        sessionKey: nextSessionKey,
      }),
      book: null,
      policy,
      evaluatedAt,
    });
    const reset = resnapshotAdvancedQueueEstimate({
      queue: partial.state,
      market: book({
        id: "book-next-session",
        sequence: "1",
        displayed: "8",
        sessionKey: nextSessionKey,
      }),
      policy,
      safetyFactor: "1.5",
      evaluatedAt,
      reason: "SESSION_SCOPE_CHANGE",
    });

    expect(partial.state.remainingQuantity).toBe("25");
    expect(mismatch.rejectionCode).toBe("SESSION_NOT_FILLABLE");
    expect(mismatch.resetRequired).toBe(true);
    expect(mismatch.state).toEqual(partial.state);
    expect(reset).toMatchObject({
      remainingQuantity: "25",
      aheadQuantityEstimate: "12",
      lastDisplayedQuantityAtPrice: "8",
      sessionKey: nextSessionKey,
      lastOrderBookSequence: "1",
      lastTradeSequence: null,
      seenMarketEventIds: ["book-next-session"],
      viPaused: false,
    });
  });

  it("contains no broker order route or transaction code", () => {
    const source = readFileSync(
      new URL("../src/simulation/advanced-queue-engine.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toMatch(/\/trading\/|order-cash|order-rvsecncl/i);
    expect(source).not.toMatch(/\b(?:TTTC|VTTC)\d{4}[A-Z]\b/);
  });
});
