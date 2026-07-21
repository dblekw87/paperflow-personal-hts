import { createHash } from "node:crypto";

import {
  MarketCalendarEventSchema,
  type MarketCalendarEvent,
} from "../contracts/market-calendar.js";
import { newYorkWallTimeToUtcInstant } from "./us-eastern-time.js";

export const BEA_RELEASE_SCHEDULE_URL = "https://www.bea.gov/news/schedule/";

type FetchLike = (
  input: string,
  init?: {
    readonly headers?: Record<string, string>;
    readonly signal?: AbortSignal;
  },
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  readonly text: () => Promise<string>;
}>;

const MONTH_INDEX: Readonly<Record<string, number>> = {
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sep: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11,
};

interface BeaReleaseRow {
  readonly month: string;
  readonly day: string;
  readonly time: string;
  readonly title: string;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#8211;|&ndash;|&#8212;|&mdash;/g, "-");
}

function htmlToText(value: string): string {
  return decodeHtml(value.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function extractYear(html: string): number {
  const match = /Year\s+(\d{4})/i.exec(htmlToText(html));
  return match ? Number(match[1]) : new Date().getUTCFullYear();
}

function extractBeaRows(html: string): readonly BeaReleaseRow[] {
  const tableRows = Array.from(html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi));
  const rows: BeaReleaseRow[] = [];
  for (const tableRow of tableRows) {
    const cells = Array.from(
      (tableRow[1] ?? "").matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi),
    ).map((cell) => htmlToText(cell[1] ?? ""));
    const joined = cells.join(" ");
    const match =
      /^([A-Za-z]+)\s+(\d{1,2})\s+(\d{1,2}:\d{2}\s+[AP]M)\s+(?:News|Data)?\s*(.+)$/i.exec(
        joined,
      );
    if (match) {
      rows.push({
        month: match[1]!,
        day: match[2]!,
        time: match[3]!,
        title: match[4]!,
      });
    }
  }
  if (rows.length > 0) return rows;
  return Array.from(
    htmlToText(html).matchAll(
      /([A-Za-z]+)\s+(\d{1,2})\s+(\d{1,2}:\d{2}\s+[AP]M)\s+(?:News|Data)\s+(.+?)(?=\s+[A-Za-z]+\s+\d{1,2}\s+\d{1,2}:\d{2}\s+[AP]M\s+(?:News|Data)|\s+To Be Announced|$)/gi,
    ),
  ).map((match) => ({
    month: match[1]!,
    day: match[2]!,
    time: match[3]!,
    title: match[4]!.trim(),
  }));
}

function parseTime(value: string): { readonly hour: number; readonly minute: number } {
  const match = /^(\d{1,2}):(\d{2})\s+([AP]M)$/i.exec(value);
  if (!match) throw new Error("BEA_INVALID_TIME");
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  if (match[3]!.toUpperCase() === "PM" && hour !== 12) hour += 12;
  if (match[3]!.toUpperCase() === "AM" && hour === 12) hour = 0;
  return { hour, minute };
}

function beaKind(title: string): MarketCalendarEvent["kind"] | null {
  const normalized = title.toLowerCase();
  if (normalized.includes("personal income and outlays")) return "PCE";
  if (normalized.includes("gross domestic product") || normalized.includes("gdp")) {
    return "GDP";
  }
  if (normalized.includes("international trade")) return "TRADE_BALANCE";
  return null;
}

function beaKoreanTitle(kind: MarketCalendarEvent["kind"], title: string): string {
  if (kind === "PCE") return "미국 PCE 및 개인소득 발표";
  if (kind === "GDP") return "미국 GDP 발표";
  if (kind === "TRADE_BALANCE") return "미국 무역수지 발표";
  return `미국 BEA 지표 발표 · ${title}`;
}

export function parseBeaReleaseScheduleHtml(
  html: string,
  obtainedAt: string,
  sourceUrl = BEA_RELEASE_SCHEDULE_URL,
): readonly MarketCalendarEvent[] {
  const year = extractYear(html);
  const hash = sha256(html);
  const evidenceId = `bea-release-schedule-${hash.slice(0, 16)}`;
  return extractBeaRows(html).flatMap((row) => {
    const monthIndex = MONTH_INDEX[row.month.toLowerCase()];
    const kind = beaKind(row.title);
    if (monthIndex === undefined || kind === null) return [];
    const day = Number(row.day);
    const { hour, minute } = parseTime(row.time);
    const localDate = `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const scheduledAt = newYorkWallTimeToUtcInstant({
      year,
      monthIndex,
      day,
      hour,
      minute,
    });
    return [
      MarketCalendarEventSchema.parse({
        id: `calendar-us-bea-${kind.toLowerCase()}-${localDate}-${sha256(row.title).slice(0, 10)}`,
        kind,
        marketScope: "GLOBAL",
        affectedMarkets: ["GLOBAL", "KR", "US"],
        instrumentIds: [],
        titleKo: beaKoreanTitle(kind, row.title),
        titleOriginal: row.title,
        scheduledAt,
        localDate,
        timezone: "America/New_York",
        status: Date.parse(scheduledAt) <= Date.parse(obtainedAt)
          ? "REPORTED"
          : "SCHEDULED",
        importance: kind === "GDP" || kind === "PCE" ? "CRITICAL" : "HIGH",
        provider: "US_BEA",
        sourceEventId: `bea-${localDate}-${sha256(row.title).slice(0, 16)}`,
        sourceUrl,
        dataQuality: "OFFICIAL",
        metrics: [],
        evidenceIds: [evidenceId],
        supersedesEventId: null,
        detectedAt: obtainedAt,
        updatedAt: obtainedAt,
        payloadVersion: 1,
      }),
    ];
  });
}

export class BeaReleaseScheduleClient {
  readonly #fetch: FetchLike;
  readonly #timeoutMs: number;

  public constructor(options: {
    readonly fetch?: FetchLike;
    readonly timeoutMs?: number;
  } = {}) {
    this.#fetch = options.fetch ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? 8_000;
  }

  public async getEvents(): Promise<readonly MarketCalendarEvent[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const response = await this.#fetch(BEA_RELEASE_SCHEDULE_URL, {
        headers: { Accept: "text/html" },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`BEA release schedule HTTP ${response.status}`);
      return parseBeaReleaseScheduleHtml(
        await response.text(),
        new Date().toISOString(),
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
