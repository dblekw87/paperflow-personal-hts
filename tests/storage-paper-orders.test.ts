import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type {
  PaperExecutionPlan,
  PaperFill,
  PaperOrderCommand,
} from "../src/contracts/paper-order.js";
import { openPaperTradingDatabase } from "../src/storage/database.js";
import { MIGRATIONS } from "../src/storage/migrations.js";
import {
  LocalPaperTradingRepository,
  PaperPersistenceError,
} from "../src/storage/paper-repository.js";
import { LocalSimulationRepository } from "../src/storage/repository.js";

const NOW = "2026-07-20T01:00:00.000Z";
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function order(
  clientOrderId: string,
  side: "BUY" | "SELL",
  quantity = "5",
): PaperOrderCommand {
  return {
    clientOrderId,
    accountId: "paper-account",
    instrumentId: "KRX:005930",
    venue: "KRX",
    currency: "KRW",
    side,
    orderType: "LIMIT",
    quantity,
    limitPrice: "10000",
    timeInForce: "DAY",
    session: "REGULAR",
    submittedAt: NOW,
    submissionMode: "CONFIRM_TICKET",
    simulationOnly: true,
  };
}

function fill(
  clientOrderId: string,
  suffix: string,
  quantity = "5",
): PaperFill {
  return {
    fillId: `${clientOrderId}:fill:${suffix}`,
    clientOrderId,
    marketEventId: `market:${suffix}`,
    price: "10000",
    quantity,
    grossNotional: (BigInt(quantity) * 10_000n).toString(),
    liquidity: "BOOK_TAKING",
    fillModelVersion: "BOOK_DEPTH_V1",
  };
}

function execution(input: {
  clientOrderId: string;
  orderQuantity?: string;
  status: PaperExecutionPlan["status"];
  filled: string;
  newlyFilled: string;
  remaining: string;
  cancelled?: string;
  fills?: PaperFill[];
}): PaperExecutionPlan {
  const fills = input.fills ?? [];
  return {
    clientOrderId: input.clientOrderId,
    status: input.status,
    rejectionCode:
      input.status === "REJECTED" ? "INSUFFICIENT_AVAILABLE_CASH" : null,
    fills,
    orderQuantity: input.orderQuantity ?? "5",
    newlyFilledQuantity: input.newlyFilled,
    filledQuantity: input.filled,
    remainingQuantity: input.remaining,
    cancelledQuantity: input.cancelled ?? "0",
    grossNotional: fills
      .reduce((total, item) => total + BigInt(item.grossNotional), 0n)
      .toString(),
    vwap: fills[0]?.price ?? null,
    plannedEvents: fills.map((item) => ({
      type: "FILL_AND_LEDGER_COMMIT_REQUESTED" as const,
      transactionGroupId: `${input.clientOrderId}:${item.marketEventId}`,
      fill: item,
      feeTaxPolicyResolution: "DB_TRANSACTION_OWNER" as const,
      feeLedgerEvent: "PLAN_SEPARATELY" as const,
      taxLedgerEvent: "PLAN_SEPARATELY" as const,
    })),
    nextState: {
      seenClientOrderIds: [input.clientOrderId],
      lastOrderBookSequence: null,
      lastTradeSequence: null,
      cursorScope: null,
    },
    commitOwner: "DB_TRANSACTION_OWNER",
  };
}

function openRepository(filename = ":memory:") {
  const opened = openPaperTradingDatabase({
    filename,
    now: () => NOW,
  });
  const accounts = new LocalSimulationRepository(opened.database, () => NOW);
  const papers = new LocalPaperTradingRepository(opened.database, () => NOW);
  return { ...opened, accounts, papers };
}

function seedAccount(
  accounts: LocalSimulationRepository,
  cash = "1000000",
): void {
  accounts.createAccount({
    id: "paper-account",
    displayName: "로컬 모의계좌",
    baseCurrency: "KRW",
    initialCashMinor: cash,
    initialLedgerEntryId: "initial-ledger",
    idempotencyKey: "initial-funding",
    occurredAt: NOW,
  });
}

