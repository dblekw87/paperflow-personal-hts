import type Database from "better-sqlite3";

import {
  MarketCalendarEventSchema,
  type MarketCalendarEvent,
  type MarketCalendarRegion,
} from "../contracts/market-calendar.js";

interface MarketCalendarEventRow {
  payload_json: string;
}

export class LocalMarketCalendarRepository {
  readonly #database: Database.Database;
  readonly #now: () => string;

  constructor(
    database: Database.Database,
    now: () => string = () => new Date().toISOString(),
  ) {
    this.#database = database;
    this.#now = now;
  }

  ingest(eventInput: MarketCalendarEvent): boolean {
    const event = MarketCalendarEventSchema.parse(eventInput);
    const result = this.#database
      .prepare(
        `INSERT OR IGNORE INTO market_calendar_events(
          id, kind, market_scope, affected_markets_json,
          instrument_ids_json, title_ko, title_original, scheduled_at,
          local_date, timezone, status, importance, provider,
          source_event_id, source_url, data_quality, metrics_json,
          evidence_ids_json, supersedes_event_id, detected_at, updated_at,
          payload_version, payload_json, created_at
        ) VALUES (
          @id, @kind, @marketScope, @affectedMarketsJson,
          @instrumentIdsJson, @titleKo, @titleOriginal, @scheduledAt,
          @localDate, @timezone, @status, @importance, @provider,
          @sourceEventId, @sourceUrl, @dataQuality, @metricsJson,
          @evidenceIdsJson, @supersedesEventId, @detectedAt, @updatedAt,
          @payloadVersion, @payloadJson, @createdAt
        )`,
      )
      .run({
        id: event.id,
        kind: event.kind,
        marketScope: event.marketScope,
        affectedMarketsJson: JSON.stringify(event.affectedMarkets),
        instrumentIdsJson: JSON.stringify(event.instrumentIds),
        titleKo: event.titleKo,
        titleOriginal: event.titleOriginal,
        scheduledAt: event.scheduledAt,
        localDate: event.localDate,
        timezone: event.timezone,
        status: event.status,
        importance: event.importance,
        provider: event.provider,
        sourceEventId: event.sourceEventId,
        sourceUrl: event.sourceUrl,
        dataQuality: event.dataQuality,
        metricsJson: JSON.stringify(event.metrics),
        evidenceIdsJson: JSON.stringify(event.evidenceIds),
        supersedesEventId: event.supersedesEventId,
        detectedAt: event.detectedAt,
        updatedAt: event.updatedAt,
        payloadVersion: event.payloadVersion,
        payloadJson: JSON.stringify(event),
        createdAt: this.#now(),
      });
    return result.changes === 1;
  }

  listRange(options: {
    readonly dateFrom: string;
    readonly dateTo: string;
    readonly markets?: readonly MarketCalendarRegion[];
    readonly limit?: number;
  }): MarketCalendarEvent[] {
    const limit = Math.max(1, Math.min(options.limit ?? 500, 1_000));
    const markets = options.markets ?? [];
    const rows = this.#database
      .prepare(
        `SELECT payload_json
           FROM market_calendar_events
          WHERE local_date >= @dateFrom
            AND local_date <= @dateTo
            AND (
              @marketsJson = '[]'
              OR EXISTS (
                SELECT 1
                  FROM json_each(affected_markets_json)
                 WHERE value IN (
                   SELECT value FROM json_each(@marketsJson)
                 )
              )
            )
          ORDER BY scheduled_at ASC, id ASC
          LIMIT @limit`,
      )
      .all({
        dateFrom: options.dateFrom,
        dateTo: options.dateTo,
        marketsJson: JSON.stringify(markets),
        limit,
      }) as MarketCalendarEventRow[];
    return rows.map((row) =>
      MarketCalendarEventSchema.parse(JSON.parse(row.payload_json)),
    );
  }
}
