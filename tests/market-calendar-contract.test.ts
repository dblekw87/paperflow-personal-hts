import { describe, expect, it } from "vitest";

import {
  filterMarketCalendarEventsForInstrument,
  inferMarketCalendarRegion,
  MarketCalendarFeedSchema,
  type MarketCalendarEvent,
} from "../src/contracts/market-calendar.js";

const hash = "a".repeat(64);

function event(overrides: Partial<MarketCalendarEvent> = {}): MarketCalendarEvent {
  return {
    id: "calendar-event-us-cpi-1",
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
    importance: "HIGH",
    provider: "US_BLS",
    sourceEventId: "bls-cpi-2026-08",
    sourceUrl: "https://www.bls.gov/schedule/",
    dataQuality: "OFFICIAL",
    metrics: [],
    evidenceIds: ["evidence-bls-cpi"],
    supersedesEventId: null,
    detectedAt: "2026-07-22T00:00:00.000Z",
    updatedAt: "2026-07-22T00:00:00.000Z",
    payloadVersion: 1,
    ...overrides,
  };
}

describe("market calendar contract", () => {
  it("requires every calendar event to reference known evidence", () => {
    expect(() =>
      MarketCalendarFeedSchema.parse({
        generatedAt: "2026-07-22T00:00:00.000Z",
        events: [event()],
        evidence: [],
      }),
    ).toThrow(/Unknown calendar evidence/);
  });

  it("keeps KIS news calendar items headline-only", () => {
    expect(() =>
      MarketCalendarFeedSchema.parse({
        generatedAt: "2026-07-22T00:00:00.000Z",
        events: [
          event({
            id: "calendar-event-kis-headline",
            kind: "OTHER_CORPORATE",
            marketScope: "US",
            affectedMarkets: ["US"],
            provider: "KIS_NEWS_HEADLINE",
            sourceEventId: "kis-news-1",
            dataQuality: "OFFICIAL",
            evidenceIds: ["evidence-kis-news"],
          }),
        ],
        evidence: [
          {
            id: "evidence-kis-news",
            provider: "KIS_NEWS_HEADLINE",
            sourceDocumentId: "kis-news-1",
            canonicalUrl: null,
            documentHash: hash,
            rights: "KIS_CONTRACT",
            headlineOnly: true,
            publishedAt: "2026-07-22T00:00:00.000Z",
            obtainedAt: "2026-07-22T00:00:01.000Z",
            detectedAt: "2026-07-22T00:00:02.000Z",
          },
        ],
      }),
    ).toThrow(/KIS news calendar events must remain headline-only/);
  });

  it("filters the workspace calendar by domestic and US instrument markets", () => {
    const events = [
      event({
        id: "calendar-event-kr-dividend",
        kind: "EX_DIVIDEND",
        marketScope: "KR",
        affectedMarkets: ["KR"],
        instrumentIds: ["KRX:005930"],
        provider: "KSD_RIGHTS_SCHEDULE",
        sourceEventId: "ksd-rights-1",
      }),
      event({
        id: "calendar-event-us-earnings",
        kind: "EARNINGS",
        marketScope: "US",
        affectedMarkets: ["US"],
        instrumentIds: ["NASDAQ:AAPL"],
        provider: "SEC_EDGAR",
        sourceEventId: "sec-earnings-1",
      }),
      event(),
    ];

    expect(inferMarketCalendarRegion("KRX:005930")).toBe("KR");
    expect(inferMarketCalendarRegion("NASDAQ:AAPL")).toBe("US");
    expect(
      filterMarketCalendarEventsForInstrument(events, "KRX:005930").map(
        (item) => item.id,
      ),
    ).toEqual(["calendar-event-kr-dividend", "calendar-event-us-cpi-1"]);
    expect(
      filterMarketCalendarEventsForInstrument(events, "NASDAQ:AAPL").map(
        (item) => item.id,
      ),
    ).toEqual(["calendar-event-us-earnings", "calendar-event-us-cpi-1"]);
  });
});
