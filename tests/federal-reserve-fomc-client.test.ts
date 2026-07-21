import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  FederalReserveFomcCalendarClient,
  FEDERAL_RESERVE_FOMC_CALENDAR_URL,
  parseFederalReserveFomcCalendarHtml,
} from "../src/calendar/federal-reserve-fomc-client.js";
import { openUserDataDatabase } from "../src/storage/database.js";
import { LocalMarketCalendarRepository } from "../src/storage/market-calendar-repository.js";

const FED_FIXTURE = `
  <h4>2026 FOMC Meetings</h4>
  <p>January</p>
  <p>27-28</p>
  <p>Statement: <a href="/monetarypolicy/fomcstatements.htm">HTML</a></p>
  <p>March</p>
  <p>17-18*</p>
  <p>Projection Materials</p>
  <p>Apr/May</p>
  <p>30-1</p>
  <p>December</p>
  <p>8-9*</p>
  <p>* Meeting associated with a Summary of Economic Projections.</p>
`;

describe("FederalReserveFomcCalendarClient", () => {
  it("normalizes Federal Reserve FOMC meeting dates into market calendar events", () => {
    const events = parseFederalReserveFomcCalendarHtml(
      FED_FIXTURE,
      "2026-01-01T00:00:00.000Z",
    );
    expect(events.map((event) => event.localDate)).toEqual([
      "2026-01-28",
      "2026-03-18",
      "2026-05-01",
      "2026-12-09",
    ]);
    expect(events[0]).toMatchObject({
      kind: "FOMC",
      marketScope: "GLOBAL",
      affectedMarkets: ["GLOBAL", "KR", "US"],
      provider: "US_FEDERAL_RESERVE",
      dataQuality: "OFFICIAL",
      timezone: "America/New_York",
      sourceUrl: FEDERAL_RESERVE_FOMC_CALENDAR_URL,
    });
    expect(events[1]?.titleKo).toContain("경제전망");
    expect(events[0]?.scheduledAt).toBe("2026-01-28T19:00:00.000Z");
    expect(events[1]?.scheduledAt).toBe("2026-03-18T18:00:00.000Z");
  });

  it("fetches official HTML and can ingest deduplicated events into SQLite", async () => {
    const client = new FederalReserveFomcCalendarClient({
      fetch: async () => ({
        ok: true,
        status: 200,
        text: async () => FED_FIXTURE,
      }),
    });
    const events = await client.getEvents();
    const userDataPath = mkdtempSync(join(tmpdir(), "fomc-calendar-"));
    try {
      const { database } = openUserDataDatabase(userDataPath);
      try {
        const repository = new LocalMarketCalendarRepository(database);
        expect(repository.ingest(events[0]!)).toBe(true);
        expect(repository.ingest(events[0]!)).toBe(false);
        const stored = repository.listRange({
          dateFrom: "2026-01-01",
          dateTo: "2026-12-31",
          markets: ["GLOBAL"],
        });
        expect(stored).toHaveLength(1);
        expect(stored[0]?.sourceEventId).toBe("fomc-2026-01-28");
      } finally {
        database.close();
      }
    } finally {
      rmSync(userDataPath, { recursive: true, force: true });
    }
  });
});
