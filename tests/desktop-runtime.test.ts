import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  DesktopRuntime,
  isDesktopPaperMarketExecutable,
  resolveDesktopMarketSession,
} from "../apps/desktop/src/main/desktop-runtime.js";
import type { MarketLiveProjection } from "../src/contracts/market-live-projection.js";
import type {
  PaperExecutionPlan,
  PaperOrderCommand,
} from "../src/contracts/paper-order.js";
import { openUserDataDatabase } from "../src/storage/database.js";
import { LocalPaperTradingRepository } from "../src/storage/paper-repository.js";

const temporaryDirectories: string[] = [];

function providerDateFor(instant: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(new Date(instant))
    .replaceAll("-", "");
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createRuntime(userDataPath: string) {
  return new DesktopRuntime({
    userDataPath,
    emitMarket: () => undefined,
  });
}

function restingBuy(
  submittedAt: string,
): { order: PaperOrderCommand; execution: PaperExecutionPlan } {
  const order: PaperOrderCommand = {
    clientOrderId: "resting-restart-buy",
    accountId: "personal-paper-account",
    instrumentId: "KRX:005930",
    venue: "KRX",
    currency: "KRW",
    side: "BUY",
    orderType: "LIMIT",
    quantity: "5",
    limitPrice: "70000",
    timeInForce: "DAY",
    session: "REGULAR",
    submittedAt,
    submissionMode: "CONFIRM_TICKET",
    simulationOnly: true,
  };
  return {
    order,
    execution: {
      clientOrderId: order.clientOrderId,
      status: "RESTING",
      rejectionCode: null,
      fills: [],
      orderQuantity: "5",
      newlyFilledQuantity: "0",
      filledQuantity: "0",
      remainingQuantity: "5",
      cancelledQuantity: "0",
      grossNotional: "0",
      vwap: null,
      plannedEvents: [],
      nextState: {
        seenClientOrderIds: [order.clientOrderId],
        lastOrderBookSequence: "1",
        lastTradeSequence: null,
        cursorScope: {
          instrumentId: order.instrumentId,
          sessionKey: `KRX:${providerDateFor(submittedAt)}:REGULAR`,
        },
      },
      commitOwner: "DB_TRANSACTION_OWNER",
    },
  };
}

function liveProjection(
  receivedAt: string,
  cumulativeVolume: string,
  quantity: string,
): MarketLiveProjection {
  return {
    instrumentId: "KRX:005930",
    environment: "paper",
    source: "KIS_WS",
    connectionStatus: "live",
    freshness: "live",
    coverage: "complete",
    generation: 1,
    reconnectCount: 0,
    acknowledged: { orderBook: true, trade: true },
    orderBook: {
      instrumentId: "KRX:005930",
      venue: "KRX",
      bids: [{ price: "69900", quantity: "100" }],
      asks: [{ price: "70100", quantity: "100" }],
      totalBidQuantity: "100",
      totalAskQuantity: "100",
      occurredAt: receivedAt,
      providerDate: providerDateFor(receivedAt),
      providerTime: "101500",
      source: "KIS_WS",
    },
    trade: {
      instrumentId: "KRX:005930",
      venue: "KRX",
      session: "REGULAR",
      price: "69000",
      quantity,
      change: null,
      changeRate: null,
      cumulativeVolume,
      cumulativeTurnover: null,
      occurredAt: receivedAt,
      providerDate: providerDateFor(receivedAt),
      providerTime: "101500",
      source: "KIS_WS",
    },
    asOf: receivedAt,
    lastReceivedAt: receivedAt,
    lastOrderBookReceivedAt: receivedAt,
    lastTradeReceivedAt: receivedAt,
    lastError: null,
  };
}

function advancedQueueProjection(
  cumulativeVolume: string,
  quantity: string,
  displayedBidQuantity: string,
): MarketLiveProjection {
  const projection = liveProjection(
    new Date().toISOString(),
    cumulativeVolume,
    quantity,
  );
  return {
    ...projection,
    orderBook: {
      ...projection.orderBook!,
      bids: [{ price: "70000", quantity: displayedBidQuantity }],
    },
    trade: {
      ...projection.trade!,
      price: "70000",
    },
  };
}

describe("Electron desktop runtime boundary", () => {
  it("creates and restores one local account without contacting KIS", async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), "desktop-runtime-"));
    temporaryDirectories.push(userDataPath);

    const first = createRuntime(userDataPath);
    const bootstrap = first.getBootstrap();
    expect(bootstrap.actualOrderCapability).toBe("FORBIDDEN");
    expect(bootstrap.market).toMatchObject({
      mode: "FIXTURE",
      connectionState: "DISABLED",
    });
    expect(bootstrap.account).toMatchObject({
      storageState: "READY",
      cashMinor: "100000000",
    });
    expect(bootstrap.chart).toMatchObject({
      interval: "1m",
      state: "DISABLED",
      source: "FIXTURE",
      candles: [],
    });
    await first.close();

    const reopened = createRuntime(userDataPath);
    expect(reopened.getBootstrap().account.cashMinor).toBe("100000000");
    await reopened.close();
  });

  it("rejects paper orders unless canonical KIS market data is live", async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), "desktop-runtime-"));
    temporaryDirectories.push(userDataPath);
    const runtime = createRuntime(userDataPath);
    try {
      const result = runtime.submitPaperOrder({
        requestId: "offline-order-1",
        instrumentId: "KRX:005930",
        side: "BUY",
        orderType: "LIMIT",
        quantity: "1",
        limitPrice: "70000",
      });
      expect(result).toMatchObject({
        accepted: false,
        status: "REJECTED",
        rejectionCode: "MARKET_DATA_NOT_LIVE",
      });
      expect(runtime.getBootstrap().account.cashMinor).toBe("100000000");
    } finally {
      await runtime.close();
    }
  });

  it("changes only the local account when an immediate paper buy fills", async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), "desktop-local-fill-"));
    temporaryDirectories.push(userDataPath);
    const runtime = createRuntime(userDataPath);
    try {
      const receivedAt = new Date().toISOString();
      runtime.applyReadOnlyMarketProjection(
        liveProjection(receivedAt, "100", "1"),
      );
      const before = runtime.getBootstrap().market;
      const result = runtime.submitPaperOrder({
        requestId: "local-market-buy-1",
        instrumentId: "KRX:005930",
        side: "BUY",
        orderType: "MARKET",
        quantity: "2",
        limitPrice: null,
      });

      expect(result).toMatchObject({
        accepted: true,
        status: "FILLED",
        account: {
          positions: [
            {
              instrumentId: "KRX:005930",
              quantity: "2",
              averagePrice: "70100",
            },
          ],
        },
      });
      expect(result.account.cashMinor).toBe("99859778");
      expect(result.market.bids).toEqual(before.bids);
      expect(result.market.asks).toEqual(before.asks);
      expect(result.market.totalBidQuantity).toBe(before.totalBidQuantity);
      expect(result.market.totalAskQuantity).toBe(before.totalAskQuantity);
    } finally {
      await runtime.close();
    }
  });

  it("keeps the last real order book when a later projection has no book", async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), "desktop-last-book-"));
    temporaryDirectories.push(userDataPath);
    const runtime = createRuntime(userDataPath);
    const receivedAt = new Date().toISOString();
    const live = liveProjection(receivedAt, "100", "1");
    runtime.applyReadOnlyMarketProjection(live);

    runtime.applyReadOnlyMarketProjection({
      ...live,
      connectionStatus: "reconnecting",
      freshness: "stale",
      acknowledged: { orderBook: false, trade: false },
      orderBook: null,
      trade: null,
    });

    expect(runtime.getBootstrap().market).toMatchObject({
      freshness: "stale",
      bids: [{ price: "69900", quantity: "100" }],
      asks: [{ price: "70100", quantity: "100" }],
      price: "69000",
      orderBookReceivedAt: receivedAt,
    });
    await runtime.close();
  });

  it("rejects an invalid instrument selection before any KIS connection", async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), "desktop-runtime-"));
    temporaryDirectories.push(userDataPath);
    const runtime = createRuntime(userDataPath);
    try {
      await expect(runtime.selectInstrument("../005930")).rejects.toThrow(
        "Unsupported domestic instrument symbol",
      );
      expect(runtime.getBootstrap().market.instrumentId).toBe("KRX:005930");
    } finally {
      await runtime.close();
    }
  });

  it("requires a fresh two-sided KIS book during the regular session", () => {
    const now = Date.parse("2026-07-20T06:10:00.000Z");
    const executable = {
      mode: "KIS_READ_ONLY" as const,
      connectionState: "LIVE" as const,
      freshness: "live" as const,
      session: "REGULAR" as const,
      orderBookReceivedAt: "2026-07-20T06:09:59.000Z",
      tradeReceivedAt: "2026-07-20T06:09:59.500Z",
      bids: [{ price: "70000", quantity: "10" }],
      asks: [{ price: "70100", quantity: "10" }],
    };
    expect(isDesktopPaperMarketExecutable(executable, now)).toBe(true);
    expect(
      isDesktopPaperMarketExecutable({ ...executable, session: "PRE" }, now),
    ).toBe(false);
    expect(
      isDesktopPaperMarketExecutable({ ...executable, session: "AFTER" }, now),
    ).toBe(false);
    expect(
      isDesktopPaperMarketExecutable(
        { ...executable, freshness: "stale" },
        now,
      ),
    ).toBe(false);
    expect(
      isDesktopPaperMarketExecutable({ ...executable, asks: [] }, now),
    ).toBe(false);
    expect(
      isDesktopPaperMarketExecutable(
        {
          ...executable,
          orderBookReceivedAt: "2026-07-20T06:09:54.999Z",
        },
        now,
      ),
    ).toBe(false);
    expect(
      isDesktopPaperMarketExecutable(
        {
          ...executable,
          tradeReceivedAt: "2026-07-20T06:09:54.999Z",
        },
        now,
      ),
    ).toBe(false);
  });

  it("lets the current book phase close an older regular trade session", () => {
    expect(resolveDesktopMarketSession("151959", "REGULAR")).toBe("REGULAR");
    expect(resolveDesktopMarketSession("152000", "REGULAR")).toBe("CLOSED");
    expect(resolveDesktopMarketSession("154000", "REGULAR")).toBe("AFTER");
    expect(resolveDesktopMarketSession(null, "REGULAR")).toBe("REGULAR");
  });

  it("fills and restores a resting limit from observed KIS trade quantities", async () => {
    const userDataPath = mkdtempSync(join(tmpdir(), "desktop-runtime-"));
    temporaryDirectories.push(userDataPath);
    const initial = createRuntime(userDataPath);
    await initial.close();

    const submittedAt = new Date(Date.now() - 10_000).toISOString();
    const stored = openUserDataDatabase(userDataPath);
    const papers = new LocalPaperTradingRepository(stored.database);
    const { order, execution } = restingBuy(submittedAt);
    papers.commitPaperExecution({
      commitId: "seed-resting-buy",
      order,
      execution,
      reservedCashMinor: "350053",
      cashLedgerEntries: [],
      occurredAt: submittedAt,
    });
    stored.database.close();

    const accountEvents: unknown[] = [];
    const runtime = new DesktopRuntime({
      userDataPath,
      emitMarket: () => undefined,
      emitAccount: (projection) => accountEvents.push(projection),
    });
    const firstReceivedAt = new Date().toISOString();
    const firstTrade = liveProjection(firstReceivedAt, "1002", "2");
    runtime.applyReadOnlyMarketProjection(firstTrade);
    runtime.applyReadOnlyMarketProjection(firstTrade);
    expect(runtime.getBootstrap().account).toMatchObject({
      cashMinor: "99649947",
      positions: [{ instrumentId: "KRX:005930", quantity: "2" }],
      fills: [{ quantity: "2", price: "70000", completion: "PARTIAL" }],
    });
    expect(accountEvents).toHaveLength(1);
    await runtime.close();

    const reopenedEvents: unknown[] = [];
    const reopened = new DesktopRuntime({
      userDataPath,
      emitMarket: () => undefined,
      emitAccount: (projection) => reopenedEvents.push(projection),
    });
    reopened.applyReadOnlyMarketProjection(firstTrade);
    expect(reopened.getBootstrap().account.fills).toHaveLength(1);
    expect(reopenedEvents).toHaveLength(0);

    const secondTrade = liveProjection(
      new Date().toISOString(),
      "1005",
      "3",
    );
    reopened.applyReadOnlyMarketProjection(secondTrade);
    expect(reopened.getBootstrap().account).toMatchObject({
      cashMinor: "99649947",
      positions: [{ instrumentId: "KRX:005930", quantity: "5" }],
    });
    expect(reopened.getBootstrap().account.fills).toHaveLength(2);
    expect(reopened.getBootstrap().account.fills.at(-1)?.completion).toBe(
      "FULL",
    );
    expect(reopenedEvents).toHaveLength(1);
    await reopened.close();
  });

  it("persists and applies the opt-in estimated advanced queue profile", async () => {
    const previousProfile = process.env["PAPER_FILL_PROFILE"];
    const previousFactor = process.env["PAPER_QUEUE_SAFETY_FACTOR"];
    process.env["PAPER_FILL_PROFILE"] = "ADVANCED_QUEUE_V1";
    process.env["PAPER_QUEUE_SAFETY_FACTOR"] = "1";
    const userDataPath = mkdtempSync(join(tmpdir(), "desktop-advanced-"));
    temporaryDirectories.push(userDataPath);
    let runtime: DesktopRuntime | null = null;
    try {
      const initial = createRuntime(userDataPath);
      await initial.close();
      const submittedAt = new Date(Date.now() - 10_000).toISOString();
      const stored = openUserDataDatabase(userDataPath);
      const papers = new LocalPaperTradingRepository(stored.database);
      const { order, execution } = restingBuy(submittedAt);
      papers.commitPaperExecution({
        commitId: "seed-advanced-resting-buy",
        order,
        execution,
        reservedCashMinor: "350053",
        cashLedgerEntries: [],
        occurredAt: submittedAt,
      });
      stored.database.close();

      runtime = createRuntime(userDataPath);
      runtime.applyReadOnlyMarketProjection(
        advancedQueueProjection("1001", "1", "2"),
      );
      expect(runtime.getBootstrap().account).toMatchObject({
        simulationProfile: "ADVANCED_QUEUE_V1",
        queuePositionQuality: "QUEUE_ESTIMATED",
        queueSafetyFactor: "1",
        fills: [],
      });
      runtime.applyReadOnlyMarketProjection(
        advancedQueueProjection("1002", "1", "1"),
      );
      expect(runtime.getBootstrap().account.fills).toHaveLength(0);
      runtime.applyReadOnlyMarketProjection(
        advancedQueueProjection("1004", "2", "0"),
      );
      expect(runtime.getBootstrap().account).toMatchObject({
        positions: [{ instrumentId: "KRX:005930", quantity: "1" }],
        fills: [
          {
            quantity: "1",
            completion: "PARTIAL",
          },
        ],
      });
      await runtime.close();

      const reopened = openUserDataDatabase(userDataPath);
      const restoredPapers = new LocalPaperTradingRepository(
        reopened.database,
      );
      expect(
        restoredPapers.getAdvancedQueueState(
          "personal-paper-account",
          "resting-restart-buy",
        ),
      ).toMatchObject({
        aheadQuantityEstimate: "0",
        remainingQuantity: "4",
        queuePositionQuality: "QUEUE_ESTIMATED",
      });
      reopened.database.close();
    } finally {
      if (runtime !== null) {
        await runtime.close();
      }
      if (previousProfile === undefined) {
        delete process.env["PAPER_FILL_PROFILE"];
      } else {
        process.env["PAPER_FILL_PROFILE"] = previousProfile;
      }
      if (previousFactor === undefined) {
        delete process.env["PAPER_QUEUE_SAFETY_FACTOR"];
      } else {
        process.env["PAPER_QUEUE_SAFETY_FACTOR"] = previousFactor;
      }
    }
  });
});
