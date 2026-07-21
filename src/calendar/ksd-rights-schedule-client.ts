import { createHash } from "node:crypto";
import { z } from "zod";

import type { PublicDataPortalCredentials } from "../config/runtime-config.js";
import {
  MarketCalendarEventSchema,
  type MarketCalendarEvent,
} from "../contracts/market-calendar.js";

export const KSD_RIGHTS_SCHEDULE_URL =
  "https://apis.data.go.kr/1160100/GetStocRighScheService_V2/getRighExerReasSche_V2";

type FetchLike = (
  input: URL,
  init?: {
    readonly headers?: Record<string, string>;
    readonly signal?: AbortSignal;
  },
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  readonly json: () => Promise<unknown>;
}>;

type ServiceKeyMode = "RAW" | "URL_ENCODED";

const rightsResponseSchema = z
  .object({
    response: z
      .object({
        header: z
          .object({
            resultCode: z.coerce.string().optional(),
            resultMsg: z.coerce.string().optional(),
          })
          .loose()
          .optional(),
        body: z
          .object({
            items: z
              .union([
                z.object({ item: z.union([z.array(z.unknown()), z.unknown()]) }).loose(),
                z.array(z.unknown()),
                z.unknown(),
              ])
              .optional(),
            pageNo: z.coerce.number().int().positive().optional(),
            numOfRows: z.coerce.number().int().positive().optional(),
            totalCount: z.coerce.number().int().nonnegative().optional(),
          })
          .loose()
          .optional(),
      })
      .loose(),
  })
  .loose();

export interface KsdRightsScheduleItem {
  readonly providerItemId: string;
  readonly baseDate: string | null;
  readonly issuerName: string | null;
  readonly issuerKsdCustomerNumber: string | null;
  readonly reason: string;
  readonly rightStartDate: string | null;
  readonly rightEndDate: string | null;
  readonly recordDate: string | null;
  readonly paymentDate: string | null;
  readonly stockCode: string | null;
  readonly raw: Record<string, unknown>;
}

