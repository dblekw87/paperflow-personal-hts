import type Database from "better-sqlite3";

import { MIGRATIONS } from "./migrations.js";

export interface DatabaseHealth {
  readonly healthy: boolean;
  readonly code: "SQLITE_HEALTHY" | "SQLITE_UNHEALTHY";
  readonly message: string;
  readonly schemaVersion: number;
}

export function inspectDatabaseHealth(
  database: Database.Database,
): DatabaseHealth {
  try {
    const foreignKeys = Number(
      database.pragma("foreign_keys", { simple: true }),
    );
    const foreignKeyViolations = database.pragma(
      "foreign_key_check",
    ) as unknown[];
    const busyTimeout = Number(
      database.pragma("busy_timeout", { simple: true }),
    );
    const integrity = String(
      database.pragma("integrity_check", { simple: true }),
    );
    const migrationRows = database
      .prepare("SELECT version, checksum FROM schema_version ORDER BY version")
      .all() as Array<{ version: number; checksum: string }>;
    const row = {
      version: migrationRows.at(-1)?.version ?? 0,
    };
    const expectedVersion = MIGRATIONS.at(-1)?.version ?? 0;
    const migrationChecksumsValid =
      migrationRows.length === MIGRATIONS.length &&
      MIGRATIONS.every(
        (migration, index) =>
          migrationRows[index]?.version === migration.version &&
          migrationRows[index]?.checksum === migration.checksum,
      );
    const triggerRows = database
      .prepare(
        `SELECT name, sql
           FROM sqlite_master
          WHERE type = 'trigger'
            AND name IN (
              'cash_ledger_immutable_update',
              'cash_ledger_immutable_delete',
              'paper_fills_immutable_update',
              'paper_fills_immutable_delete',
              'paper_execution_commits_immutable_update',
              'paper_execution_commits_immutable_delete',
              'paper_market_receipts_immutable_update',
              'paper_market_receipts_immutable_delete'
            )`,
      )
      .all() as Array<{ name: string; sql: string }>;
    const triggersByName = new Map(
      triggerRows.map((trigger) => [trigger.name, trigger.sql]),
    );
    const immutableTriggersValid =
      /BEFORE\s+UPDATE[\s\S]*RAISE\s*\(\s*ABORT\s*,\s*'cash_ledger is immutable'/i.test(
        triggersByName.get("cash_ledger_immutable_update") ?? "",
      ) &&
      /BEFORE\s+DELETE[\s\S]*RAISE\s*\(\s*ABORT\s*,\s*'cash_ledger is immutable'/i.test(
        triggersByName.get("cash_ledger_immutable_delete") ?? "",
      ) &&
      /BEFORE\s+UPDATE[\s\S]*RAISE\s*\(\s*ABORT\s*,\s*'paper_fills is immutable'/i.test(
        triggersByName.get("paper_fills_immutable_update") ?? "",
      ) &&
      /BEFORE\s+DELETE[\s\S]*RAISE\s*\(\s*ABORT\s*,\s*'paper_fills is immutable'/i.test(
        triggersByName.get("paper_fills_immutable_delete") ?? "",
      ) &&
      /BEFORE\s+UPDATE[\s\S]*RAISE\s*\(\s*ABORT\s*,\s*'paper_execution_commits is immutable'/i.test(
        triggersByName.get("paper_execution_commits_immutable_update") ?? "",
      ) &&
      /BEFORE\s+DELETE[\s\S]*RAISE\s*\(\s*ABORT\s*,\s*'paper_execution_commits is immutable'/i.test(
        triggersByName.get("paper_execution_commits_immutable_delete") ?? "",
      ) &&
      /BEFORE\s+UPDATE[\s\S]*RAISE\s*\(\s*ABORT\s*,\s*'paper_market_event_receipts is immutable'/i.test(
        triggersByName.get("paper_market_receipts_immutable_update") ?? "",
      ) &&
      /BEFORE\s+DELETE[\s\S]*RAISE\s*\(\s*ABORT\s*,\s*'paper_market_event_receipts is immutable'/i.test(
        triggersByName.get("paper_market_receipts_immutable_delete") ?? "",
      );
    const healthy =
      foreignKeys === 1 &&
      foreignKeyViolations.length === 0 &&
      busyTimeout > 0 &&
      integrity === "ok" &&
      row.version === expectedVersion &&
      migrationChecksumsValid &&
      immutableTriggersValid;

    return {
      healthy,
      code: healthy ? "SQLITE_HEALTHY" : "SQLITE_UNHEALTHY",
      message: healthy
        ? `SQLite integrity, foreign-key rows, migration checksums, immutable ledger triggers, busy timeout, and schema v${row.version} are valid`
        : `SQLite check failed: integrity=${integrity}, foreignKeys=${foreignKeys}, foreignKeyViolations=${foreignKeyViolations.length}, busyTimeout=${busyTimeout}, schema=${row.version}/${expectedVersion}, migrationChecksums=${migrationChecksumsValid}, immutableTriggers=${immutableTriggersValid}`,
      schemaVersion: row.version,
    };
  } catch (error) {
    return {
      healthy: false,
      code: "SQLITE_UNHEALTHY",
      message:
        error instanceof Error ? error.message : "Unknown SQLite health error",
      schemaVersion: 0,
    };
  }
}
