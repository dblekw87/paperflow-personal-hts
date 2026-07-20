import { join, resolve } from "node:path";

import { openUserDataDatabase } from "../storage/database.js";
import { inspectDatabaseHealth } from "../storage/health.js";

function readUserDataPath(arguments_: readonly string[]): string {
  const index = arguments_.indexOf("--user-data");
  if (index >= 0) {
    const value = arguments_[index + 1];
    if (value === undefined || value.trim().length === 0) {
      throw new Error("--user-data requires a directory path");
    }
    return resolve(value);
  }
  return resolve(
    process.env.PAPERTRADING_USER_DATA_DIR ?? join(process.cwd(), "data"),
  );
}

try {
  const userDataPath = readUserDataPath(process.argv.slice(2));
  const opened = openUserDataDatabase(userDataPath);
  const health = inspectDatabaseHealth(opened.database);
  opened.database.close();
  console.log(
    JSON.stringify(
      {
        initialized: health.healthy,
        database: opened.filename,
        schemaVersion: health.schemaVersion,
        healthCode: health.code,
      },
      null,
      2,
    ),
  );
  process.exitCode = health.healthy ? 0 : 1;
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Database initialization failed",
  );
  process.exitCode = 1;
}
