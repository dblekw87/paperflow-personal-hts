import { describe, expect, it } from "vitest";

import {
  BLS_RELEASE_ICS_URL,
  parseBlsReleaseCalendarIcs,
} from "../src/calendar/bls-release-calendar-client.js";
import {
  BEA_RELEASE_SCHEDULE_URL,
  parseBeaReleaseScheduleHtml,
} from "../src/calendar/bea-release-schedule-client.js";
import {
  ksdRightsItemsToCalendarEvents,
  parseKsdRightsScheduleResponse,
} from "../src/calendar/ksd-rights-schedule-client.js";
import {
  kindListingItemsToCalendarEvents,
  parseKindListingScheduleHtml,
} from "../src/calendar/kind-listing-schedule-client.js";
import { openDartFilingsToCalendarEvents } from "../src/calendar/open-dart-calendar-adapter.js";
import type { OpenDartFiling } from "../src/disclosures/open-dart-client.js";

const BLS_ICS_FIXTURE = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:cpi-20260714@bls.gov
DTSTART;TZID=America/New_York:20260714T083000
SUMMARY:Consumer Price Index for June 2026
URL:https://www.bls.gov/schedule/2026/home.htm
END:VEVENT
BEGIN:VEVENT
UID:ppi-20260715@bls.gov
DTSTART;TZID=America/New_York:20260715T083000
SUMMARY:Producer Price Index for June 2026
END:VEVENT
BEGIN:VEVENT
UID:holiday@bls.gov
DTSTART;VALUE=DATE:20260703
SUMMARY:Independence Day
END:VEVENT
END:VCALENDAR`;

const BEA_HTML_FIXTURE = `
  <h1>Release Schedule</h1>
  <div>Year 2026</div>
  <table>
    <tr><th>Date</th><th>Type</th><th>Release</th></tr>
    <tr><td>July 30 8:30 AM</td><td>News</td><td>GDP (Advance Estimate), 2nd Quarter 2026</td></tr>
    <tr><td>July 30 8:30 AM</td><td>News</td><td>Personal Income and Outlays, June 2026</td></tr>
    <tr><td>August 4 8:30 AM</td><td>News</td><td>U.S. International Trade in Goods and Services, June 2026</td></tr>
  </table>
`;

const KIND_LISTING_HTML_FIXTURE = `
  <html><body>
    <table>
      <tr>
        <th>회사명</th><th>상장일</th><th>상장유형</th><th>증권구분</th>
        <th>업종</th><th>국적</th><th>상장주선인/<br>지정자문인</th>
      </tr>
      <tr>
        <td><img alt="코스닥"> 매드업</td><td>2026-07-01</td><td>신규상장</td>
        <td>주권</td><td>광고업</td><td>대한민국</td><td>미래에셋증권 주식회사</td>
      </tr>
      <tr>
        <td>한국제16호스팩</td><td>2026-06-30</td><td>이전상장</td>
        <td>주권</td><td>금융 지원 서비스업</td><td>대한민국</td><td>한국투자증권(주)</td>
      </tr>
    </table>
  </body></html>
