import { createHash } from "node:crypto";

import type Database from "better-sqlite3";

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
  readonly checksum: string;
}

const INITIAL_SCHEMA_SQL = `
CREATE TABLE simulation_accounts (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  base_currency TEXT NOT NULL CHECK(length(base_currency) = 3),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'ARCHIVED')),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE cash_ledger (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES simulation_accounts(id),
  currency TEXT NOT NULL CHECK(length(currency) = 3),
  amount_minor TEXT NOT NULL CHECK(
    amount_minor = '0'
    OR (
      amount_minor NOT GLOB '*[^0-9]*'
      AND substr(amount_minor, 1, 1) BETWEEN '1' AND '9'
    )
    OR (
      substr(amount_minor, 1, 1) = '-'
      AND length(amount_minor) > 1
      AND substr(amount_minor, 2) NOT GLOB '*[^0-9]*'
      AND substr(amount_minor, 2, 1) BETWEEN '1' AND '9'
    )
  ),
  entry_type TEXT NOT NULL CHECK(entry_type IN (
    'INITIAL_FUNDING',
    'MANUAL_ADJUSTMENT',
    'TRADE_PRINCIPAL',
    'FEE',
    'TAX',
    'FX_DEBIT',
    'FX_CREDIT'
  )),
  idempotency_key TEXT NOT NULL,
  reference_id TEXT,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(account_id, idempotency_key)
) STRICT;

CREATE INDEX cash_ledger_account_currency_occurred_idx
  ON cash_ledger(account_id, currency, occurred_at, id);

CREATE TRIGGER cash_ledger_immutable_update
BEFORE UPDATE ON cash_ledger
BEGIN
  SELECT RAISE(ABORT, 'cash_ledger is immutable');
END;

CREATE TRIGGER cash_ledger_immutable_delete
BEFORE DELETE ON cash_ledger
BEGIN
  SELECT RAISE(ABORT, 'cash_ledger is immutable');
END;

CREATE TABLE provider_profiles (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK(provider IN ('KIS', 'TOSS')),
  environment TEXT NOT NULL CHECK(environment IN ('PAPER', 'PRODUCTION')),
  display_name TEXT NOT NULL,
  safe_storage_ref TEXT NOT NULL CHECK(safe_storage_ref LIKE 'safe-storage:%'),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(provider, environment, display_name)
) STRICT;
`;

