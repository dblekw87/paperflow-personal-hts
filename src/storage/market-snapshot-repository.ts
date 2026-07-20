import type Database from "better-sqlite3";
import { z } from "zod";

const levelSchema = z.object({
  price: z.string().regex(/^[1-9]\d*(?:\.\d+)?$/),
  quantity: z.string().regex(/^\d+$/),
});

const snapshotSchema = z
  .object({
    instrumentId: z.string().regex(/^KRX:[0-9A-Z]{6,7}$/),
    venue: z.literal("KRX"),
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
         ON CONFLICT(instrument_id) DO UPDATE SET
           venue = excluded.venue,
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
          WHERE instrument_id = ?`,
      )
      .get(instrumentId) as SnapshotRow | undefined;
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
}
