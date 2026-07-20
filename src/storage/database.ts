import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import Database from "better-sqlite3";

import { applyMigrations } from "./migrations.js";

export const DATABASE_FILENAME = "papertrading.sqlite3";
export const DEFAULT_BUSY_TIMEOUT_MS = 5_000;

export interface OpenDatabaseOptions {
  readonly filename: string;
  readonly busyTimeoutMs?: number;
  readonly now?: () => string;
}

export interface OpenDatabaseResult {
  readonly database: Database.Database;
  readonly schemaVersion: number;
  readonly filename: string;
}

export function databasePathFromUserData(userDataPath: string): string {
  if (userDataPath.trim().length === 0) {
    throw new Error("Electron userData path must not be empty");
  }
  return join(resolve(userDataPath), "storage", DATABASE_FILENAME);
}

/**
 * Electron main passes `app.getPath("userData")` into this function.
 * This module intentionally has no Electron import so it also works in tests and CLI tools.
 */
export function openUserDataDatabase(
  userDataPath: string,
  options?: Omit<OpenDatabaseOptions, "filename">,
): OpenDatabaseResult {
  return openPaperTradingDatabase({
    filename: databasePathFromUserData(userDataPath),
    ...options,
  });
}

export function openPaperTradingDatabase(
  options: OpenDatabaseOptions,
): OpenDatabaseResult {
  const filename =
    options.filename === ":memory:"
      ? options.filename
      : resolve(options.filename);
  if (filename !== ":memory:") {
    mkdirSync(dirname(filename), { recursive: true });
  }

  const database = new Database(filename);
  try {
    database.pragma("foreign_keys = ON");
    database.pragma(
      `busy_timeout = ${options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS}`,
    );
    if (filename !== ":memory:") {
      const mode = database.pragma("journal_mode = WAL", { simple: true });
      if (String(mode).toLowerCase() !== "wal") {
        throw new Error(`SQLite refused WAL mode: ${String(mode)}`);
      }
    }
    database.pragma("synchronous = NORMAL");

    const schemaVersion = applyMigrations(
      database,
      options.now ?? (() => new Date().toISOString()),
    );
    return { database, schemaVersion, filename };
  } catch (error) {
    database.close();
    throw error;
  }
}