const PAPER_TRADING_SCHEMA_SQL = `
CREATE TABLE paper_orders (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES simulation_accounts(id),
  client_order_id TEXT NOT NULL,
  command_fingerprint TEXT NOT NULL CHECK(length(command_fingerprint) = 64),
  instrument_id TEXT NOT NULL,
  venue TEXT NOT NULL,
  currency TEXT NOT NULL CHECK(length(currency) = 3),
  side TEXT NOT NULL CHECK(side IN ('BUY', 'SELL')),
  order_type TEXT NOT NULL CHECK(order_type IN ('MARKET', 'LIMIT')),
  quantity TEXT NOT NULL CHECK(
    quantity NOT GLOB '*[^0-9]*'
    AND substr(quantity, 1, 1) BETWEEN '1' AND '9'
  ),
  limit_price TEXT CHECK(
    limit_price IS NULL
    OR (
      limit_price NOT GLOB '*[^0-9.]*'
      AND limit_price NOT LIKE '.%'
      AND limit_price NOT LIKE '%.'
      AND length(limit_price) - length(replace(limit_price, '.', '')) <= 1
      AND limit_price <> '0'
    )
  ),
  time_in_force TEXT NOT NULL CHECK(time_in_force = 'DAY'),
  session TEXT NOT NULL CHECK(session = 'REGULAR'),
  submission_mode TEXT NOT NULL CHECK(
    submission_mode IN ('CONFIRM_TICKET', 'ONE_CLICK_ARMED')
  ),
  status TEXT NOT NULL CHECK(status IN (
    'ACCEPTED',
    'RESTING',
    'PARTIALLY_FILLED',
    'PARTIALLY_FILLED_CANCELLED',
    'FILLED',
    'CANCELLED',
    'REJECTED'
  )),
  filled_quantity TEXT NOT NULL CHECK(
    filled_quantity = '0'
    OR (
      filled_quantity NOT GLOB '*[^0-9]*'
      AND substr(filled_quantity, 1, 1) BETWEEN '1' AND '9'
    )
  ),
  remaining_quantity TEXT NOT NULL CHECK(
    remaining_quantity = '0'
    OR (
      remaining_quantity NOT GLOB '*[^0-9]*'
      AND substr(remaining_quantity, 1, 1) BETWEEN '1' AND '9'
    )
  ),
  cancelled_quantity TEXT NOT NULL CHECK(
    cancelled_quantity = '0'
    OR (
      cancelled_quantity NOT GLOB '*[^0-9]*'
      AND substr(cancelled_quantity, 1, 1) BETWEEN '1' AND '9'
    )
  ),
  reserved_cash_minor TEXT NOT NULL CHECK(
    reserved_cash_minor = '0'
    OR (
      reserved_cash_minor NOT GLOB '*[^0-9]*'
      AND substr(reserved_cash_minor, 1, 1) BETWEEN '1' AND '9'
    )
  ),
  submitted_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  simulation_only INTEGER NOT NULL DEFAULT 1 CHECK(simulation_only = 1),
  UNIQUE(account_id, client_order_id),
  CHECK(
    (order_type = 'MARKET' AND limit_price IS NULL)
    OR (order_type = 'LIMIT' AND limit_price IS NOT NULL)
  )
) STRICT;

CREATE INDEX paper_orders_account_status_idx
  ON paper_orders(account_id, status, updated_at, id);
CREATE INDEX paper_orders_instrument_idx
  ON paper_orders(account_id, instrument_id, submitted_at, id);

CREATE TABLE paper_fills (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES paper_orders(id),
  market_event_id TEXT NOT NULL,
  price_decimal TEXT NOT NULL CHECK(
    price_decimal NOT GLOB '*[^0-9.]*'
    AND price_decimal NOT LIKE '.%'
    AND price_decimal NOT LIKE '%.'
    AND length(price_decimal) - length(replace(price_decimal, '.', '')) <= 1
    AND price_decimal <> '0'
  ),
  quantity TEXT NOT NULL CHECK(
    quantity NOT GLOB '*[^0-9]*'
    AND substr(quantity, 1, 1) BETWEEN '1' AND '9'
  ),
  gross_notional_decimal TEXT NOT NULL CHECK(
    gross_notional_decimal NOT GLOB '*[^0-9.]*'
    AND gross_notional_decimal NOT LIKE '.%'
    AND gross_notional_decimal NOT LIKE '%.'
    AND length(gross_notional_decimal)
      - length(replace(gross_notional_decimal, '.', '')) <= 1
    AND gross_notional_decimal <> '0'
  ),
  liquidity TEXT NOT NULL CHECK(liquidity IN (
    'BOOK_TAKING',
    'PASSIVE_AT_OR_THROUGH',
    'PASSIVE_TRADE_THROUGH'
  )),
  fill_model_version TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  simulation_only INTEGER NOT NULL DEFAULT 1 CHECK(simulation_only = 1)
) STRICT;

CREATE INDEX paper_fills_order_occurred_idx
  ON paper_fills(order_id, occurred_at, id);

CREATE TRIGGER paper_fills_immutable_update
BEFORE UPDATE ON paper_fills
BEGIN
  SELECT RAISE(ABORT, 'paper_fills is immutable');
END;

CREATE TRIGGER paper_fills_immutable_delete
BEFORE DELETE ON paper_fills
BEGIN
  SELECT RAISE(ABORT, 'paper_fills is immutable');
END;

CREATE TABLE paper_positions (
  account_id TEXT NOT NULL REFERENCES simulation_accounts(id),
  instrument_id TEXT NOT NULL,
  venue TEXT NOT NULL,
  currency TEXT NOT NULL CHECK(length(currency) = 3),
  quantity TEXT NOT NULL CHECK(
    quantity = '0'
    OR (
      quantity NOT GLOB '*[^0-9]*'
      AND substr(quantity, 1, 1) BETWEEN '1' AND '9'
    )
  ),
  reserved_sell_quantity TEXT NOT NULL CHECK(
    reserved_sell_quantity = '0'
    OR (
      reserved_sell_quantity NOT GLOB '*[^0-9]*'
      AND substr(reserved_sell_quantity, 1, 1) BETWEEN '1' AND '9'
    )
  ),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(account_id, instrument_id)
) STRICT;

CREATE TABLE paper_execution_commits (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES paper_orders(id),
  input_fingerprint TEXT NOT NULL CHECK(length(input_fingerprint) = 64),
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  simulation_only INTEGER NOT NULL DEFAULT 1 CHECK(simulation_only = 1)
) STRICT;

CREATE TRIGGER paper_execution_commits_immutable_update
BEFORE UPDATE ON paper_execution_commits
BEGIN
  SELECT RAISE(ABORT, 'paper_execution_commits is immutable');
END;

CREATE TRIGGER paper_execution_commits_immutable_delete
BEFORE DELETE ON paper_execution_commits
BEGIN
  SELECT RAISE(ABORT, 'paper_execution_commits is immutable');
END;
`;

