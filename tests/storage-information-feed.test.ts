import { createHash } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { openPaperTradingDatabase } from "../src/storage/database.js";
import { LocalInformationRepository } from "../src/storage/information-repository.js";

const openDatabases: Array<ReturnType<typeof openPaperTradingDatabase>> = [];

function openTestDatabase() {
  const opened = openPaperTradingDatabase({
    filename: ":memory:",
    now: () => "2026-07-20T10:00:00.000Z",
  });
  openDatabases.push(opened);
  return opened;
}

afterEach(() => {
  for (const opened of openDatabases.splice(0)) {
    opened.database.close();
  }
});

describe("LocalInformationRepository", () => {
  it("deduplicates immutable provider items and returns the latest translation", () => {
    const opened = openTestDatabase();
    expect(opened.schemaVersion).toBe(5);
    const repository = new LocalInformationRepository(
      opened.database,
      () => "2026-07-20T10:00:00.000Z",
    );
    const payloadHash = createHash("sha256").update("filing-v1").digest("hex");
    const item = {
      id: "sec:0000320193:0001",
      provider: "SEC_EDGAR" as const,
      providerItemId: "0000320193-26-000001",
      kind: "DISCLOSURE" as const,
      titleOriginal: "Current report",
      sourceName: "SEC EDGAR",
      sourceLanguage: "en",
      publishedAt: "2026-07-20T09:00:00.000Z",
      publishedAtPrecision: "SECOND" as const,
      obtainedAt: "2026-07-20T09:00:01.000Z",
      canonicalUrl:
        "https://www.sec.gov/Archives/edgar/data/320193/example-index.html",
      rights: "PUBLIC_FILING" as const,
      relatedInstrumentIds: ["NASDAQ:AAPL"],
      payloadHash,
    };
    expect(repository.ingest(item)).toBe(true);
    expect(repository.ingest(item)).toBe(false);
    expect(
      repository.addTranslation({
        id: "translation:sec:0001",
        informationItemId: item.id,
        locale: "ko-KR",
        inputHash: payloadHash,
        translatedTitle: "주요사항 보고서",
        translatedSummary: "공식 SEC 공시",
        translationProvider: "TEST_LOCAL",
        modelVersion: "fixture-v1",
        status: "COMPLETE",
        generatedAt: "2026-07-20T09:01:00.000Z",
      }),
    ).toBe(true);

    expect(repository.listRecent({ kind: "DISCLOSURE" })[0]).toMatchObject({
      provider: "SEC_EDGAR",
      translatedTitle: "주요사항 보고서",
      relatedInstrumentIds: ["NASDAQ:AAPL"],
    });
    expect(() =>
      opened.database
        .prepare("UPDATE information_items SET title_original = ? WHERE id = ?")
        .run("changed", item.id),
    ).toThrow("information_items is immutable");
    const mismatchedHash = createHash("sha256")
      .update("filing-v2")
      .digest("hex");
    expect(() =>
      repository.addTranslation({
        id: "translation:sec:wrong-version",
        informationItemId: item.id,
        locale: "ko-KR",
        inputHash: mismatchedHash,
        translatedTitle: "다른 원문용 번역",
        translationProvider: "TEST_LOCAL",
        modelVersion: "fixture-v2",
        status: "PARTIAL",
        generatedAt: "2026-07-20T09:02:00.000Z",
      }),
    ).toThrow("Translation input hash does not match source payload");
  });

  it("stores provider checkpoints separately from immutable items", () => {
    const opened = openTestDatabase();
    const repository = new LocalInformationRepository(opened.database);
    repository.saveCheckpoint(
      "SEC_EDGAR",
      { lastAccession: "0000320193-26-000001" },
      "2026-07-20T09:05:00.000Z",
    );
    repository.saveCheckpoint(
      "SEC_EDGAR",
      { lastAccession: "0000320193-26-000002" },
      "2026-07-20T09:06:00.000Z",
    );
    const row = opened.database
      .prepare(
        "SELECT cursor_json, last_success_at FROM information_poll_checkpoints WHERE provider = ?",
      )
      .get("SEC_EDGAR") as {
      cursor_json: string;
      last_success_at: string;
    };
    expect(JSON.parse(row.cursor_json)).toEqual({
      lastAccession: "0000320193-26-000002",
    });
    expect(row.last_success_at).toBe("2026-07-20T09:06:00.000Z");
  });
});
