import { describe, expect, it } from "vitest";

import { openPaperTradingDatabase } from "../src/storage/database.js";
import { LocalMarketSnapshotRepository } from "../src/storage/market-snapshot-repository.js";

const RECEIVED_AT = "2026-07-20T06:29:59.000Z";
const CAPTURED_AT = "2026-07-20T06:30:00.000Z";

describe("local real order-book snapshots", () => {
  it("persists and restores the last actual book by instrument", () => {
    const opened = openPaperTradingDatabase({ filename: ":memory:" });
    try {
      const snapshots = new LocalMarketSnapshotRepository(
        opened.database,
        () => CAPTURED_AT,
      );
      snapshots.saveDomesticOrderBook({
        instrumentId: "KRX:320000",
        venue: "KRX",
        bids: [{ price: "15960", quantity: "120" }],
        asks: [{ price: "15970", quantity: "90" }],
        totalBidQuantity: "120",
        totalAskQuantity: "90",
        providerTime: "152959",
        providerReceivedAt: RECEIVED_AT,
      });

      expect(snapshots.getDomesticOrderBook("KRX:320000")).toEqual({
        instrumentId: "KRX:320000",
        venue: "KRX",
        bids: [{ price: "15960", quantity: "120" }],
        asks: [{ price: "15970", quantity: "90" }],
        totalBidQuantity: "120",
        totalAskQuantity: "90",
        providerTime: "152959",
        providerReceivedAt: RECEIVED_AT,
        capturedAt: CAPTURED_AT,
      });
    } finally {
      opened.database.close();
    }
  });

  it("does not allow an empty or unavailable book to overwrite real data", () => {
    const opened = openPaperTradingDatabase({ filename: ":memory:" });
    try {
      const snapshots = new LocalMarketSnapshotRepository(opened.database);
      expect(() =>
        snapshots.saveDomesticOrderBook({
          instrumentId: "KRX:320000",
          venue: "KRX",
          bids: [],
          asks: [],
          totalBidQuantity: "0",
          totalAskQuantity: "0",
          providerTime: "000000",
          providerReceivedAt: RECEIVED_AT,
        }),
      ).toThrow();
      expect(snapshots.getDomesticOrderBook("KRX:320000")).toBeNull();
    } finally {
      opened.database.close();
    }
  });

  it("keeps NXT closing book and trade separate from KRX", () => {
    const opened = openPaperTradingDatabase({ filename: ":memory:" });
    try {
      const snapshots = new LocalMarketSnapshotRepository(
        opened.database,
        () => CAPTURED_AT,
      );
      snapshots.saveDomesticOrderBook({
        instrumentId: "KRX:005930",
        venue: "NXT",
        bids: [{ price: "263500", quantity: "12" }],
        asks: [{ price: "264000", quantity: "8" }],
        totalBidQuantity: "12",
        totalAskQuantity: "8",
        providerTime: "195959",
        providerReceivedAt: RECEIVED_AT,
      });
      snapshots.saveDomesticTrade({
        instrumentId: "KRX:005930",
        venue: "NXT",
        price: "263500",
        change: "4500",
        changeRate: "1.74",
        providerDate: "20260720",
        providerTime: "195959",
        providerReceivedAt: RECEIVED_AT,
      });
      expect(snapshots.getDomesticOrderBook("KRX:005930", "NXT")?.venue).toBe(
        "NXT",
      );
      expect(snapshots.getDomesticTrade("KRX:005930", "NXT")?.price).toBe(
        "263500",
      );
      expect(snapshots.getDomesticOrderBook("KRX:005930", "KRX")).toBeNull();
    } finally {
      opened.database.close();
    }
  });
});