const PAPER_MARKET_CURSOR_SCHEMA_SQL = `
CREATE TABLE paper_market_cursors (
  account_id TEXT NOT NULL REFERENCES simulation_accounts(id),
  instrument_id TEXT NOT NULL,
  session_key TEXT NOT NULL,
  last_sequence TEXT NOT NULL CHECK(
    last_sequence = '0'
    OR (
      last_sequence NOT GLOB '*[^0-9]*'
      AND substr(last_sequence, 1, 1) BETWEEN '1' AND '9'
    )
  ),
  last_market_event_id TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  simulation_only INTEGER NOT NULL DEFAULT 1 CHECK(simulation_only = 1),
  PRIMARY KEY(account_id, instrument_id, session_key)
) STRICT;

CREATE TABLE paper_market_event_receipts (
  account_id TEXT NOT NULL REFERENCES simulation_accounts(id),
  market_event_id TEXT NOT NULL,
  instrument_id TEXT NOT NULL,
  session_key TEXT NOT NULL,
  sequence TEXT NOT NULL CHECK(
    sequence = '0'
    OR (
      sequence NOT GLOB '*[^0-9]*'
      AND substr(sequence, 1, 1) BETWEEN '1' AND '9'
    )
  ),
  observed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  simulation_only INTEGER NOT NULL DEFAULT 1 CHECK(simulation_only = 1),
  PRIMARY KEY(account_id, market_event_id)
) STRICT;

CREATE INDEX paper_market_receipts_scope_sequence_idx
  ON paper_market_event_receipts(
    account_id, instrument_id, session_key, sequence
  );

CREATE TRIGGER paper_market_receipts_immutable_update
BEFORE UPDATE ON paper_market_event_receipts
BEGIN
  SELECT RAISE(ABORT, 'paper_market_event_receipts is immutable');
END;

CREATE TRIGGER paper_market_receipts_immutable_delete
BEFORE DELETE ON paper_market_event_receipts
BEGIN
  SELECT RAISE(ABORT, 'paper_market_event_receipts is immutable');
END;
`;

