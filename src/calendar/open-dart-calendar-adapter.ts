import { createHash } from "node:crypto";

import {
  MarketCalendarEventSchema,
  type MarketCalendarEvent,
} from "../contracts/market-calendar.js";
import type { OpenDartFiling } from "../disclosures/open-dart-client.js";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function openDartDateInstant(providerDate: string): string {
  return new Date(
    `${providerDate.slice(0, 4)}-${providerDate.slice(4, 6)}-${providerDate.slice(6, 8)}T00:00:00+09:00`,
  ).toISOString();
}

function openDartKind(reportName: string): MarketCalendarEvent["kind"] {
  if (/유상증자|증자결정/.test(reportName)) return "CAPITAL_INCREASE";
  if (/무상증자/.test(reportName)) return "BONUS_ISSUE";
  if (/주식분할|액면분할/.test(reportName)) return "STOCK_SPLIT";
  if (/주식병합|액면병합/.test(reportName)) return "REVERSE_SPLIT";
  if (/자기주식|자사주/.test(reportName)) return "BUYBACK";
  if (/합병|영업양수|영업양도|중요한자산양수|중요한자산양도|분할/.test(reportName)) {
    return "MERGER_ACQUISITION";
  }
  if (/공개매수/.test(reportName)) return "TENDER_OFFER";
  if (/증권신고서/.test(reportName)) return "IPO";
  if (/주주총회/.test(reportName)) return "SHAREHOLDER_MEETING";
  return "OTHER_CORPORATE";
}

function importance(kind: MarketCalendarEvent["kind"]): MarketCalendarEvent["importance"] {
  if (
    kind === "CAPITAL_INCREASE" ||
    kind === "MERGER_ACQUISITION" ||
    kind === "TENDER_OFFER" ||
    kind === "IPO"
  ) {
    return "HIGH";
  }
  return kind === "OTHER_CORPORATE" ? "MEDIUM" : "HIGH";
}

export function openDartFilingToCalendarEvent(input: {
  readonly filing: OpenDartFiling;
  readonly stockCode: string | null;
  readonly obtainedAt: string;
}): MarketCalendarEvent {
  const kind = openDartKind(input.filing.reportName);
  const localDate = `${input.filing.providerFiledDate.slice(0, 4)}-${input.filing.providerFiledDate.slice(4, 6)}-${input.filing.providerFiledDate.slice(6, 8)}`;
  const sourceUrl = `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${input.filing.providerFilingId}`;
  const evidenceId = `open-dart-${input.filing.providerFilingId}`;
  return MarketCalendarEventSchema.parse({
    id: `calendar-kr-opendart-${input.filing.providerFilingId}`,
    kind,
    marketScope: "KR",
    affectedMarkets: ["KR"],
    instrumentIds: input.stockCode === null ? [] : [`KRX:${input.stockCode}`],
    titleKo: `${input.filing.reportName} · ${input.filing.corpName}`,
    titleOriginal: `${input.filing.reportName} · ${input.filing.corpName}`,
    scheduledAt: openDartDateInstant(input.filing.providerFiledDate),
    localDate,
    timezone: "Asia/Seoul",
    status: "REPORTED",
    importance: importance(kind),
    provider: "OPEN_DART",
    sourceEventId: input.filing.providerFilingId,
    sourceUrl,
    dataQuality: "ISSUER_PRIMARY",
    metrics: [],
    evidenceIds: [evidenceId],
    supersedesEventId: null,
    detectedAt: input.obtainedAt,
    updatedAt: input.obtainedAt,
    payloadVersion: 1,
  });
}

export function openDartFilingsToCalendarEvents(input: {
  readonly filings: readonly OpenDartFiling[];
  readonly stockCodeByCorpCode?: ReadonlyMap<string, string | null>;
  readonly obtainedAt: string;
}): readonly MarketCalendarEvent[] {
  return input.filings.map((filing) =>
    openDartFilingToCalendarEvent({
      filing,
      stockCode:
        filing.stockCode ??
        input.stockCodeByCorpCode?.get(filing.corpCode) ??
        null,
      obtainedAt: input.obtainedAt,
    }),
  );
}

export function openDartCalendarPayloadHash(event: MarketCalendarEvent): string {
  return sha256(JSON.stringify(event));
}
