import type Database from "better-sqlite3";
import { z } from "zod";

const levelSchema = z.object({
  price: z.string().regex(/^[1-9]\d*(?:\.\d+)?$/),
  quantity: z.string().regex(/^\d+$/),
});

const snapshotSchema = z
  .object({
    instrumentId: z.string().regex(/^KRX:[0-9A-Z]{6,7}$/),
    venue: z.enum(["KRX", "NXT"]),
    bids: z.array(levelSchema).max(10),
    asks: z.array(levelSchema).max(10),
    totalBidQuantity: z.string().regex(/^\d+$/).nullable(),
    totalAskQuantity: z.string().regex(/^\d+$/).nullable(),
    providerTime: z.string().regex(/^\d{6}$/),
    providerReceivedAt: z.string().datetime(),
    capturedAt: z.string().datetime(),
  })
  .superRefine((snapshot, context) => {
    if (snapshot.bids.length + snapshot.asks.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["bids"],
        message: "An empty provider order book must not replace a real snapshot",
      });
    }
    if (snapshot.providerTime === "000000") {
      context.addIssue({
        code: "custom",
        path: ["providerTime"],
        message: "An unavailable provider timestamp must not be persisted",
      });
    }
  });

export type StoredDomesticOrderBookSnapshot = z.infer<typeof snapshotSchema>;

export interface StoredDomesticTradeSnapshot {
  readonly instrumentId: string;
  readonly venue: "KRX" | "NXT";
  readonly price: string;
  readonly change: string | null;
  readonly changeRate: string | null;
  readonly providerDate: string | null;
  readonly providerTime: string;
  readonly providerReceivedAt: string;
  readonly capturedAt: string;
}

interface SnapshotRow {
  readonly instrument_id: string;
  readonly venue: string;
  readonly bids_json: string;
  readonly asks_json: string;
  readonly total_bid_quantity: string | null;
  readonly total_ask_quantity: string | null;
  readonly provider_time: string;
  readonly provider_received_at: string;
  readonly captured_at: string;
}

export class LocalMarketSnapshotRepository {
  readonly #database: Database.Database;
  readonly #now: () => string;

  constructor(
    database: Database.Database,
    now: () => string = () => new Date().toISOString(),
  ) {
    this.#database = database;
    this.#now = now;
  }

  saveDomesticOrderBook(
    input: Omit<StoredDomesticOrderBookSnapshot, "capturedAt"> & {
      readonly capturedAt?: string;
    },
  ): StoredDomesticOrderBookSnapshot {
    const snapshot = snapshotSchema.parse({
      ...input,
      capturedAt: input.capturedAt ?? this.#now(),
    });
    this.#database
      .prepare(
        `INSERT INTO domestic_orderbook_snapshots(
           instrument_id, venue, bids_json, asks_json,
           total_bid_quantity, total_ask_quantity, provider_time,
           provider_received_at, captured_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(instrument_id, venue) DO UPDATE SET
           bids_json = excluded.bids_json,
           asks_json = excluded.asks_json,
           total_bid_quantity = excluded.total_bid_quantity,
           total_ask_quantity = excluded.total_ask_quantity,
           provider_time = excluded.provider_time,
           provider_received_at = excluded.provider_received_at,
           captured_at = excluded.captured_at`,
      )
      .run(
        snapshot.instrumentId,
        snapshot.venue,
        JSON.stringify(snapshot.bids),
        JSON.stringify(snapshot.asks),
        snapshot.totalBidQuantity,
        snapshot.totalAskQuantity,
        snapshot.providerTime,
        snapshot.providerReceivedAt,
        snapshot.capturedAt,
      );
    return snapshot;
  }

  getDomesticOrderBook(
    instrumentId: string,
    venue: "KRX" | "NXT" = "KRX",
  ): StoredDomesticOrderBookSnapshot | null {
    if (!/^KRX:[0-9A-Z]{6,7}$/.test(instrumentId)) {
      throw new TypeError("Expected a canonical domestic instrument id");
    }
    const row = this.#database
      .prepare(
        `SELECT instrument_id, venue, bids_json, asks_json,
                total_bid_quantity, total_ask_quantity, provider_time,
                provider_received_at, captured_at
           FROM domestic_orderbook_snapshots
          WHERE instrument_id = ? AND venue = ?`,
      )
      .get(instrumentId, venue) as SnapshotRow | undefined;
    if (row === undefined) return null;
    return snapshotSchema.parse({
      instrumentId: row.instrument_id,
      venue: row.venue,
      bids: JSON.parse(row.bids_json) as unknown,
      asks: JSON.parse(row.asks_json) as unknown,
      totalBidQuantity: row.total_bid_quantity,
      totalAskQuantity: row.total_ask_quantity,
      providerTime: row.provider_time,
      providerReceivedAt: row.provider_received_at,
      capturedAt: row.captured_at,
    });
  }

  saveDomesticTrade(
    input: Omit<StoredDomesticTradeSnapshot, "capturedAt">,
  ): void {
    if (!/^KRX:[0-9A-Z]{6,7}$/.test(input.instrumentId)) return;
    if (!/^[1-9]\d*$/.test(input.price) || !/^\d{6}$/.test(input.providerTime)) return;
    this.#database.prepare(
      `INSERT INTO domestic_venue_trade_snapshots(
         instrument_id, venue, price, change_amount, change_rate,
         provider_date, provider_time, provider_received_at, captured_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(instrument_id, venue) DO UPDATE SET
         price=excluded.price, change_amount=excluded.change_amount,
         change_rate=excluded.change_rate, provider_date=excluded.provider_date,
         provider_time=excluded.provider_time,
         provider_received_at=excluded.provider_received_at,
         captured_at=excluded.captured_at`,
    ).run(
      input.instrumentId, input.venue, input.price, input.change,
      input.changeRate, input.providerDate, input.providerTime,
      input.providerReceivedAt, this.#now(),
    );
  }

  getDomesticTrade(
    instrumentId: string,
    venue: "KRX" | "NXT",
  ): StoredDomesticTradeSnapshot | null {
    const row = this.#database.prepare(
      `SELECT instrument_id, venue, price, change_amount, change_rate,
              provider_date, provider_time, provider_received_at, captured_at
         FROM domestic_venue_trade_snapshots
        WHERE instrument_id = ? AND venue = ?`,
    ).get(instrumentId, venue) as {
      instrument_id: string; venue: "KRX" | "NXT"; price: string;
      change_amount: string | null; change_rate: string | null;
      provider_date: string | null; provider_time: string;
      provider_received_at: string; captured_at: string;
    } | undefined;
    return row ? {
      instrumentId: row.instrument_id, venue: row.venue, price: row.price,
      change: row.change_amount, changeRate: row.change_rate,
      providerDate: row.provider_date, providerTime: row.provider_time,
      providerReceivedAt: row.provider_received_at, capturedAt: row.captured_at,
    } : null;
  }
}