const ADVANCED_QUEUE_SCHEMA_SQL = `
CREATE TABLE paper_advanced_queue_states (
  account_id TEXT NOT NULL REFERENCES simulation_accounts(id),
  client_order_id TEXT NOT NULL,
  instrument_id TEXT NOT NULL,
  venue TEXT NOT NULL,
  currency TEXT NOT NULL CHECK(length(currency) = 3),
  side TEXT NOT NULL CHECK(side IN ('BUY', 'SELL')),
  limit_price TEXT NOT NULL,
  remaining_quantity TEXT NOT NULL,
  ahead_quantity_estimate TEXT NOT NULL,
  last_displayed_quantity_at_price TEXT NOT NULL,
  safety_factor TEXT NOT NULL,
  queue_position_quality TEXT NOT NULL CHECK(
    queue_position_quality = 'QUEUE_ESTIMATED'
  ),
  session_key TEXT NOT NULL,
  last_order_book_sequence TEXT NOT NULL,
  last_trade_sequence TEXT,
  seen_market_event_ids_json TEXT NOT NULL CHECK(
    json_valid(seen_market_event_ids_json)
  ),
  vi_paused INTEGER NOT NULL CHECK(vi_paused IN (0, 1)),
  updated_at TEXT NOT NULL,
  simulation_only INTEGER NOT NULL DEFAULT 1 CHECK(simulation_only = 1),
  PRIMARY KEY(account_id, client_order_id),
  FOREIGN KEY(account_id, client_order_id)
    REFERENCES paper_orders(account_id, client_order_id)
) STRICT;

CREATE INDEX paper_advanced_queue_scope_idx
  ON paper_advanced_queue_states(account_id, instrument_id, session_key);
`;

const INFORMATION_FEED_SCHEMA_SQL = `
CREATE TABLE information_items (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK(provider IN (
    'KIS_DOMESTIC_NEWS',
    'KIS_OVERSEAS_NEWS',
    'SEC_EDGAR',
    'OPEN_DART'
  )),
  provider_item_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('NEWS', 'DISCLOSURE')),
  title_original TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_language TEXT NOT NULL CHECK(length(source_language) BETWEEN 2 AND 12),
  published_at TEXT NOT NULL,
  published_at_precision TEXT NOT NULL CHECK(
    published_at_precision IN ('SECOND', 'DATE')
  ),
  obtained_at TEXT NOT NULL,
  canonical_url TEXT,
  rights TEXT NOT NULL CHECK(rights IN (
    'KIS_HEADLINE_ONLY',
    'PUBLIC_FILING'
  )),
  related_instruments_json TEXT NOT NULL CHECK(
    json_valid(related_instruments_json)
  ),
  payload_hash TEXT NOT NULL CHECK(length(payload_hash) = 64),
  created_at TEXT NOT NULL,
  UNIQUE(provider, provider_item_id)
) STRICT;

CREATE INDEX information_items_published_idx
  ON information_items(published_at DESC, id);
CREATE INDEX information_items_kind_published_idx
  ON information_items(kind, published_at DESC, id);

CREATE TRIGGER information_items_immutable_update
BEFORE UPDATE ON information_items
BEGIN
  SELECT RAISE(ABORT, 'information_items is immutable');
END;

CREATE TRIGGER information_items_immutable_delete
BEFORE DELETE ON information_items
BEGIN
  SELECT RAISE(ABORT, 'information_items is immutable');
END;

CREATE TABLE information_translation_versions (
  id TEXT PRIMARY KEY,
  information_item_id TEXT NOT NULL REFERENCES information_items(id),
  locale TEXT NOT NULL CHECK(locale = 'ko-KR'),
  input_hash TEXT NOT NULL CHECK(length(input_hash) = 64),
  translated_title TEXT NOT NULL,
  translated_summary TEXT,
  translation_provider TEXT NOT NULL,
  model_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('COMPLETE', 'PARTIAL', 'STALE')),
  generated_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(
    information_item_id,
    locale,
    input_hash,
    translation_provider,
    model_version
  )
) STRICT;

CREATE INDEX information_translation_item_generated_idx
  ON information_translation_versions(
    information_item_id,
    generated_at DESC,
    id
  );

CREATE TRIGGER information_translation_versions_immutable_update
BEFORE UPDATE ON information_translation_versions
BEGIN
  SELECT RAISE(ABORT, 'information_translation_versions is immutable');
END;

CREATE TRIGGER information_translation_versions_immutable_delete
BEFORE DELETE ON information_translation_versions
BEGIN
  SELECT RAISE(ABORT, 'information_translation_versions is immutable');
END;

CREATE TABLE information_poll_checkpoints (
  provider TEXT PRIMARY KEY CHECK(provider IN (
    'KIS_DOMESTIC_NEWS',
    'KIS_OVERSEAS_NEWS',
    'SEC_EDGAR',
    'OPEN_DART'
  )),
  cursor_json TEXT NOT NULL CHECK(json_valid(cursor_json)),
  last_success_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
`;

