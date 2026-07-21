import { describe, expect, it } from "vitest";

import type { MarketCalendarEvent } from "../src/contracts/market-calendar.js";
import { openPaperTradingDatabase } from "../src/storage/database.js";
import { LocalMarketCalendarRepository } from "../src/storage/market-calendar-repository.js";

const NOW = "2026-07-22T00:00:00.000Z";

function calendarEvent(
  overrides: Partial<MarketCalendarEvent> = {},
): MarketCalendarEvent {
  return {
    id: "calendar-global-us-cpi-2026-08",
    kind: "CPI",
    marketScope: "GLOBAL",
    affectedMarkets: ["GLOBAL", "KR", "US"],
    instrumentIds: [],
    titleKo: "미국 CPI 발표",
    titleOriginal: "Consumer Price Index",
    scheduledAt: "2026-08-12T12:30:00.000Z",
    localDate: "2026-08-12",
    timezone: "America/New_York",
    status: "SCHEDULED",
    importance: "CRITICAL",
    provider: "US_BLS",
    sourceEventId: "bls-cpi-2026-08",
    sourceUrl: "https://www.bls.gov/schedule/",
    dataQuality: "OFFICIAL",
    metrics: [],
    evidenceIds: ["evidence-bls-cpi"],
    supersedesEventId: null,
    detectedAt: NOW,
    updatedAt: NOW,
    payloadVersion: 1,
    ...overrides,
  };
}

describe("market calendar SQLite persistence", () => {
  it("deduplicates provider event identity and lists events by market", () => {
    const opened = openPaperTradingDatabase({
      filename: ":memory:",
      now: () => NOW,
    });
    const repository = new LocalMarketCalendarRepository(
      opened.database,
      () => NOW,
    );
    try {
      expect(repository.ingest(calendarEvent())).toBe(true);
      expect(repository.ingest(calendarEvent({ id: "same-provider-copy" }))).toBe(false);
      repository.ingest(
        calendarEvent({
          id: "calendar-kr-exdiv-005930",
          kind: "EX_DIVIDEND",
          marketScope: "KR",
          affectedMarkets: ["KR"],
          instrumentIds: ["KRX:005930"],
          titleKo: "삼성전자 권리락",
          titleOriginal: null,
          scheduledAt: "2026-08-13T00:00:00.000Z",
          localDate: "2026-08-13",
          timezone: "Asia/Seoul",
          provider: "KSD_RIGHTS_SCHEDULE",
          sourceEventId: "ksd-005930-exdiv",
          sourceUrl: null,
          dataQuality: "DELAYED",
          importance: "MEDIUM",
          evidenceIds: ["evidence-ksd-rights"],
        }),
      );

      expect(
        repository
          .listRange({
            dateFrom: "2026-08-01",
            dateTo: "2026-08-31",
            markets: ["US"],
          })
          .map((event) => event.id),
      ).toEqual(["calendar-global-us-cpi-2026-08"]);
      expect(
        repository
          .listRange({
            dateFrom: "2026-08-01",
            dateTo: "2026-08-31",
            markets: ["KR"],
          })
          .map((event) => event.id),
      ).toEqual([
        "calendar-global-us-cpi-2026-08",
        "calendar-kr-exdiv-005930",
      ]);
    } finally {
      opened.database.close();
    }
  });

  it("keeps market calendar event rows immutable", () => {
    const opened = openPaperTradingDatabase({
      filename: ":memory:",
      now: () => NOW,
    });
    const repository = new LocalMarketCalendarRepository(
      opened.database,
      () => NOW,
    );
    try {
      repository.ingest(calendarEvent());
      expect(() =>
        opened.database
          .prepare("UPDATE market_calendar_events SET title_ko = ?")
          .run("변경"),
      ).toThrow(/market_calendar_events is immutable/);
      expect(() =>
        opened.database.prepare("DELETE FROM market_calendar_events").run(),
      ).toThrow(/market_calendar_events is immutable/);
    } finally {
      opened.database.close();
    }
  });
});
