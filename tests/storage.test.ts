import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  databasePathFromUserData,
  openPaperTradingDatabase,
  openUserDataDatabase,
} from "../src/storage/database.js";
import { inspectDatabaseHealth } from "../src/storage/health.js";
import { LocalSimulationRepository } from "../src/storage/repository.js";

const NOW = "2026-07-20T00:00:00.000Z";
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function openMemoryRepository(): {
  repository: LocalSimulationRepository;
  database: ReturnType<typeof openPaperTradingDatabase>["database"];
} {
  const opened = openPaperTradingDatabase({
    filename: ":memory:",
    now: () => NOW,
  });
  return {
    database: opened.database,
    repository: new LocalSimulationRepository(opened.database, () => NOW),
  };
}

describe("local SQLite storage", () => {
  it("applies migrations and passes an isolated in-memory health check", () => {
    const opened = openPaperTradingDatabase({
      filename: ":memory:",
      now: () => NOW,
    });
    try {
      expect(opened.schemaVersion).toBe(6);
      expect(inspectDatabaseHealth(opened.database)).toEqual({
        healthy: true,
        code: "SQLITE_HEALTHY",
        message:
          "SQLite integrity, foreign-key rows, migration checksums, immutable ledger triggers, busy timeout, and schema v6 are valid",
        schemaVersion: 6,
      });
    } finally {
      opened.database.close();
    }
  });

  it("uses WAL, foreign keys, and busy timeout for an Electron userData file", () => {
    const userData = mkdtempSync(join(tmpdir(), "papertrading-storage-"));
    temporaryDirectories.push(userData);
    const opened = openUserDataDatabase(userData, { now: () => NOW });
    try {
      expect(opened.filename).toBe(databasePathFromUserData(userData));
      expect(opened.database.pragma("journal_mode", { simple: true })).toBe(
        "wal",
      );
      expect(opened.database.pragma("foreign_keys", { simple: true })).toBe(1);
      expect(
        Number(opened.database.pragma("busy_timeout", { simple: true })),
      ).toBeGreaterThan(0);
    } finally {
      opened.database.close();
    }
  });

  it("reopens the same file without replaying an applied migration", () => {
    const userData = mkdtempSync(join(tmpdir(), "papertrading-reopen-"));
    temporaryDirectories.push(userData);
    const first = openUserDataDatabase(userData, { now: () => NOW });
    first.database.close();

    const second = openUserDataDatabase(userData, {
      now: () => "2026-07-21T00:00:00.000Z",
    });
    try {
      expect(
        second.database
          .prepare("SELECT version, applied_at FROM schema_version")
          .all(),
      ).toEqual([
        { version: 1, applied_at: NOW },
        { version: 2, applied_at: NOW },
        { version: 3, applied_at: NOW },
        { version: 4, applied_at: NOW },
        { version: 5, applied_at: NOW },
        { version: 6, applied_at: NOW },
      ]);
    } finally {
      second.database.close();
    }
  });

  it("creates an account and derives an exact BigInt cash balance from immutable TEXT entries", () => {
    const { database, repository } = openMemoryRepository();
    try {
      repository.createAccount({
        id: "account-1",
        displayName: "개인 모의계좌",
        baseCurrency: "KRW",
        initialCashMinor: "900719925474099300000",
        initialLedgerEntryId: "ledger-initial",
        idempotencyKey: "initial-funding",
        occurredAt: NOW,
      });
      repository.appendCashLedgerEntry({
        id: "ledger-fee",
        accountId: "account-1",
        currency: "KRW",
        amountMinor: "-1250",
        entryType: "FEE",
        idempotencyKey: "fee-1",
        occurredAt: NOW,
      });

      expect(repository.getCashBalance("account-1", "KRW")).toBe(
        "900719925474099298750",
      );
      expect(repository.listCashLedger("account-1")).toHaveLength(2);
      expect(
        database
          .prepare(
            "SELECT typeof(amount_minor) AS type FROM cash_ledger LIMIT 1",
          )
          .get(),
      ).toEqual({ type: "text" });
    } finally {
      database.close();
    }
  });

  it("rolls back account creation when its initial ledger entry is invalid", () => {
    const { database, repository } = openMemoryRepository();
    try {
      expect(() =>
        repository.createAccount({
          id: "account-rollback",
          displayName: "rollback",
          baseCurrency: "KRW",
          initialCashMinor: "1000",
          initialLedgerEntryId: "initial",
          idempotencyKey: "initial",
          occurredAt: NOW,
        }),
      ).not.toThrow();
      expect(() =>
        repository.createAccount({
          id: "account-rollback-2",
          displayName: "rollback duplicate ledger",
          baseCurrency: "KRW",
          initialCashMinor: "1000",
          initialLedgerEntryId: "initial",
          idempotencyKey: "initial",
          occurredAt: NOW,
        }),
      ).toThrow();
      expect(
        database
          .prepare("SELECT COUNT(*) AS count FROM simulation_accounts")
          .get(),
      ).toEqual({ count: 1 });
    } finally {
      database.close();
    }
  });

  it("rejects mutation and deletion of cash ledger rows", () => {
    const { database, repository } = openMemoryRepository();
    try {
      repository.createAccount({
        id: "account-immutable",
        displayName: "immutable",
        baseCurrency: "USD",
        initialCashMinor: "10000",
        initialLedgerEntryId: "ledger-immutable",
        idempotencyKey: "initial",
        occurredAt: NOW,
      });

      expect(() =>
        database.prepare("UPDATE cash_ledger SET amount_minor = '0'").run(),
      ).toThrow(/immutable/);
      expect(() => database.prepare("DELETE FROM cash_ledger").run()).toThrow(
        /immutable/,
      );
    } finally {
      database.close();
    }
  });

  it("stores only an opaque safeStorage reference for provider profiles", () => {
    const { database, repository } = openMemoryRepository();
    try {
      repository.saveProviderProfile({
        id: "kis-main",
        provider: "KIS",
        environment: "PRODUCTION",
        displayName: "내 KIS 시세 계정",
        safeStorageRef: "safe-storage:vault/kis-main",
        enabled: true,
      });
      expect(
        database
          .prepare(
            `SELECT provider, safe_storage_ref,
                    instr(lower(sql), 'app_secret') AS secret_column
               FROM provider_profiles, sqlite_master
              WHERE sqlite_master.type = 'table'
                AND sqlite_master.name = 'provider_profiles'`,
          )
          .get(),
      ).toEqual({
        provider: "KIS",
        safe_storage_ref: "safe-storage:vault/kis-main",
        secret_column: 0,
      });
      expect(() =>
        repository.saveProviderProfile({
          id: "bad-profile",
          provider: "KIS",
          environment: "PAPER",
          displayName: "bad",
          safeStorageRef: "actual-secret-value",
          enabled: true,
        }),
      ).toThrow();
    } finally {
      database.close();
    }
  });

  it("rejects non-canonical floating-point amount strings", () => {
    const { database, repository } = openMemoryRepository();
    try {
      repository.createAccount({
        id: "account-exact",
        displayName: "exact",
        baseCurrency: "KRW",
        initialCashMinor: "1000",
        initialLedgerEntryId: "ledger-exact",
        idempotencyKey: "initial",
        occurredAt: NOW,
      });
      expect(() =>
        repository.appendCashLedgerEntry({
          id: "ledger-float",
          accountId: "account-exact",
          currency: "KRW",
          amountMinor: "0.1",
          entryType: "MANUAL_ADJUSTMENT",
          idempotencyKey: "float",
          occurredAt: NOW,
        }),
      ).toThrow();
    } finally {
      database.close();
    }
  });

  it("fails health when a foreign-key violation exists", () => {
    const { database } = openMemoryRepository();
    try {
      database.pragma("foreign_keys = OFF");
      database
        .prepare(
          `INSERT INTO cash_ledger(
             id, account_id, currency, amount_minor, entry_type,
             idempotency_key, occurred_at, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "orphan-ledger",
          "missing-account",
          "KRW",
          "1000",
          "MANUAL_ADJUSTMENT",
          "orphan",
          NOW,
          NOW,
        );
      database.pragma("foreign_keys = ON");

      const health = inspectDatabaseHealth(database);
      expect(health.healthy).toBe(false);
      expect(health.message).toContain("foreignKeyViolations=1");
    } finally {
      database.close();
    }
  });

  it("fails health when an immutable trigger or migration checksum is altered", () => {
    const triggerDatabase = openMemoryRepository().database;
    try {
      triggerDatabase.exec("DROP TRIGGER cash_ledger_immutable_delete");
      const health = inspectDatabaseHealth(triggerDatabase);
      expect(health.healthy).toBe(false);
      expect(health.message).toContain("immutableTriggers=false");
    } finally {
      triggerDatabase.close();
    }

    const checksumDatabase = openMemoryRepository().database;
    try {
      checksumDatabase
        .prepare("UPDATE schema_version SET checksum = ? WHERE version = 1")
        .run("tampered");
      const health = inspectDatabaseHealth(checksumDatabase);
      expect(health.healthy).toBe(false);
      expect(health.message).toContain("migrationChecksums=false");
    } finally {
      checksumDatabase.close();
    }
  });
});