const DOMESTIC_ORDERBOOK_SNAPSHOT_SCHEMA_SQL = `
CREATE TABLE domestic_orderbook_snapshots (
  instrument_id TEXT PRIMARY KEY CHECK(instrument_id GLOB 'KRX:*'),
  venue TEXT NOT NULL CHECK(venue = 'KRX'),
  bids_json TEXT NOT NULL CHECK(json_valid(bids_json)),
  asks_json TEXT NOT NULL CHECK(json_valid(asks_json)),
  total_bid_quantity TEXT,
  total_ask_quantity TEXT,
  provider_time TEXT NOT NULL CHECK(length(provider_time) = 6),
  provider_received_at TEXT NOT NULL,
  captured_at TEXT NOT NULL
) STRICT;

CREATE INDEX domestic_orderbook_snapshots_captured_idx
  ON domestic_orderbook_snapshots(captured_at DESC, instrument_id);
`;

const DOMESTIC_VENUE_TRADE_SNAPSHOT_SCHEMA_SQL = `
CREATE TABLE domestic_venue_trade_snapshots (
  instrument_id TEXT NOT NULL CHECK(instrument_id GLOB 'KRX:*'),
  venue TEXT NOT NULL CHECK(venue IN ('KRX', 'NXT')),
  price TEXT NOT NULL CHECK(price GLOB '[1-9]*'),
  change_amount TEXT,
  change_rate TEXT,
  provider_date TEXT,
  provider_time TEXT NOT NULL CHECK(length(provider_time) = 6),
  provider_received_at TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  PRIMARY KEY(instrument_id, venue)
) STRICT;

CREATE INDEX domestic_venue_trade_snapshots_captured_idx
  ON domestic_venue_trade_snapshots(captured_at DESC, instrument_id, venue);
`;

const DOMESTIC_ORDERBOOK_VENUE_SCHEMA_SQL = `
ALTER TABLE domestic_orderbook_snapshots RENAME TO domestic_orderbook_snapshots_v6;
CREATE TABLE domestic_orderbook_snapshots (
  instrument_id TEXT NOT NULL CHECK(instrument_id GLOB 'KRX:*'),
  venue TEXT NOT NULL CHECK(venue IN ('KRX', 'NXT')),
  bids_json TEXT NOT NULL CHECK(json_valid(bids_json)),
  asks_json TEXT NOT NULL CHECK(json_valid(asks_json)),
  total_bid_quantity TEXT,
  total_ask_quantity TEXT,
  provider_time TEXT NOT NULL CHECK(length(provider_time) = 6),
  provider_received_at TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  PRIMARY KEY(instrument_id, venue)
) STRICT;
INSERT INTO domestic_orderbook_snapshots
SELECT instrument_id, venue, bids_json, asks_json, total_bid_quantity,
       total_ask_quantity, provider_time, provider_received_at, captured_at
  FROM domestic_orderbook_snapshots_v6;
DROP TABLE domestic_orderbook_snapshots_v6;
CREATE INDEX domestic_orderbook_snapshots_captured_idx
  ON domestic_orderbook_snapshots(captured_at DESC, instrument_id, venue);
`;

