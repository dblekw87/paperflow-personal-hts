import { createHash } from "node:crypto";

import {
  MarketCalendarEventSchema,
  type MarketCalendarEvent,
} from "../contracts/market-calendar.js";

export const KIND_LISTING_COMPANY_URL =
  "https://kind.krx.co.kr/listinvstg/listingcompany.do";

type FetchLike = (
  input: URL,
  init?: {
    readonly method?: string;
    readonly headers?: Record<string, string>;
    readonly body?: string;
    readonly signal?: AbortSignal;
  },
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  readonly arrayBuffer: () => Promise<ArrayBuffer>;
}>;

export interface KindListingScheduleItem {
  readonly providerItemId: string;
  readonly companyName: string;
  readonly listingDate: string;
  readonly listingType: string;
  readonly securityGroup: string | null;
  readonly industry: string | null;
  readonly country: string | null;
  readonly advisor: string | null;
  readonly raw: Record<string, string>;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function cleanCell(value: string): string {
  return decodeHtmlEntities(value)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeHeader(value: string): string {
  return value.replace(/[\/\s]/g, "");
}

function normalizeDate(value: string): string | null {
  const match = /(\d{4})[.-](\d{2})[.-](\d{2})/.exec(value);
  if (match === null) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function seoulStartInstant(localDate: string): string {
  return new Date(`${localDate}T00:00:00+09:00`).toISOString();
}

function rowsFromHtmlTable(html: string): readonly string[][] {
  return Array.from(html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)).map(
    (rowMatch) =>
      Array.from(
        rowMatch[1]?.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi) ?? [],
      ).map((cellMatch) => cleanCell(cellMatch[1] ?? "")),
  );
}

interface KindListingHeaderIndexes {
  readonly companyName: number;
  readonly listingDate: number;
  readonly listingType: number;
  readonly securityGroup: number;
  readonly industry: number;
  readonly country: number;
  readonly advisor: number;
}

function indexByHeader(headers: readonly string[]): KindListingHeaderIndexes {
  const normalized = headers.map(normalizeHeader);
  const find = (...candidates: readonly string[]): number => {
    for (const candidate of candidates) {
      const index = normalized.findIndex((header) => header.includes(candidate));
      if (index >= 0) return index;
    }
    return -1;
  };
  return {
    companyName: find("회사명", "기업명"),
    listingDate: find("상장일"),
    listingType: find("상장유형"),
    securityGroup: find("증권구분"),
    industry: find("업종"),
    country: find("국적"),
    advisor: find("상장주선인지정자문인", "상장주선인", "지정자문인"),
  };
}

function valueAt(cells: readonly string[], index: number): string | null {
  return index >= 0 && cells[index] ? cells[index] : null;
}

export function parseKindListingScheduleHtml(
  html: string,
): readonly KindListingScheduleItem[] {
  const rows = rowsFromHtmlTable(html).filter((row) => row.length > 0);
  const headerIndex = rows.findIndex((row) =>
    row.some((cell) => normalizeHeader(cell).includes("상장일")),
  );
  const headers =
    headerIndex >= 0
      ? rows[headerIndex] ?? []
      : ["회사명", "상장일", "상장유형", "증권구분", "업종", "국적", "상장주선인"];
  const indexes = indexByHeader(headers);
  const dataRows = rows.slice(headerIndex >= 0 ? headerIndex + 1 : 0);
  return dataRows.flatMap((cells) => {
    const listingDate = normalizeDate(valueAt(cells, indexes.listingDate) ?? "");
    const companyName = valueAt(cells, indexes.companyName);
    const listingType = valueAt(cells, indexes.listingType);
    if (listingDate === null || companyName === null || listingType === null) {
      return [];
    }
    const raw = Object.fromEntries(
      headers.map((header, index) => [header || `column${index + 1}`, cells[index] ?? ""]),
    );
    const providerItemId = sha256(
      JSON.stringify({ companyName, listingDate, listingType, raw }),
    ).slice(0, 32);
    return [
      {
        providerItemId,
        companyName,
        listingDate,
        listingType,
        securityGroup: valueAt(cells, indexes.securityGroup),
        industry: valueAt(cells, indexes.industry),
        country: valueAt(cells, indexes.country),
        advisor: valueAt(cells, indexes.advisor),
        raw,
      },
    ];
  });
}

function kindFromListingType(listingType: string): MarketCalendarEvent["kind"] {
  if (/상장폐지|폐지/.test(listingType)) return "DELISTING";
  if (/신규상장|이전상장|재상장/.test(listingType)) return "NEW_LISTING";
  return "OTHER_MARKET_STRUCTURE";
}

export function kindListingItemsToCalendarEvents(input: {
  readonly items: readonly KindListingScheduleItem[];
  readonly obtainedAt: string;
  readonly sourceUrl?: string;
}): readonly MarketCalendarEvent[] {
  return input.items.map((item) => {
    const kind = kindFromListingType(item.listingType);
    const detail = [
      item.securityGroup,
      item.industry,
      item.advisor ? `주관 ${item.advisor}` : null,
    ].filter((value): value is string => value !== null && value.length > 0);
    return MarketCalendarEventSchema.parse({
      id: `calendar-kr-kind-listing-${item.providerItemId}`,
      kind,
      marketScope: "KR",
      affectedMarkets: ["KR"],
      instrumentIds: [],
      titleKo: `${item.companyName} ${item.listingType}`,
      titleOriginal: `${item.companyName} ${item.listingType}`,
      scheduledAt: seoulStartInstant(item.listingDate),
      localDate: item.listingDate,
      timezone: "Asia/Seoul",
      status: Date.parse(seoulStartInstant(item.listingDate)) <= Date.parse(input.obtainedAt)
        ? "CONFIRMED"
        : "SCHEDULED",
      importance: kind === "NEW_LISTING" ? "HIGH" : "MEDIUM",
      provider: "KIND_KRX",
      sourceEventId: item.providerItemId,
      sourceUrl:
        input.sourceUrl ??
        "https://kind.krx.co.kr/listinvstg/listingcompany.do?method=searchListingTypeMain",
      dataQuality: "REGULATOR_EXCHANGE",
      metrics: detail.length > 0
        ? [
            {
              name: "OTHER",
              value: "0",
              unit: detail.join(" · "),
              currency: null,
              evidenceId: `kind-listing-${item.providerItemId}`,
            },
          ]
        : [],
      evidenceIds: [`kind-listing-${item.providerItemId}`],
      supersedesEventId: null,
      detectedAt: input.obtainedAt,
      updatedAt: input.obtainedAt,
      payloadVersion: 1,
    });
  });
}

function buildKindListingPayload(input: {
  readonly fromDate: string;
  readonly toDate: string;
  readonly rows?: number;
}): URLSearchParams {
  const payload = new URLSearchParams();
  payload.set("method", "searchListingTypeSub");
  payload.set("currentPageSize", String(input.rows ?? 3000));
  payload.set("pageIndex", "1");
  payload.set("orderMode", "1");
  payload.set("orderStat", "D");
  payload.set("repIsuSrtCd", "");
  payload.set("isurCd", "");
  payload.set("forward", "listingtype_down");
  payload.set("listTypeArrStr", "01|02|03|04|05|");
  payload.set("choicTypeArrStr", "");
  payload.set("searchCodeType", "");
  payload.set("searchCorpName", "");
  payload.set("secuGrpArrStr", "0|ST|FS|MF|SC|RT|IF|DR|");
  payload.set("marketType", "");
  payload.set("searchCorpNameTmp", "");
  payload.set("country", "");
  payload.set("industry", "");
  payload.set("repMajAgntDesignAdvserComp", "");
  payload.set("repMajAgntComp", "");
  payload.set("designAdvserComp", "");
  for (const value of ["0", "ST|FS", "MF|SC|RT|IF", "DR"]) {
    payload.append("secuGrpArr", value);
  }
  for (const value of ["01", "02", "03", "04", "05"]) {
    payload.append("listTypeArr", value);
  }
  payload.set("fromDate", input.fromDate);
  payload.set("toDate", input.toDate);
  return payload;
}

export class KindListingScheduleClient {
  readonly #fetch: FetchLike;
  readonly #timeoutMs: number;

  public constructor(options: {
    readonly fetch?: FetchLike;
    readonly timeoutMs?: number;
  } = {}) {
    this.#fetch = options.fetch ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? 8_000;
  }

  public async getEvents(input: {
    readonly fromDate: string;
    readonly toDate: string;
    readonly rows?: number;
  }): Promise<readonly MarketCalendarEvent[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
    const url = new URL(KIND_LISTING_COMPANY_URL);
    try {
      const response = await this.#fetch(url, {
        method: "POST",
        headers: {
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Content-Type": "application/x-www-form-urlencoded",
          Origin: "https://kind.krx.co.kr",
          Referer:
            "https://kind.krx.co.kr/listinvstg/listingcompany.do?method=searchListingTypeMain",
        },
        body: buildKindListingPayload(input).toString(),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`KIND listing schedule HTTP ${response.status}`);
      }
      const html = new TextDecoder("euc-kr", { fatal: false }).decode(
        await response.arrayBuffer(),
      );
      const obtainedAt = new Date().toISOString();
      return kindListingItemsToCalendarEvents({
        items: parseKindListingScheduleHtml(html),
        obtainedAt,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}