function valueOf(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function normalizeDate(value: string | null): string | null {
  if (value === null) return null;
  const digits = value.replace(/\D/g, "");
  if (!/^\d{8}$/.test(digits)) return null;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

function seoulStartInstant(localDate: string): string {
  return new Date(`${localDate}T00:00:00+09:00`).toISOString();
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function extractItems(payload: unknown): readonly Record<string, unknown>[] {
  const parsed = rightsResponseSchema.parse(payload);
  const code = parsed.response.header?.resultCode;
  if (code !== undefined && code !== "00" && code !== "000") {
    throw new Error(`KSD_RIGHTS_${code}`);
  }
  const items = parsed.response.body?.items;
  const candidate =
    items && typeof items === "object" && !Array.isArray(items) && "item" in items
      ? (items as { item: unknown }).item
      : items;
  const array = Array.isArray(candidate) ? candidate : candidate ? [candidate] : [];
  return array.filter(
    (item): item is Record<string, unknown> =>
      item !== null && typeof item === "object" && !Array.isArray(item),
  );
}

function buildKsdRightsScheduleUrl(input: {
  readonly baseDate?: string;
  readonly page?: number;
  readonly rows?: number;
  readonly serviceKey: string;
  readonly serviceKeyMode: ServiceKeyMode;
}): URL {
  const url = new URL(KSD_RIGHTS_SCHEDULE_URL);
  url.searchParams.set("resultType", "json");
  url.searchParams.set("pageNo", String(input.page ?? 1));
  url.searchParams.set("numOfRows", String(input.rows ?? 100));
  if (input.baseDate) url.searchParams.set("basDt", input.baseDate);
  if (input.serviceKeyMode === "URL_ENCODED") {
    url.searchParams.set("serviceKey", input.serviceKey);
  } else {
    url.search = `${url.search.slice(1)}&serviceKey=${input.serviceKey}`;
  }
  return url;
}

export function parseKsdRightsScheduleResponse(
  payload: unknown,
): readonly KsdRightsScheduleItem[] {
  return extractItems(payload).map((raw) => {
    const baseDate = normalizeDate(valueOf(raw, ["basDt", "baseDate"]));
    const reason =
      valueOf(raw, [
        "righExerReas",
        "righExerReasNm",
        "rightExerciseReason",
        "stkRghtExerRsn",
        "stckRighReasNm",
      ]) ?? "권리행사";
    const issuerName = valueOf(raw, [
      "stckIssuCmpyNm",
      "issuCmpyNm",
      "issuerName",
      "korSecnNm",
      "itmsNm",
    ]);
    const stockCode = valueOf(raw, ["srtnCd", "stckIssuCmpyCd", "isinCd"])?.slice(-6) ?? null;
    const rightStartDate = normalizeDate(
      valueOf(raw, ["righExerStrtDt", "rgtExerStrtDt", "rightStartDate"]),
    );
    const rightEndDate = normalizeDate(
      valueOf(raw, ["righExerEndDt", "rgtExerEndDt", "rightEndDate"]),
    );
    const recordDate = normalizeDate(
      valueOf(raw, ["stckBasDt", "recordDate", "basDt", "rcrdDt"]),
    );
    const paymentDate = normalizeDate(
      valueOf(raw, ["cashDvdnPayDt", "payDt", "paymentDate"]),
    );
    const providerItemId = sha256(
      JSON.stringify({
        baseDate,
        issuerName,
        reason,
        rightStartDate,
        rightEndDate,
        recordDate,
        paymentDate,
        raw,
      }),
    ).slice(0, 32);
    return {
      providerItemId,
      baseDate,
      issuerName,
      issuerKsdCustomerNumber: valueOf(raw, [
        "issuCmpyKsdCustNo",
        "issuerKsdCustomerNumber",
      ]),
      reason,
      rightStartDate,
      rightEndDate,
      recordDate,
      paymentDate,
      stockCode,
      raw,
    };
  });
}

function kindFromReason(reason: string): MarketCalendarEvent["kind"] {
  if (/배당|현금/.test(reason)) return "DIVIDEND_RECORD_DATE";
  if (/무상/.test(reason)) return "BONUS_ISSUE";
  if (/유상|실권|청약/.test(reason)) return "CAPITAL_INCREASE";
  if (/분할|액면분할/.test(reason)) return "STOCK_SPLIT";
  if (/병합|액면병합/.test(reason)) return "REVERSE_SPLIT";
  if (/교환/.test(reason)) return "SHARE_EXCHANGE";
  if (/감자/.test(reason)) return "CAPITAL_REDUCTION";
  return "OTHER_CORPORATE";
}

export function ksdRightsItemsToCalendarEvents(input: {
  readonly items: readonly KsdRightsScheduleItem[];
  readonly obtainedAt: string;
}): readonly MarketCalendarEvent[] {
  return input.items.flatMap((item) => {
    const localDate =
      item.recordDate ?? item.rightStartDate ?? item.rightEndDate ?? item.baseDate;
    if (localDate === null) return [];
    const kind = kindFromReason(item.reason);
    const sourceUrl =
      "https://www.data.go.kr/data/15059609/openapi.do";
    return [
      MarketCalendarEventSchema.parse({
        id: `calendar-kr-ksd-rights-${item.providerItemId}`,
        kind,
        marketScope: "KR",
        affectedMarkets: ["KR"],
        instrumentIds: item.stockCode === null ? [] : [`KRX:${item.stockCode}`],
        titleKo: `${item.issuerName ?? "상장법인"} ${item.reason}`,
        titleOriginal: `${item.issuerName ?? "Listed issuer"} ${item.reason}`,
        scheduledAt: seoulStartInstant(localDate),
        localDate,
        timezone: "Asia/Seoul",
        status: Date.parse(seoulStartInstant(localDate)) <= Date.parse(input.obtainedAt)
          ? "CONFIRMED"
          : "SCHEDULED",
        importance: kind === "OTHER_CORPORATE" ? "MEDIUM" : "HIGH",
        provider: "KSD_RIGHTS_SCHEDULE",
        sourceEventId: item.providerItemId,
        sourceUrl,
        dataQuality: "DELAYED",
        metrics: [],
        evidenceIds: [`ksd-rights-${item.providerItemId}`],
        supersedesEventId: null,
        detectedAt: input.obtainedAt,
        updatedAt: input.obtainedAt,
        payloadVersion: 1,
      }),
    ];
  });
}

export class KsdRightsScheduleClient {
  readonly #credentials: PublicDataPortalCredentials;
  readonly #fetch: FetchLike;
  readonly #timeoutMs: number;

  public constructor(options: {
    readonly credentials: PublicDataPortalCredentials;
    readonly fetch?: FetchLike;
    readonly timeoutMs?: number;
  }) {
    this.#credentials = options.credentials;
    this.#fetch = options.fetch ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? 8_000;
  }

  public async getEvents(input: {
    readonly baseDate?: string;
    readonly page?: number;
    readonly rows?: number;
  } = {}): Promise<readonly MarketCalendarEvent[]> {
    const serviceKey = this.#credentials.serviceKey.trim();
    let unauthorizedError: Error | null = null;
    for (const serviceKeyMode of ["RAW", "URL_ENCODED"] satisfies readonly ServiceKeyMode[]) {
      const url = buildKsdRightsScheduleUrl({ ...input, serviceKey, serviceKeyMode });
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
      try {
        const response = await this.#fetch(url, {
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        if (!response.ok) {
          const error = new Error(`KSD rights schedule HTTP ${response.status}`);
          if (response.status === 401) {
            unauthorizedError = error;
            continue;
          }
          throw error;
        }
        const obtainedAt = new Date().toISOString();
        return ksdRightsItemsToCalendarEvents({
          items: parseKsdRightsScheduleResponse(await response.json()),
          obtainedAt,
        });
      } finally {
        clearTimeout(timeout);
      }
    }
    throw unauthorizedError ?? new Error("KSD rights schedule unauthorized");
  }
}