const MARKET_CALENDAR_SCHEMA_SQL = `
CREATE TABLE market_calendar_events (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  market_scope TEXT NOT NULL CHECK(market_scope IN ('KR', 'US', 'GLOBAL')),
  affected_markets_json TEXT NOT NULL CHECK(json_valid(affected_markets_json)),
  instrument_ids_json TEXT NOT NULL CHECK(json_valid(instrument_ids_json)),
  title_ko TEXT NOT NULL,
  title_original TEXT,
  scheduled_at TEXT NOT NULL,
  local_date TEXT NOT NULL CHECK(
    local_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  ),
  timezone TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN (
    'SCHEDULED',
    'CONFIRMED',
    'REPORTED',
    'UPDATED',
    'CANCELLED',
    'TENTATIVE'
  )),
  importance TEXT NOT NULL CHECK(importance IN (
    'LOW',
    'MEDIUM',
    'HIGH',
    'CRITICAL'
  )),
  provider TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  source_url TEXT,
  data_quality TEXT NOT NULL,
  metrics_json TEXT NOT NULL CHECK(json_valid(metrics_json)),
  evidence_ids_json TEXT NOT NULL CHECK(json_valid(evidence_ids_json)),
  supersedes_event_id TEXT,
  detected_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  payload_version INTEGER NOT NULL CHECK(payload_version > 0),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  created_at TEXT NOT NULL,
  UNIQUE(provider, source_event_id)
) STRICT;

CREATE INDEX market_calendar_events_local_date_idx
  ON market_calendar_events(local_date, scheduled_at, id);
CREATE INDEX market_calendar_events_market_scope_idx
  ON market_calendar_events(market_scope, local_date, scheduled_at, id);

CREATE TRIGGER market_calendar_events_immutable_update
BEFORE UPDATE ON market_calendar_events
BEGIN
  SELECT RAISE(ABORT, 'market_calendar_events is immutable');
END;

CREATE TRIGGER market_calendar_events_immutable_delete
BEFORE DELETE ON market_calendar_events
BEGIN
  SELECT RAISE(ABORT, 'market_calendar_events is immutable');
END;
`;

function defineMigration(
  version: number,
  name: string,
  sql: string,
): Migration {
  return {
    version,
    name,
    sql,
    checksum: createHash("sha256").update(sql).digest("hex"),
  };
}

export const MIGRATIONS: readonly Migration[] = [
  defineMigration(1, "initial_local_simulation_storage", INITIAL_SCHEMA_SQL),
  defineMigration(2, "local_paper_orders_and_fills", PAPER_TRADING_SCHEMA_SQL),
  defineMigration(
    3,
    "paper_market_event_high_watermarks",
    PAPER_MARKET_CURSOR_SCHEMA_SQL,
  ),
  defineMigration(
    4,
    "advanced_queue_state_projection",
    ADVANCED_QUEUE_SCHEMA_SQL,
  ),
  defineMigration(
    5,
    "local_news_and_disclosure_feed",
    INFORMATION_FEED_SCHEMA_SQL,
  ),
  defineMigration(
    6,
    "last_real_domestic_orderbook_snapshots",
    DOMESTIC_ORDERBOOK_SNAPSHOT_SCHEMA_SQL,
  ),
  defineMigration(
    7,
    "last_real_domestic_venue_trade_snapshots",
    DOMESTIC_VENUE_TRADE_SNAPSHOT_SCHEMA_SQL,
  ),
  defineMigration(
    8,
    "domestic_orderbook_snapshots_per_venue",
    DOMESTIC_ORDERBOOK_VENUE_SCHEMA_SQL,
  ),
  defineMigration(
    9,
    "market_event_calendar",
    MARKET_CALENDAR_SCHEMA_SQL,
  ),
];

export function applyMigrations(
  database: Database.Database,
  now: () => string,
): number {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);

  const appliedRows = database
    .prepare("SELECT version, checksum FROM schema_version ORDER BY version")
    .all() as Array<{ version: number; checksum: string }>;
  const applied = new Map(
    appliedRows.map((row) => [row.version, row.checksum]),
  );

  for (const migration of MIGRATIONS) {
    const existingChecksum = applied.get(migration.version);
    if (existingChecksum !== undefined) {
      if (existingChecksum !== migration.checksum) {
        throw new Error(
          `Migration checksum mismatch at version ${migration.version}`,
        );
      }
      continue;
    }

    const migrate = database.transaction(() => {
      database.exec(migration.sql);
      database
        .prepare(
          "INSERT INTO schema_version(version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
        )
        .run(migration.version, migration.name, migration.checksum, now());
    });
    migrate.immediate();
  }

  return MIGRATIONS.at(-1)?.version ?? 0;
}
