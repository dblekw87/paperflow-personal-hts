import { z } from "zod";

import type { KisCredentials } from "../config/runtime-config.js";
import { getKisEndpoints, KIS_PATH, KIS_TR } from "./endpoints.js";
import { KisApiError } from "./errors.js";

const rowSchema = z.object({
  kymd: z.string().regex(/^\d{8}$/),
  khms: z.string().regex(/^\d{6}$/),
  open: z.string(), high: z.string(), low: z.string(), last: z.string(),
  evol: z.string(), eamt: z.string().optional(),
}).loose();
const responseSchema = z.object({
  rt_cd: z.string(), msg_cd: z.string().optional(), msg1: z.string().optional(),
  output1: z.object({ next: z.string().optional(), more: z.string().optional() }).loose().optional(),
  output2: z.array(rowSchema).optional(),
}).loose();

export interface UsChartCandle {
  openedAt: string; closedAt: string; open: string; high: string; low: string;
  close: string; volume: string; turnover: string | null;
}

function canonicalDecimal(value: string, field: string, positive = true): string {
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(trimmed) || (positive && Number(trimmed) <= 0)) {
    throw new KisApiError({ code: "KIS_REST_SCHEMA_MISMATCH", message: `Invalid US candle ${field}`, retryable: false });
  }
  const [whole, fraction] = trimmed.split(".");
  const normalizedWhole = (whole ?? "0").replace(/^0+(?=\d)/, "");
  return fraction === undefined ? normalizedWhole : `${normalizedWhole}.${fraction}`;
}

export function normalizeUsIntradayRows(
  rows: readonly z.infer<typeof rowSchema>[], intervalMinutes: number,
): UsChartCandle[] {
  const unique = new Map<string, UsChartCandle>();
  for (const row of rows) {
    const opened = new Date(`${row.kymd.slice(0, 4)}-${row.kymd.slice(4, 6)}-${row.kymd.slice(6, 8)}T${row.khms.slice(0, 2)}:${row.khms.slice(2, 4)}:${row.khms.slice(4, 6)}+09:00`);
    const openedAt = opened.toISOString();
    unique.set(openedAt, {
      openedAt,
      closedAt: new Date(opened.getTime() + intervalMinutes * 60_000).toISOString(),
      open: canonicalDecimal(row.open, "open"), high: canonicalDecimal(row.high, "high"),
      low: canonicalDecimal(row.low, "low"), close: canonicalDecimal(row.last, "last"),
      volume: canonicalDecimal(row.evol, "evol", false),
      turnover: row.eamt && /^\d+(?:\.\d+)?$/.test(row.eamt.trim()) ? canonicalDecimal(row.eamt, "eamt", false) : null,
    });
  }
  return [...unique.values()].sort((a, b) => a.openedAt.localeCompare(b.openedAt));
}

export class KisUsChartClient {
  readonly #credentials: KisCredentials;
  readonly #getAccessToken: () => Promise<string>;
  constructor(options: { credentials: KisCredentials; getAccessToken: () => Promise<string> }) {
    this.#credentials = options.credentials;
    this.#getAccessToken = options.getAccessToken;
  }

  async getIntradayCandles(input: {
    exchange: "NAS" | "NYS" | "AMS"; symbol: string; intervalMinutes: number;
  }): Promise<{ candles: UsChartCandle[]; fetchedAt: string; complete: boolean }> {
    const url = new URL(`${getKisEndpoints("prod").restBaseUrl}${KIS_PATH.overseasIntradayCandles}`);
    url.search = new URLSearchParams({ AUTH: "", EXCD: input.exchange, SYMB: input.symbol,
      NMIN: String(input.intervalMinutes), PINC: "1", NEXT: "", NREC: "120", FILL: "", KEYB: "" }).toString();
    let response: Response;
    try {
      response = await fetch(url, { headers: { "content-type": "application/json; charset=utf-8",
        authorization: `Bearer ${await this.#getAccessToken()}`, appkey: this.#credentials.appKey,
        appsecret: this.#credentials.appSecret, tr_id: KIS_TR.overseasIntradayCandles, custtype: "P" },
        signal: AbortSignal.timeout(10_000) });
    } catch (error) {
      throw new KisApiError({ code: "KIS_NETWORK_ERROR", message: "KIS US chart endpoint is unreachable", retryable: true, cause: error });
    }
    const payload: unknown = await response.json().catch(() => undefined);
    const parsed = responseSchema.safeParse(payload);
    if (!response.ok || !parsed.success || parsed.data.rt_cd !== "0" || !parsed.data.output2) {
      throw new KisApiError({ code: parsed.success ? (parsed.data.msg_cd ?? "KIS_REST_FAILED") : "KIS_REST_SCHEMA_MISMATCH",
        message: parsed.success ? (parsed.data.msg1 ?? "KIS rejected the US chart request") : "KIS US chart response contract mismatch", retryable: response.status === 429 || response.status >= 500 });
    }
    return { candles: normalizeUsIntradayRows(parsed.data.output2, input.intervalMinutes), fetchedAt: new Date().toISOString(),
      complete: parsed.data.output1?.next !== "1" && parsed.data.output1?.more !== "1" };
  }
}