function buyCommit(clientOrderId = "buy-1") {
  const paperOrder = order(clientOrderId, "BUY");
  const paperFill = fill(clientOrderId, "1");
  return {
    commitId: `${clientOrderId}:commit:1`,
    order: paperOrder,
    execution: execution({
      clientOrderId,
      status: "FILLED",
      filled: "5",
      newlyFilled: "5",
      remaining: "0",
      fills: [paperFill],
    }),
    reservedCashMinor: "0",
    cashLedgerEntries: [
      {
        id: `${clientOrderId}:principal`,
        accountId: "paper-account",
        currency: "KRW",
        amountMinor: "-50000",
        entryType: "TRADE_PRINCIPAL" as const,
        idempotencyKey: `${clientOrderId}:principal`,
        referenceId: paperFill.fillId,
        occurredAt: NOW,
      },
      {
        id: `${clientOrderId}:fee`,
        accountId: "paper-account",
        currency: "KRW",
        amountMinor: "-10",
        entryType: "FEE" as const,
        idempotencyKey: `${clientOrderId}:fee`,
        referenceId: paperFill.fillId,
        occurredAt: NOW,
      },
    ],
    occurredAt: NOW,
  };
}

describe("local paper order SQLite persistence", () => {
  it("keeps prior migrations unchanged and advances storage through v6", () => {
    expect(MIGRATIONS.map(({ version, name }) => ({ version, name }))).toEqual([
      { version: 1, name: "initial_local_simulation_storage" },
      { version: 2, name: "local_paper_orders_and_fills" },
      { version: 3, name: "paper_market_event_high_watermarks" },
      { version: 4, name: "advanced_queue_state_projection" },
      { version: 5, name: "local_news_and_disclosure_feed" },
      { version: 6, name: "last_real_domestic_orderbook_snapshots" },
    ]);
    expect(MIGRATIONS[0]?.checksum).toBe(
      "1041d43b5988a0de504a65cdd79902f9607cc73dca102d81faac393fce07917d",
    );
  });

  it("atomically commits fills, exact cash entries and a rebuildable position", () => {
    const { database, accounts, papers } = openRepository();
    try {
      seedAccount(accounts);
      const result = papers.commitPaperExecution(buyCommit());

      expect(result.idempotent).toBe(false);
      expect(result.order).toMatchObject({
        status: "FILLED",
        filledQuantity: "5",
        simulationOnly: true,
      });
      expect(accounts.getCashBalance("paper-account", "KRW")).toBe("949990");
      expect(papers.listPositions("paper-account")).toEqual([
        expect.objectContaining({
          instrumentId: "KRX:005930",
          quantity: "5",
          reservedSellQuantity: "0",
          availableQuantity: "5",
        }),
      ]);
      expect(
        papers.listPaperFillMarkers("paper-account", "KRX:005930"),
      ).toEqual([
        expect.objectContaining({
          side: "BUY",
          price: "10000",
          quantity: "5",
          simulationOnly: true,
        }),
      ]);

      database
        .prepare(
          `UPDATE paper_positions SET quantity = '999'
            WHERE account_id = 'paper-account'`,
        )
        .run();
      expect(papers.rebuildPositions("paper-account")[0]?.quantity).toBe("5");
    } finally {
      database.close();
    }
  });

  it("restores orders, fills, cash and positions after reopening the file", () => {
    const directory = mkdtempSync(join(tmpdir(), "paper-order-restart-"));
    temporaryDirectories.push(directory);
    const filename = join(directory, "paper.sqlite3");
    const first = openRepository(filename);
    seedAccount(first.accounts);
    first.papers.commitPaperExecution(buyCommit());
    first.database.close();

    const second = openRepository(filename);
    try {
      expect(second.schemaVersion).toBe(6);
      expect(
        second.papers.getPaperOrder("paper-account", "buy-1")?.status,
      ).toBe("FILLED");
      expect(second.accounts.getCashBalance("paper-account", "KRW")).toBe(
        "949990",
      );
      expect(second.papers.listPositions("paper-account")[0]?.quantity).toBe(
        "5",
      );
      expect(second.papers.getAccountSummary("paper-account")).toMatchObject({
        openOrderCount: 0,
        fillCount: 1,
      });
    } finally {
      second.database.close();
    }
  });

  it("makes the exact same commit idempotent and rejects changed reuse", () => {
    const { database, accounts, papers } = openRepository();
    try {
      seedAccount(accounts);
      const input = buyCommit();
      papers.commitPaperExecution(input);
      expect(papers.commitPaperExecution(input).idempotent).toBe(true);
      expect(accounts.listCashLedger("paper-account")).toHaveLength(3);

      expect(() =>
        papers.commitPaperExecution({
          ...input,
          occurredAt: "2026-07-20T01:00:01.000Z",
        }),
      ).toThrowError(
        expect.objectContaining({
          code: "COMMIT_ID_REUSED_WITH_DIFFERENT_INPUT",
        }),
      );
    } finally {
      database.close();
    }
  });

  it("advances one order through resting and partial fills without double counting", () => {
    const { database, accounts, papers } = openRepository();
    try {
      seedAccount(accounts);
      const paperOrder = order("incremental-buy", "BUY");
      papers.commitPaperExecution({
        commitId: "incremental-buy:accept",
        order: paperOrder,
        execution: execution({
          clientOrderId: "incremental-buy",
          status: "RESTING",
          filled: "0",
          newlyFilled: "0",
          remaining: "5",
        }),
        reservedCashMinor: "50000",
        cashLedgerEntries: [],
        occurredAt: NOW,
      });

      const firstFill = fill("incremental-buy", "partial-1", "2");
      papers.commitPaperExecution({
        commitId: "incremental-buy:partial-1",
        order: paperOrder,
        execution: execution({
          clientOrderId: "incremental-buy",
          status: "PARTIALLY_FILLED",
          filled: "2",
          newlyFilled: "2",
          remaining: "3",
          fills: [firstFill],
        }),
        reservedCashMinor: "30000",
        cashLedgerEntries: [
          {
            id: "incremental-buy:principal-1",
            accountId: "paper-account",
            currency: "KRW",
            amountMinor: "-20000",
            entryType: "TRADE_PRINCIPAL",
            idempotencyKey: "incremental-buy:principal-1",
            occurredAt: NOW,
          },
        ],
        occurredAt: NOW,
      });

      const secondFill = fill("incremental-buy", "partial-2", "3");
      papers.commitPaperExecution({
        commitId: "incremental-buy:partial-2",
        order: paperOrder,
        execution: execution({
          clientOrderId: "incremental-buy",
          status: "FILLED",
          filled: "5",
          newlyFilled: "3",
          remaining: "0",
          fills: [secondFill],
        }),
        reservedCashMinor: "0",
        cashLedgerEntries: [
          {
            id: "incremental-buy:principal-2",
            accountId: "paper-account",
            currency: "KRW",
            amountMinor: "-30000",
            entryType: "TRADE_PRINCIPAL",
            idempotencyKey: "incremental-buy:principal-2",
            occurredAt: NOW,
          },
        ],
        occurredAt: NOW,
      });

      expect(
        papers.getPaperOrder("paper-account", "incremental-buy"),
      ).toMatchObject({
        status: "FILLED",
        filledQuantity: "5",
        remainingQuantity: "0",
        reservedCashMinor: "0",
      });
      expect(papers.listPositions("paper-account")[0]?.quantity).toBe("5");
      expect(
        papers.listPaperFillMarkers("paper-account", "KRX:005930"),
      ).toHaveLength(2);
      expect(accounts.getCashBalance("paper-account", "KRW")).toBe("950000");
    } finally {
      database.close();
    }
  });

  it("rolls back order, fill and position if a ledger insert fails", () => {
    const { database, accounts, papers } = openRepository();
    try {
      seedAccount(accounts);
      const input = buyCommit("rollback-buy");
      input.cashLedgerEntries[0] = {
        ...input.cashLedgerEntries[0]!,
        id: "initial-ledger",
      };
      expect(() => papers.commitPaperExecution(input)).toThrow();
      expect(papers.getPaperOrder("paper-account", "rollback-buy")).toBeNull();
      expect(
        papers.listPaperFillMarkers("paper-account", "KRX:005930"),
      ).toHaveLength(0);
      expect(papers.listPositions("paper-account")).toHaveLength(0);
      expect(accounts.getCashBalance("paper-account", "KRW")).toBe("1000000");
    } finally {
      database.close();
    }
  });

  it("revalidates cash and sell availability inside the immediate transaction", () => {
    const { database, accounts, papers } = openRepository();
    try {
      seedAccount(accounts, "50000");
      expect(() =>
        papers.commitPaperExecution(buyCommit("too-expensive")),
      ).toThrowError(
        expect.objectContaining({ code: "INSUFFICIENT_AVAILABLE_CASH" }),
      );
      expect(papers.getPaperOrder("paper-account", "too-expensive")).toBeNull();

      const sellOrder = order("naked-sell", "SELL");
      const sellFill = fill("naked-sell", "1");
      expect(() =>
        papers.commitPaperExecution({
          commitId: "naked-sell:commit:1",
          order: sellOrder,
          execution: execution({
            clientOrderId: "naked-sell",
            status: "FILLED",
            filled: "5",
            newlyFilled: "5",
            remaining: "0",
            fills: [sellFill],
          }),
          reservedCashMinor: "0",
          cashLedgerEntries: [
            {
              id: "naked-sell:principal",
              accountId: "paper-account",
              currency: "KRW",
              amountMinor: "50000",
              entryType: "TRADE_PRINCIPAL",
              idempotencyKey: "naked-sell:principal",
              occurredAt: NOW,
            },
          ],
          occurredAt: NOW,
        }),
      ).toThrowError(
        expect.objectContaining({
          code: "INSUFFICIENT_AVAILABLE_POSITION",
        }),
      );
    } finally {
      database.close();
    }
  });

  it("prevents two open orders from over-reserving cash or holdings", () => {
    const { database, accounts, papers } = openRepository();
    try {
      seedAccount(accounts);
      papers.commitPaperExecution({
        commitId: "cash-reserve-1:commit",
        order: order("cash-reserve-1", "BUY", "90"),
        execution: execution({
          clientOrderId: "cash-reserve-1",
          orderQuantity: "90",
          status: "RESTING",
          filled: "0",
          newlyFilled: "0",
          remaining: "90",
        }),
        reservedCashMinor: "900000",
        cashLedgerEntries: [],
        occurredAt: NOW,
      });
      expect(() =>
        papers.commitPaperExecution({
          commitId: "cash-reserve-2:commit",
          order: order("cash-reserve-2", "BUY", "20"),
          execution: execution({
            clientOrderId: "cash-reserve-2",
            orderQuantity: "20",
            status: "RESTING",
            filled: "0",
            newlyFilled: "0",
            remaining: "20",
          }),
          reservedCashMinor: "200000",
          cashLedgerEntries: [],
          occurredAt: NOW,
        }),
      ).toThrowError(
        expect.objectContaining({ code: "INSUFFICIENT_AVAILABLE_CASH" }),
      );

      papers.commitPaperExecution(buyCommit("inventory"));
      papers.commitPaperExecution({
        commitId: "sell-reserve-1:commit",
        order: order("sell-reserve-1", "SELL", "4"),
        execution: execution({
          clientOrderId: "sell-reserve-1",
          orderQuantity: "4",
          status: "RESTING",
          filled: "0",
          newlyFilled: "0",
          remaining: "4",
        }),
        reservedCashMinor: "0",
        cashLedgerEntries: [],
        occurredAt: NOW,
      });
      expect(() =>
        papers.commitPaperExecution({
          commitId: "sell-reserve-2:commit",
          order: order("sell-reserve-2", "SELL", "2"),
          execution: execution({
            clientOrderId: "sell-reserve-2",
            orderQuantity: "2",
            status: "RESTING",
            filled: "0",
            newlyFilled: "0",
            remaining: "2",
          }),
          reservedCashMinor: "0",
          cashLedgerEntries: [],
          occurredAt: NOW,
        }),
      ).toThrowError(
        expect.objectContaining({
          code: "INSUFFICIENT_AVAILABLE_POSITION",
        }),
      );
    } finally {
      database.close();
    }
  });

  it("keeps fills and execution commit records immutable", () => {
    const { database, accounts, papers } = openRepository();
    try {
      seedAccount(accounts);
      papers.commitPaperExecution(buyCommit());
      expect(() =>
        database.prepare("UPDATE paper_fills SET quantity = '1'").run(),
      ).toThrow(/immutable/);
      expect(() =>
        database.prepare("DELETE FROM paper_execution_commits").run(),
      ).toThrow(/immutable/);
    } finally {
      database.close();
    }
  });

  it("persists monotonic paper-market event high-watermarks", () => {
    const { database, accounts, papers } = openRepository();
    try {
      seedAccount(accounts);
      const base = {
        accountId: "paper-account",
        instrumentId: "KRX:005930",
        sessionKey: "KRX:2026-07-20:REGULAR",
        observedAt: "2026-07-20T01:15:30.000Z",
      };
      expect(
        papers.claimPaperMarketEvent({
          ...base,
          sequence: "100",
          marketEventId: "trade-event-100",
        }),
      ).toBe("ACCEPTED");
      expect(
        papers.claimPaperMarketEvent({
          ...base,
          sequence: "100",
          marketEventId: "trade-event-100",
        }),
      ).toBe("DUPLICATE");
      expect(
        papers.claimPaperMarketEvent({
          ...base,
          sequence: "99",
          marketEventId: "trade-event-099",
        }),
      ).toBe("OUT_OF_ORDER");
      expect(
        papers.claimPaperMarketEvent({
          ...base,
          sequence: "101",
          marketEventId: "trade-event-101",
        }),
      ).toBe("ACCEPTED");
      expect(
        database
          .prepare(
            `SELECT last_sequence
               FROM paper_market_cursors
              WHERE account_id = ? AND instrument_id = ? AND session_key = ?`,
          )
          .get(
            base.accountId,
            base.instrumentId,
            base.sessionKey,
          ),
      ).toEqual({ last_sequence: "101" });
      expect(() =>
        database
          .prepare(
            "UPDATE paper_market_event_receipts SET sequence = '102'",
          )
          .run(),
      ).toThrow(/immutable/);
    } finally {
      database.close();
    }
  });

  it("persists and restores an estimated advanced queue across restart", () => {
    const directory = mkdtempSync(join(tmpdir(), "advanced-queue-restart-"));
    temporaryDirectories.push(directory);
    const filename = join(directory, "paper.sqlite3");
    const first = openRepository(filename);
    seedAccount(first.accounts);
    const paperOrder = order("queue-buy", "BUY");
    first.papers.commitPaperExecution({
      commitId: "queue-buy:resting",
      order: paperOrder,
      execution: execution({
        clientOrderId: paperOrder.clientOrderId,
        status: "RESTING",
        filled: "0",
        newlyFilled: "0",
        remaining: "5",
      }),
      reservedCashMinor: "50010",
      cashLedgerEntries: [],
      occurredAt: NOW,
    });
    first.papers.saveAdvancedQueueState("paper-account", {
      clientOrderId: paperOrder.clientOrderId,
      instrumentId: paperOrder.instrumentId,
      venue: paperOrder.venue,
      currency: paperOrder.currency,
      side: paperOrder.side,
      limitPrice: paperOrder.limitPrice!,
      remainingQuantity: "5",
      aheadQuantityEstimate: "125",
      lastDisplayedQuantityAtPrice: "100",
      safetyFactor: "1.25",
      queuePositionQuality: "QUEUE_ESTIMATED",
      sessionKey: "KRX:20260720:REGULAR",
      lastOrderBookSequence: "10",
      lastTradeSequence: null,
      seenMarketEventIds: ["book:10"],
      viPaused: false,
    });
    first.database.close();

    const second = openRepository(filename);
    try {
      expect(
        second.papers.getAdvancedQueueState(
          "paper-account",
          paperOrder.clientOrderId,
        ),
      ).toMatchObject({
        aheadQuantityEstimate: "125",
        safetyFactor: "1.25",
        queuePositionQuality: "QUEUE_ESTIMATED",
        seenMarketEventIds: ["book:10"],
      });
      expect(
        second.papers.deleteAdvancedQueueState(
          "paper-account",
          paperOrder.clientOrderId,
        ),
      ).toBe(true);
      expect(
        second.papers.getAdvancedQueueState(
          "paper-account",
          paperOrder.clientOrderId,
        ),
      ).toBeNull();
    } finally {
      second.database.close();
    }
  });

  it("exposes typed non-retryable persistence errors", () => {
    const error = new PaperPersistenceError(
      "INSUFFICIENT_AVAILABLE_CASH",
      "cash",
    );
    expect(error.retryable).toBe(false);
  });
});
