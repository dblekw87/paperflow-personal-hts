import { createHash } from "node:crypto";

import {
  MarketCalendarEventSchema,
  type MarketCalendarEvent,
} from "../contracts/market-calendar.js";
import { newYorkWallTimeToUtcInstant } from "./us-eastern-time.js";

export const FEDERAL_RESERVE_FOMC_CALENDAR_URL =
  "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm";

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
  february: 1,
  march: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

function htmlToLines(html: string): readonly string[] {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "\n")
    .replace(/<style[\s\S]*?<\/style>/gi, "\n")
    .replace(/<(br|p|div|li|h[1-6]|tr|td|th)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#8211;|&ndash;|&#8212;|&mdash;/g, "-")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function decisionInstantUtc(year: number, month: number, day: number): string {
  return newYorkWallTimeToUtcInstant({
    year,
    monthIndex: month,
    day,
    hour: 14,
    minute: 0,
  });
}

function parseMonthLabel(label: string): {
  readonly startMonth: number;
  readonly endMonth: number;
} | null {
  const parts = label
    .toLowerCase()
    .split("/")
    .map((part) => part.trim());
  const startMonth = MONTH_INDEX[parts[0] ?? ""];
  const endMonth = MONTH_INDEX[parts.at(-1) ?? ""];
  if (startMonth === undefined || endMonth === undefined) return null;
  return { startMonth, endMonth };
}

function parseDecisionDay(
  dateText: string,
  months: { readonly startMonth: number; readonly endMonth: number },
): { readonly day: number; readonly month: number; readonly hasSep: boolean } | null {
  const normalized = dateText.replace("*", "").replace(/\s*\(.+?\)\s*/g, "").trim();
  const match = /^(\d{1,2})(?:-(\d{1,2}))?$/.exec(normalized);
  if (!match) return null;
  const startDay = Number(match[1]);
  const endDay = match[2] ? Number(match[2]) : startDay;
  const month =
    months.endMonth !== months.startMonth && endDay < startDay
      ? months.endMonth
      : months.endMonth;
  return { day: endDay, month, hasSep: dateText.includes("*") };
}

function extractYearBlocks(html: string): readonly {
  readonly year: number;
  readonly html: string;
}[] {
  const matches = Array.from(
    html.matchAll(/<h4[^>]*>\s*(\d{4})\s+FOMC Meetings\s*<\/h4>/gi),
  );
  return matches.map((match, index) => {
    const start = match.index ?? 0;
    const next = matches[index + 1]?.index ?? html.length;
    return {
      year: Number(match[1]),
      html: html.slice(start, next),
    };
  });
}

export function parseFederalReserveFomcCalendarHtml(
  html: string,
  obtainedAt: string,
  sourceUrl = FEDERAL_RESERVE_FOMC_CALENDAR_URL,
): readonly MarketCalendarEvent[] {
  const documentHash = sha256(html);
  const events: MarketCalendarEvent[] = [];
  for (const block of extractYearBlocks(html)) {
    const lines = htmlToLines(block.html);
    let currentMonths: ReturnType<typeof parseMonthLabel> = null;
    for (const line of lines) {
      const maybeMonths = parseMonthLabel(line);
      if (maybeMonths !== null) {
        currentMonths = maybeMonths;
        continue;
      }
      if (currentMonths === null) continue;
      const decision = parseDecisionDay(line, currentMonths);
      if (decision === null) continue;
      const localDate = `${block.year}-${String(decision.month + 1).padStart(2, "0")}-${String(decision.day).padStart(2, "0")}`;
      const sourceEventId = `fomc-${localDate}`;
      const evidenceId = `fed-fomc-calendar-${documentHash.slice(0, 16)}`;
      const scheduledAt = decisionInstantUtc(block.year, decision.month, decision.day);
      const event = MarketCalendarEventSchema.parse({
        id: `calendar-us-fomc-${localDate}`,
        kind: "FOMC",
        marketScope: "GLOBAL",
        affectedMarkets: ["GLOBAL", "KR", "US"],
        instrumentIds: [],
        titleKo: decision.hasSep
          ? "FOMC 금리결정 및 경제전망"
          : "FOMC 금리결정",
        titleOriginal: decision.hasSep
          ? "FOMC decision and Summary of Economic Projections"
          : "FOMC decision",
        scheduledAt,
        localDate,
        timezone: "America/New_York",
        status: Date.parse(scheduledAt) <= Date.parse(obtainedAt)
          ? "REPORTED"
          : "SCHEDULED",
        importance: "CRITICAL",
        provider: "US_FEDERAL_RESERVE",
        sourceEventId,
        sourceUrl,
        dataQuality: "OFFICIAL",
        metrics: [],
        evidenceIds: [evidenceId],
        supersedesEventId: null,
        detectedAt: obtainedAt,
        updatedAt: obtainedAt,
        payloadVersion: 1,
      });
      events.push(event);
    }
  }
  return events;
}

export class FederalReserveFomcCalendarClient {
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
      const response = await this.#fetch(FEDERAL_RESERVE_FOMC_CALENDAR_URL, {
        headers: {
          Accept: "text/html",
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Federal Reserve FOMC calendar HTTP ${response.status}`);
      }
      const html = await response.text();
      return parseFederalReserveFomcCalendarHtml(html, new Date().toISOString());
    } finally {
      clearTimeout(timeout);
    }
  }
}
