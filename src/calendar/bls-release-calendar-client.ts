import { createHash } from "node:crypto";

import {
  MarketCalendarEventSchema,
  type MarketCalendarEvent,
} from "../contracts/market-calendar.js";
import { newYorkWallTimeToUtcInstant } from "./us-eastern-time.js";

export const BLS_RELEASE_ICS_URL =
  "https://www.bls.gov/schedule/news_release/bls.ics";

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

interface IcsEvent {
  readonly uid: string;
  readonly summary: string;
  readonly dtstart: string;
  readonly url: string | null;
}

function unfoldIcsLines(ics: string): readonly string[] {
  return ics
    .replace(/\r\n[ \t]/g, "")
    .replace(/\n[ \t]/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function icsValue(line: string): string {
  const index = line.indexOf(":");
  return index === -1 ? "" : line.slice(index + 1).trim();
}

function parseIcsEvents(ics: string): readonly IcsEvent[] {
  const events: IcsEvent[] = [];
  let current: Record<string, string> | null = null;
  for (const line of unfoldIcsLines(ics)) {
    if (line === "BEGIN:VEVENT") {
      current = {};
      continue;
    }
    if (line === "END:VEVENT") {
      if (current?.["UID"] && current["SUMMARY"] && current["DTSTART"]) {
        events.push({
          uid: current["UID"],
          summary: current["SUMMARY"],
          dtstart: current["DTSTART"],
          url: current["URL"] ?? null,
        });
      }
      current = null;
      continue;
    }
    if (current === null) continue;
    const [rawKey] = line.split(":", 1);
    const key = rawKey?.split(";")[0]?.toUpperCase();
    if (!key) continue;
    current[key] = icsValue(line).replace(/\\,/g, ",").replace(/\\n/g, " ");
  }
  return events;
}

function parseIcsDateTime(value: string): {
  readonly localDate: string;
  readonly scheduledAt: string;
} | null {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})\d{2}(?:Z)?$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  return {
    localDate: `${match[1]}-${match[2]}-${match[3]}`,
    scheduledAt: value.endsWith("Z")
      ? new Date(
          Date.UTC(year, monthIndex, day, hour, minute, 0),
        ).toISOString()
      : newYorkWallTimeToUtcInstant({ year, monthIndex, day, hour, minute }),
  };
}

function blsKind(summary: string): MarketCalendarEvent["kind"] | null {
  const normalized = summary.toLowerCase();
  if (normalized.includes("consumer price index")) return "CPI";
  if (normalized.includes("producer price index")) return "PPI";
  if (normalized.includes("employment situation")) return "EMPLOYMENT";
  if (normalized.includes("job openings and labor turnover")) return "EMPLOYMENT";
  if (normalized.includes("employment cost index")) return "EMPLOYMENT";
  if (normalized.includes("import and export price indexes")) return "MACRO_RELEASE";
  if (normalized.includes("productivity and costs")) return "MACRO_RELEASE";
  if (normalized.includes("real earnings")) return "MACRO_RELEASE";
  return null;
}

function blsKoreanTitle(kind: MarketCalendarEvent["kind"], summary: string): string {
  if (kind === "CPI") return "미국 CPI 발표";
  if (kind === "PPI") return "미국 PPI 발표";
  if (kind === "EMPLOYMENT") {
    return summary.toLowerCase().includes("job openings")
      ? "미국 JOLTS 발표"
      : "미국 고용지표 발표";
  }
  return `미국 경제지표 발표 · ${summary}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function parseBlsReleaseCalendarIcs(
  ics: string,
  obtainedAt: string,
  sourceUrl = BLS_RELEASE_ICS_URL,
): readonly MarketCalendarEvent[] {
  const hash = sha256(ics);
  const evidenceId = `bls-release-calendar-${hash.slice(0, 16)}`;
  return parseIcsEvents(ics).flatMap((icsEvent) => {
    const kind = blsKind(icsEvent.summary);
    const parsedTime = parseIcsDateTime(icsEvent.dtstart);
    if (kind === null || parsedTime === null) return [];
    return [
      MarketCalendarEventSchema.parse({
        id: `calendar-us-bls-${kind.toLowerCase()}-${parsedTime.localDate}-${sha256(icsEvent.uid).slice(0, 10)}`,
        kind,
        marketScope: "GLOBAL",
        affectedMarkets: ["GLOBAL", "KR", "US"],
        instrumentIds: [],
        titleKo: blsKoreanTitle(kind, icsEvent.summary),
        titleOriginal: icsEvent.summary,
        scheduledAt: parsedTime.scheduledAt,
        localDate: parsedTime.localDate,
        timezone: "America/New_York",
        status: Date.parse(parsedTime.scheduledAt) <= Date.parse(obtainedAt)
          ? "REPORTED"
          : "SCHEDULED",
        importance: kind === "CPI" || kind === "PPI" || kind === "EMPLOYMENT"
          ? "CRITICAL"
          : "HIGH",
        provider: "US_BLS",
        sourceEventId: icsEvent.uid,
        sourceUrl: icsEvent.url ?? sourceUrl,
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

export class BlsReleaseCalendarClient {
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
      const response = await this.#fetch(BLS_RELEASE_ICS_URL, {
        headers: { Accept: "text/calendar,text/plain" },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`BLS release calendar HTTP ${response.status}`);
      return parseBlsReleaseCalendarIcs(
        await response.text(),
        new Date().toISOString(),
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
