import { z } from "zod";

import type { KisCredentials } from "../config/runtime-config.js";
import { getKisEndpoints, KIS_PATH, KIS_TR } from "./endpoints.js";
import { KisApiError } from "./errors.js";
import { getKisReadOnlyJson } from "./readonly-rest.js";

export type UsRankingExchange = "NAS" | "NYS" | "AMS";
export type UsRankingSort = "AVERAGE_VOLUME" | "VOLUME_INCREASE" | "TURNOVER" | "CHANGE_RATE_GAINERS" | "CHANGE_RATE_LOSERS";

const decimal = z.string().trim().regex(/^[+-]?\d+(?:\.\d+)?$/);
const itemSchema = z.object({
  excd: z.enum(["NAS", "NYS", "AMS"]),
  symb: z.string().trim().regex(/^[A-Z0-9.-]{1,20}$/),
  name: z.string().trim().min(1),
  ename: z.string().trim().optional().default(""),
  last: decimal,
  diff: decimal,
  rate: decimal,
  tvol: decimal,
  tamt: decimal,
  rank: z.string().trim().regex(/^\d+$/),
  n_tvol: decimal.optional(),
  a_tvol: decimal.optional(),
  n_rate: decimal.optional(),
}).loose();
const responseSchema = z.object({
  rt_cd: z.string(), msg_cd: z.string().optional(), msg1: z.string().optional(),
  output2: z.array(itemSchema).optional(),
}).loose();

export interface UsRankingItem {
  readonly exchange: UsRankingExchange; readonly rank: string; readonly symbol: string;
  readonly name: string; readonly price: string; readonly change: string; readonly changeRate: string;
  readonly cumulativeVolume: string; readonly comparisonVolume: string | null;
  readonly volumeIncreaseRate: string | null; readonly cumulativeTurnover: string;
}

function definition(sort: UsRankingSort) {
  if (sort === "CHANGE_RATE_GAINERS" || sort === "CHANGE_RATE_LOSERS") {
    return { path: KIS_PATH.overseasUpdownRateRank, trId: KIS_TR.overseasUpdownRateRank, extra: { GUBN: sort === "CHANGE_RATE_GAINERS" ? "1" : "0" } };
  }
  if (sort === "VOLUME_INCREASE") return { path: KIS_PATH.overseasTradeGrowthRank, trId: KIS_TR.overseasTradeGrowthRank, extra: {} };
  if (sort === "TURNOVER") return { path: KIS_PATH.overseasTradeTurnoverRank, trId: KIS_TR.overseasTradeTurnoverRank, extra: { PRC1: "", PRC2: "" } };
  return { path: KIS_PATH.overseasTradeVolumeRank, trId: KIS_TR.overseasTradeVolumeRank, extra: { PRC1: "", PRC2: "" } };
}

export class KisUsRankingClient {
  readonly #credentials: KisCredentials;
  readonly #getAccessToken: () => Promise<string>;
  constructor(options: { credentials: KisCredentials; getAccessToken: () => Promise<string> }) {
    this.#credentials = options.credentials; this.#getAccessToken = options.getAccessToken;
  }
  async getRanking(exchange: UsRankingExchange, sort: UsRankingSort): Promise<readonly UsRankingItem[]> {
    const request = definition(sort);
    const url = new URL(`${getKisEndpoints("prod").restBaseUrl}${request.path}`);
    url.search = new URLSearchParams({ EXCD: exchange, NDAY: "0", VOL_RANG: "0", AUTH: "", KEYB: "", ...request.extra }).toString();
    const response = await getKisReadOnlyJson({ url, trId: request.trId, credentials: this.#credentials, getAccessToken: this.#getAccessToken, operation: `US ${sort} ranking` });
    const parsed = responseSchema.safeParse(response.payload);
    if (!parsed.success) throw new KisApiError({ code: "KIS_REST_SCHEMA_MISMATCH", message: "KIS US ranking response did not match the contract", retryable: false });
    if (parsed.data.rt_cd !== "0") throw new KisApiError({ code: parsed.data.msg_cd ?? "KIS_BUSINESS_ERROR", message: parsed.data.msg1 ?? "KIS rejected the US ranking request", retryable: parsed.data.msg_cd === "EGW00201" });
    return (parsed.data.output2 ?? []).map((item) => ({
      exchange: item.excd, rank: item.rank, symbol: item.symb, name: item.name || item.ename,
      price: item.last, change: item.diff, changeRate: item.rate, cumulativeVolume: item.tvol,
      comparisonVolume: item.n_tvol ?? item.a_tvol ?? null,
      volumeIncreaseRate: item.n_rate ?? null, cumulativeTurnover: item.tamt,
    }));
  }
}