`;

function dartFiling(overrides: Partial<OpenDartFiling> = {}): OpenDartFiling {
  return {
    providerFilingId: "20260722000001",
    corpCode: "00126380",
    corpName: "삼성전자",
    stockCode: "005930",
    corpClass: "Y",
    reportName: "주요사항보고서(유상증자결정)",
    filerName: "삼성전자",
    providerFiledDate: "20260722",
    providerFiledAtPrecision: "DATE",
    remarks: null,
    ...overrides,
  };
}

describe("market calendar provider adapters", () => {
  it("normalizes BLS release calendar ICS into high-impact macro events", () => {
    const events = parseBlsReleaseCalendarIcs(
      BLS_ICS_FIXTURE,
      "2026-07-01T00:00:00.000Z",
    );
    expect(events.map((event) => event.kind)).toEqual(["CPI", "PPI"]);
    expect(events[0]).toMatchObject({
      provider: "US_BLS",
      sourceUrl: "https://www.bls.gov/schedule/2026/home.htm",
      scheduledAt: "2026-07-14T12:30:00.000Z",
      localDate: "2026-07-14",
      dataQuality: "OFFICIAL",
    });
    expect(events[1]?.sourceUrl).toBe(BLS_RELEASE_ICS_URL);
  });

  it("normalizes BEA release schedule HTML into GDP, PCE, and trade events", () => {
    const events = parseBeaReleaseScheduleHtml(
      BEA_HTML_FIXTURE,
      "2026-07-01T00:00:00.000Z",
    );
    expect(events.map((event) => event.kind)).toEqual([
      "GDP",
      "PCE",
      "TRADE_BALANCE",
    ]);
    expect(events[0]).toMatchObject({
      provider: "US_BEA",
      sourceUrl: BEA_RELEASE_SCHEDULE_URL,
      scheduledAt: "2026-07-30T12:30:00.000Z",
      importance: "CRITICAL",
    });
  });

  it("maps OpenDART filings into domestic corporate calendar events", () => {
    const events = openDartFilingsToCalendarEvents({
      filings: [
        dartFiling(),
        dartFiling({
          providerFilingId: "20260722000002",
          reportName: "주요사항보고서(회사합병결정)",
        }),
      ],
      obtainedAt: "2026-07-22T00:00:00.000Z",
    });
    expect(events.map((event) => event.kind)).toEqual([
      "CAPITAL_INCREASE",
      "MERGER_ACQUISITION",
    ]);
    expect(events[0]).toMatchObject({
      marketScope: "KR",
      affectedMarkets: ["KR"],
      instrumentIds: ["KRX:005930"],
      provider: "OPEN_DART",
      dataQuality: "ISSUER_PRIMARY",
      localDate: "2026-07-22",
    });
  });

  it("normalizes KSD-linked public stock rights schedules with non-commercial data quality", () => {
    const items = parseKsdRightsScheduleResponse({
      response: {
        header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
        body: {
          items: {
            item: [
              {
                basDt: "20260722",
                stckIssuCmpyNm: "삼성전자",
                srtnCd: "005930",
                righExerReasNm: "현금배당",
                stckBasDt: "20260731",
              },
              {
                basDt: "20260722",
                stckIssuCmpyNm: "테스트기업",
                srtnCd: "123456",
                righExerReasNm: "유상증자",
                righExerStrtDt: "20260801",
              },
            ],
          },
        },
      },
    });
    const events = ksdRightsItemsToCalendarEvents({
      items,
      obtainedAt: "2026-07-22T00:00:00.000Z",
    });
    expect(events.map((event) => event.kind)).toEqual([
      "DIVIDEND_RECORD_DATE",
      "CAPITAL_INCREASE",
    ]);
    expect(events[0]).toMatchObject({
      provider: "KSD_RIGHTS_SCHEDULE",
      dataQuality: "DELAYED",
      instrumentIds: ["KRX:005930"],
      localDate: "2026-07-31",
      sourceUrl: "https://www.data.go.kr/data/15059609/openapi.do",
    });
  });

  it("normalizes KIND listing company Excel HTML into domestic listing events", () => {
    const items = parseKindListingScheduleHtml(KIND_LISTING_HTML_FIXTURE);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      companyName: "매드업",
      listingDate: "2026-07-01",
      listingType: "신규상장",
      advisor: "미래에셋증권 주식회사",
    });
    const events = kindListingItemsToCalendarEvents({
      items,
      obtainedAt: "2026-07-22T00:00:00.000Z",
    });
    expect(events.map((event) => event.kind)).toEqual([
      "NEW_LISTING",
      "NEW_LISTING",
    ]);
    expect(events[0]).toMatchObject({
      provider: "KIND_KRX",
      dataQuality: "REGULATOR_EXCHANGE",
      marketScope: "KR",
      affectedMarkets: ["KR"],
      localDate: "2026-07-01",
      titleKo: "매드업 신규상장",
    });
  });
});
